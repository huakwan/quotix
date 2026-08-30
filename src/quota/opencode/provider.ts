import type { CredentialFailure, OpenCodeKeyProvider } from "./credentials";
import type { QuotaProvider, ProviderReadResult } from "../provider";
import { quotaFromOpenCodeUsage } from "../model";

// OpenCode Go exposes the same three windows the console does — rolling 5-hour,
// weekly, monthly — and any OpenCode API key for the account can read them.
const USAGE_URL = "https://opencode.ai/zen/go/v1/usage";
const REQUEST_TIMEOUT_MS = 20_000;

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

interface OpenCodeProviderDeps {
  keyProvider: OpenCodeKeyProvider;
  fetchImpl: FetchImpl;
}

// One message per cause, so a missing key never reads like a permissions problem.
const CREDENTIAL_DIAGNOSTICS: Record<CredentialFailure, string> = {
  "not-found": "No OpenCode credentials file found. Sign in with the OpenCode CLI",
  unreadable: "Could not read the OpenCode credentials file",
  corrupt: "The OpenCode credentials file could not be parsed. Add your key with opencode auth login",
  "missing-key": "No OpenCode Go API key stored. Add it with opencode auth login",
};

// Reasons the user has to act on stay "missing" so the popover keeps showing them;
// the rest are retried on the normal schedule.
const TRANSIENT_CREDENTIAL_FAILURES: ReadonlySet<CredentialFailure> = new Set<CredentialFailure>([
  "unreadable",
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

export class OpenCodeQuotaProvider implements QuotaProvider {
  readonly id = "opencode" as const;

  constructor(private readonly deps: OpenCodeProviderDeps) {}

  async read(nowSec: number): Promise<ProviderReadResult> {
    const key = await this.deps.keyProvider.get();
    if (!key.ok) {
      return {
        ok: false,
        kind: TRANSIENT_CREDENTIAL_FAILURES.has(key.reason) ? "transient" : "missing",
        error: CREDENTIAL_DIAGNOSTICS[key.reason],
      };
    }
    try {
      const response = await this.deps.fetchImpl(USAGE_URL, {
        headers: { Accept: "application/json", Authorization: `Bearer ${key.token}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status === 401) {
        // The key is either revoked or no longer what the CLI wrote; re-read the
        // file so the next poll uses whatever replaced it.
        this.deps.keyProvider.invalidate();
        return { ok: false, kind: "auth", error: "OpenCode rejected the API key. Sign in again" };
      }
      if (response.status === 403) {
        return {
          ok: false,
          kind: "missing",
          error: "This OpenCode account has no OpenCode Go subscription",
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
      // A gateway page can answer 200, so a body that is not JSON is a transport
      // problem, not an account with zero usage.
      const body = await response.json().catch(() => undefined);
      if (body === undefined) {
        return { ok: false, kind: "transient", error: "OpenCode returned an unreadable response" };
      }
      return { ok: true, quota: quotaFromOpenCodeUsage(body, nowSec) };
    } catch (error) {
      return { ok: false, kind: "transient", error: safeFetchError(error) };
    }
  }

  dispose(): void { /* no persistent external resource */ }
}
