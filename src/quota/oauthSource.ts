import { quotaFromOAuthUsage, ReadResult } from "./model";

export type TokenResult =
  | { ok: true; token: string }
  | { ok: false; reason: string };

export type FetchImpl = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<Response>;

export type OAuthFetchResult = ReadResult & { retryAfterSeconds?: number; tokenInvalid?: boolean };

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const DEFAULT_RATE_LIMIT_BACKOFF_SECONDS = 60;
export const MAX_RATE_LIMIT_BACKOFF_SECONDS = 10 * 60;
const REQUEST_TIMEOUT_MS = 20_000;

function retryAfterSeconds(res: Response): number {
  const header = res.headers?.get?.("retry-after");
  const parsed = header ? Number(header) : NaN;
  if (!(Number.isFinite(parsed) && parsed > 0)) { return DEFAULT_RATE_LIMIT_BACKOFF_SECONDS; }
  return Math.min(parsed, MAX_RATE_LIMIT_BACKOFF_SECONDS);
}

function safeFetchError(error: unknown): string {
  const name = error instanceof Error ? error.name : undefined;
  if (name === "AbortError" || name === "TimeoutError") { return "Request timed out"; }
  if (name === "Error" || name === "TypeError") { return `Network error (${name})`; }
  return "Network error";
}

export async function fetchOAuthQuota(
  token: string,
  fetchImpl: FetchImpl,
  updatedAt: number = Math.floor(Date.now() / 1000),
): Promise<OAuthFetchResult> {
  try {
    const res = await fetchImpl(USAGE_URL, {
      headers: { Authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.status === 401) {
      return { ok: false, reason: "corrupt", error: "HTTP 401", tokenInvalid: true };
    }
    if (res.status === 429) {
      return { ok: false, reason: "corrupt", error: "HTTP 429", retryAfterSeconds: retryAfterSeconds(res) };
    }
    if (!res.ok) { return { ok: false, reason: "corrupt", error: `HTTP ${res.status}` }; }
    const json = await res.json();
    return { ok: true, quota: quotaFromOAuthUsage(json, updatedAt) };
  } catch (e) {
    return { ok: false, reason: "corrupt", error: safeFetchError(e) };
  }
}
