import { quotaFromOAuthUsage } from "../model";
import type { QuotaProvider, ProviderReadResult } from "../provider";
import type { CachedTokenProvider, CredentialFailure } from "./credentials";

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const REQUEST_TIMEOUT_MS = 20_000;

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

interface ClaudeProviderDeps {
  tokenProvider: CachedTokenProvider;
  fetchImpl: FetchImpl;
}

// Reported verbatim, or omitted when the header is absent or non-positive — this
// endpoint answers "retry-after: 0" while still blocking. How long to wait is the
// SourceRuntime's rate-limit policy to decide, not the provider's.
function retryAfterSeconds(response: Response): number | undefined {
  const parsed = Number(response.headers.get("retry-after"));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

// Every credential failure used to render as "credentials were not found", which
// pointed at the one cause that was usually innocent. Each reason now says what
// actually happened and what would fix it.
const CREDENTIAL_DIAGNOSTICS: Record<CredentialFailure, string> = {
  "unsupported-platform": "Claude Code credentials are only readable on macOS",
  "not-found": "No Claude Code credentials in the Keychain. Sign in with the Claude Code CLI",
  "keychain-unavailable": "Could not read the Claude Code credential from the Keychain",
  corrupt: "The Claude Code credential could not be parsed. Sign in with the Claude Code CLI",
  expired: "The Claude Code access token expired. Run Claude Code to renew it",
};

// Reasons the user has to act on stay "missing" so the popover keeps showing them;
// the rest are retried on the normal schedule.
const TRANSIENT_CREDENTIAL_FAILURES: ReadonlySet<CredentialFailure> = new Set<CredentialFailure>([
  "keychain-unavailable",
  "expired",
]);

function safeFetchError(error: unknown): string {
  const name = error instanceof Error ? error.name : undefined;
  if (name === "AbortError" || name === "TimeoutError") { return "Request timed out"; }
  if (name === "Error" || name === "TypeError") { return `Network error (${name})`; }
  return "Network error";
}

export class ClaudeQuotaProvider implements QuotaProvider {
  readonly id = "claude" as const;

  constructor(private readonly deps: ClaudeProviderDeps) {}

  async read(nowSec: number): Promise<ProviderReadResult> {
    const token = await this.deps.tokenProvider.get();
    if (!token.ok) {
      return {
        ok: false,
        kind: TRANSIENT_CREDENTIAL_FAILURES.has(token.reason) ? "transient" : "missing",
        error: CREDENTIAL_DIAGNOSTICS[token.reason],
      };
    }
    try {
      const response = await this.deps.fetchImpl(USAGE_URL, {
        headers: {
          Authorization: `Bearer ${token.token}`,
          "anthropic-beta": "oauth-2025-04-20",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status === 401) {
        this.deps.tokenProvider.invalidate();
        return { ok: false, kind: "auth", error: "HTTP 401" };
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
      return { ok: true, quota: quotaFromOAuthUsage(await response.json(), nowSec) };
    } catch (error) {
      return { ok: false, kind: "transient", error: safeFetchError(error) };
    }
  }

  dispose(): void { /* no persistent external resource */ }
}
