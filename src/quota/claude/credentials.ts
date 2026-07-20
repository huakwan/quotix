import { execFile, execFileSync } from "node:child_process";
import * as os from "node:os";
import { promisify } from "node:util";

export type TokenResult =
  | { ok: true; token: string }
  | { ok: false; reason: string };

export interface OAuthCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  refreshTokenExpiresAt: number | null;
}

export type CredentialsResult =
  | { ok: true; creds: OAuthCredentials; raw: string }
  | { ok: false; reason: string };

export type RefreshResult =
  | { ok: true; creds: OAuthCredentials }
  | { ok: false; reason: string };

const KEYCHAIN_SERVICE = "Claude Code-credentials";
const OAUTH_TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";
const OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const DEFAULT_TOKEN_REFRESH_MS = 30_000;
const EXPIRY_SKEW_MS = 60_000;
const REFRESH_TIMEOUT_MS = 20_000;
const execFileAsync = promisify(execFile);

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

function safeFetchError(error: unknown): string {
  const name = error instanceof Error ? error.name : undefined;
  if (name === "AbortError" || name === "TimeoutError") { return "Request timed out"; }
  if (name === "Error" || name === "TypeError") { return `Network error (${name})`; }
  return "Network error";
}

export function parseOAuthCredentials(blob: string): CredentialsResult {
  try {
    const value = JSON.parse(blob) as Record<string, unknown>;
    const oauth = value.claudeAiOauth as Record<string, unknown> | undefined;
    const accessToken = oauth?.accessToken;
    if (typeof accessToken !== "string" || accessToken.length === 0) {
      return { ok: false, reason: "corrupt" };
    }
    return {
      ok: true,
      raw: blob,
      creds: {
        accessToken,
        refreshToken: typeof oauth?.refreshToken === "string" ? oauth.refreshToken : "",
        expiresAt: typeof oauth?.expiresAt === "number" ? oauth.expiresAt : 0,
        refreshTokenExpiresAt:
          typeof oauth?.refreshTokenExpiresAt === "number" ? oauth.refreshTokenExpiresAt : null,
      },
    };
  } catch {
    return { ok: false, reason: "corrupt" };
  }
}

interface RefreshDeps {
  fetchImpl: FetchImpl;
  now: () => number;
}

export async function refreshAccessToken(
  refreshToken: string,
  deps: RefreshDeps,
): Promise<RefreshResult> {
  try {
    const response = await deps.fetchImpl(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: OAUTH_CLIENT_ID,
      }),
      signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
    });
    if (!response.ok) { return { ok: false, reason: `HTTP ${response.status}` }; }
    const data = (await response.json()) as Record<string, unknown>;
    const accessToken = data.access_token;
    if (typeof accessToken !== "string" || accessToken.length === 0) {
      return { ok: false, reason: "corrupt" };
    }
    const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 0;
    return {
      ok: true,
      creds: {
        accessToken,
        refreshToken:
          typeof data.refresh_token === "string" && data.refresh_token.length > 0
            ? data.refresh_token
            : refreshToken,
        expiresAt: deps.now() + expiresIn * 1000,
        refreshTokenExpiresAt:
          typeof data.refresh_token_expires_at === "number" ? data.refresh_token_expires_at : null,
      },
    };
  } catch (error) {
    return { ok: false, reason: safeFetchError(error) };
  }
}

export function applyRefreshedTokens(originalBlob: string, refreshed: OAuthCredentials): string {
  const value = JSON.parse(originalBlob) as Record<string, unknown>;
  const oauth = { ...((value.claudeAiOauth as Record<string, unknown> | undefined) ?? {}) };
  oauth.accessToken = refreshed.accessToken;
  oauth.refreshToken = refreshed.refreshToken;
  oauth.expiresAt = refreshed.expiresAt;
  if (refreshed.refreshTokenExpiresAt !== null) {
    oauth.refreshTokenExpiresAt = refreshed.refreshTokenExpiresAt;
  }
  return JSON.stringify({ ...value, claudeAiOauth: oauth });
}

function keychainArgs(): string[] {
  return ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", os.userInfo().username, "-w"];
}

export function readOAuthCredentials(): CredentialsResult {
  if (process.platform !== "darwin") { return { ok: false, reason: "unsupported-platform" }; }
  try { return parseOAuthCredentials(execFileSync("security", keychainArgs(), { encoding: "utf8" })); }
  catch { return { ok: false, reason: "keychain-unavailable" }; }
}

