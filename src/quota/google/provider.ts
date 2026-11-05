import type { CredentialFailure, GoogleKeyProvider } from "./credentials";
import type { QuotaProvider, ProviderReadResult } from "../provider";
import { quotaFromGoogleQuotaSummary } from "../model";

const DIRECT_API_URL = "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary";
const REQUEST_TIMEOUT_MS = 20_000;
const USER_AGENT = "Antigravity/2.29.0";

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

interface GoogleProviderDeps {
  keyProvider: GoogleKeyProvider;
  fetchImpl: FetchImpl;
}

const CREDENTIAL_DIAGNOSTICS: Record<CredentialFailure, string> = {
  "unsupported-platform": "Google AI quota is only available on macOS",
  "not-found": "No Google AI credentials found. Sign in with the Antigravity CLI or IDE",
  "keychain-unavailable": "Could not access the macOS Keychain for Google credentials",
  corrupt: "The stored Google credentials could not be parsed",
  expired: "Google credentials expired. Sign in with the Antigravity CLI or IDE",
};

const TRANSIENT_CREDENTIAL_FAILURES: ReadonlySet<CredentialFailure> = new Set<CredentialFailure>([
  "keychain-unavailable",
]);

function retryAfterSeconds(response: Response): number | undefined {
  const parsed = Number(response.headers.get("retry-after"));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function safeFetchError(error: unknown): string {
  const name = error instanceof Error ? error.name : undefined;
  if (name === "AbortError" || name === "TimeoutError") { return "Request timed out"; }
  if (name === "Error" || name === "TypeError") { return `Network error (${name})`; }
  return "Network error";
}

export class GoogleQuotaProvider implements QuotaProvider {
  readonly id = "google" as const;

  constructor(private readonly deps: GoogleProviderDeps) {}

  async read(nowSec: number): Promise<ProviderReadResult> {
    const cred = await this.deps.keyProvider.get();
    if (!cred.ok) {
      return {
        ok: false,
        kind: TRANSIENT_CREDENTIAL_FAILURES.has(cred.reason) ? "transient" : "missing",
        error: CREDENTIAL_DIAGNOSTICS[cred.reason],
      };
    }

    if (cred.credential.kind === "daemon") {
      const daemonResult = await this.fetchFromDaemon(cred.credential, nowSec);
      if (daemonResult.ok) {
        return daemonResult;
      }
      // If daemon connection refused or failed, invalidate and try fresh read (which may pick up keychain token)
      this.deps.keyProvider.invalidate();
    }

    // Try token (either primary or fallback)
    const freshCred = await this.deps.keyProvider.get();
    if (!freshCred.ok) {
      return {
        ok: false,
        kind: TRANSIENT_CREDENTIAL_FAILURES.has(freshCred.reason) ? "transient" : "missing",
        error: CREDENTIAL_DIAGNOSTICS[freshCred.reason],
      };
    }

    if (freshCred.credential.kind === "daemon") {
      return this.fetchFromDaemon(freshCred.credential, nowSec);
    }

    return this.fetchFromDirectApi(freshCred.credential.accessToken, nowSec);
  }

  private async fetchFromDaemon(
    daemon: { httpPort: number; csrfToken: string },
    nowSec: number,
  ): Promise<ProviderReadResult> {
    const url = `http://127.0.0.1:${daemon.httpPort}/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary`;
    try {
      const response = await this.deps.fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Codeium-Csrf-Token": daemon.csrfToken,
        },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        return { ok: false, kind: "transient", error: `Daemon HTTP ${response.status}` };
      }

      const body = await response.json().catch(() => undefined);
      if (body === undefined) {
        return { ok: false, kind: "transient", error: "Daemon returned unreadable JSON" };
      }

      return { ok: true, quota: quotaFromGoogleQuotaSummary(body, nowSec) };
    } catch (error) {
      return { ok: false, kind: "transient", error: safeFetchError(error) };
    }
  }

  private async fetchFromDirectApi(accessToken: string, nowSec: number): Promise<ProviderReadResult> {
    try {
      const response = await this.deps.fetchImpl(DIRECT_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          "User-Agent": USER_AGENT,
        },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (response.status === 401) {
        this.deps.keyProvider.invalidate();
        return { ok: false, kind: "auth", error: "Google rejected the authentication token. Sign in again" };
      }
      if (response.status === 403) {
        return {
          ok: false,
          kind: "missing",
          error: "This Google account has no valid Google AI license",
        };
      }
      if (response.status === 429) {
        return {
          ok: false,
          kind: "rate-limited",
          error: "HTTP 429",
          retryAfterSeconds: retryAfterSeconds(response),
        };
      }
      if (!response.ok) {
        return { ok: false, kind: "transient", error: `HTTP ${response.status}` };
      }

      const body = await response.json().catch(() => undefined);
      if (body === undefined) {
        return { ok: false, kind: "transient", error: "Google returned an unreadable response" };
      }

      return { ok: true, quota: quotaFromGoogleQuotaSummary(body, nowSec) };
    } catch (error) {
      return { ok: false, kind: "transient", error: safeFetchError(error) };
    }
  }

  dispose(): void { /* no persistent child processes */ }
}

