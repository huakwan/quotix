import { quotaFromOAuthUsage } from "../model";
import type { QuotaProvider, ProviderReadResult } from "../provider";
import type { CachedTokenProvider } from "./credentials";

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_RETRY_SECONDS = 60;
const MAX_RETRY_SECONDS = 10 * 60;

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

interface ClaudeProviderDeps {
  tokenProvider: CachedTokenProvider;
  fetchImpl: FetchImpl;
}

function retryAfterSeconds(response: Response): number {
  const parsed = Number(response.headers.get("retry-after"));
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(parsed, MAX_RETRY_SECONDS)
    : DEFAULT_RETRY_SECONDS;
}

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
    const token = this.deps.tokenProvider.get();
    if (!token.ok) {
      return { ok: false, kind: "missing", error: "Claude Code credentials were not found" };
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