export async function readOAuthCredentialsAsync(): Promise<CredentialsResult> {
  if (process.platform !== "darwin") { return { ok: false, reason: "unsupported-platform" }; }
  try {
    const { stdout } = await execFileAsync("security", keychainArgs(), { encoding: "utf8" });
    return parseOAuthCredentials(stdout);
  } catch {
    return { ok: false, reason: "keychain-unavailable" };
  }
}

// Persists refreshed tokens back to the Keychain item Claude Code shares. The blob
// is passed as an argv entry to `security`; this is briefly visible to same-user
// processes, matching how Claude Code itself manages the credential.
export function writeOAuthCredentialsBlob(blob: string): void {
  if (process.platform !== "darwin") { return; }
  try {
    execFileSync(
      "security",
      ["add-generic-password", "-U", "-s", KEYCHAIN_SERVICE, "-a", os.userInfo().username, "-w", blob],
      { stdio: "ignore" },
    );
  } catch { /* best effort; the CLI can re-establish credentials if this fails */ }
}

export interface CachedTokenProvider {
  get(): TokenResult;
  invalidate(): void;
}

interface CachedTokenProviderDeps {
  readSync: () => CredentialsResult;
  readAsync: () => Promise<CredentialsResult>;
  refresh: (refreshToken: string) => Promise<RefreshResult>;
  writeBlob: (blob: string) => void;
  now: () => number;
  refreshMs: number;
}

export function createCachedTokenProvider(
  deps: Partial<CachedTokenProviderDeps> = {},
): CachedTokenProvider {
  const readSync = deps.readSync ?? readOAuthCredentials;
  const readAsync = deps.readAsync ?? readOAuthCredentialsAsync;
  const refresh =
    deps.refresh ?? ((refreshToken: string) => refreshAccessToken(refreshToken, { fetchImpl: fetch, now: Date.now }));
  const writeBlob = deps.writeBlob ?? writeOAuthCredentialsBlob;
  const now = deps.now ?? Date.now;
  const refreshMs = deps.refreshMs ?? DEFAULT_TOKEN_REFRESH_MS;

  let current: TokenResult;
  let expiresAt = 0;
  let lastReadAt = now();
  let inFlight = false;

  const applyCreds = (result: CredentialsResult): void => {
    if (result.ok) {
      current = { ok: true, token: result.creds.accessToken };
      expiresAt = result.creds.expiresAt;
    } else {
      current = { ok: false, reason: result.reason };
      expiresAt = 0;
    }
  };

  applyCreds(readSync());

  const isExpired = (nowMs: number, at: number): boolean => at > 0 && nowMs >= at - EXPIRY_SKEW_MS;

  const doRefresh = (): void => {
    if (inFlight) { return; }
    inFlight = true;
    void (async () => {
      try {
        const result = await readAsync();
        if (!result.ok) { applyCreds(result); return; }
        const nowMs = now();
        if (!isExpired(nowMs, result.creds.expiresAt)) {
          // Keychain holds a still-valid token (e.g. the CLI refreshed it).
          applyCreds(result);
          return;
        }
        const rtExpiry = result.creds.refreshTokenExpiresAt;
        if (result.creds.refreshToken.length === 0 || (rtExpiry !== null && nowMs >= rtExpiry)) {
          // Refresh token itself is gone/expired — headless refresh cannot recover.
          current = { ok: false, reason: "refresh-token-expired" };
          expiresAt = 0;
          return;
        }
        const refreshed = await refresh(result.creds.refreshToken);
        if (!refreshed.ok) {
          current = { ok: false, reason: refreshed.reason };
          expiresAt = 0;
          return;
        }
        writeBlob(applyRefreshedTokens(result.raw, refreshed.creds));
        current = { ok: true, token: refreshed.creds.accessToken };
        expiresAt = refreshed.creds.expiresAt;
      } catch {
        /* retain last-known token */
      } finally {
        lastReadAt = now();
        inFlight = false;
      }
    })();
  };

  return {
    get: () => {
      const nowMs = now();
      if (nowMs - lastReadAt >= refreshMs || isExpired(nowMs, expiresAt) || !current.ok) {
        doRefresh();
      }
      return current;
    },
    invalidate: doRefresh,
  };
}
