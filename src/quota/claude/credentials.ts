import { execFile, execFileSync } from "node:child_process";
import * as os from "node:os";
import { promisify } from "node:util";

export type TokenResult =
  | { ok: true; token: string }
  | { ok: false; reason: string };

const KEYCHAIN_SERVICE = "Claude Code-credentials";
const DEFAULT_TOKEN_REFRESH_MS = 30_000;
const execFileAsync = promisify(execFile);

export function parseCredentialsBlob(blob: string): TokenResult {
  try {
    const value = JSON.parse(blob) as Record<string, unknown>;
    const oauth = value.claudeAiOauth as Record<string, unknown> | undefined;
    const token = oauth?.accessToken;
    return typeof token === "string" && token.length > 0
      ? { ok: true, token }
      : { ok: false, reason: "corrupt" };
  } catch {
    return { ok: false, reason: "corrupt" };
  }
}

function keychainArgs(): string[] {
  return ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", os.userInfo().username, "-w"];
}

export function readOAuthAccessToken(): TokenResult {
  if (process.platform !== "darwin") { return { ok: false, reason: "unsupported-platform" }; }
  try { return parseCredentialsBlob(execFileSync("security", keychainArgs(), { encoding: "utf8" })); }
  catch { return { ok: false, reason: "keychain-unavailable" }; }
}

export async function readOAuthAccessTokenAsync(): Promise<TokenResult> {
  if (process.platform !== "darwin") { return { ok: false, reason: "unsupported-platform" }; }
  try {
    const { stdout } = await execFileAsync("security", keychainArgs(), { encoding: "utf8" });
    return parseCredentialsBlob(stdout);
  } catch {
    return { ok: false, reason: "keychain-unavailable" };
  }
}

export interface CachedTokenProvider {
  get(): TokenResult;
  invalidate(): void;
}

interface CachedTokenProviderDeps {
  readSync: () => TokenResult;
  readAsync: () => Promise<TokenResult>;
  now: () => number;
  refreshMs: number;
}

export function createCachedTokenProvider(
  deps: Partial<CachedTokenProviderDeps> = {},
): CachedTokenProvider {
  const readSync = deps.readSync ?? readOAuthAccessToken;
  const readAsync = deps.readAsync ?? readOAuthAccessTokenAsync;
  const now = deps.now ?? Date.now;
  const refreshMs = deps.refreshMs ?? DEFAULT_TOKEN_REFRESH_MS;
  let current = readSync();
  let lastReadAt = now();
  let inFlight = false;

  const refresh = (): void => {
    if (inFlight) { return; }
    inFlight = true;
    readAsync()
      .then((result) => { current = result; })
      .catch(() => { /* retain last-known token */ })
      .finally(() => { lastReadAt = now(); inFlight = false; });
  };

  return {
    get: () => {
      if (now() - lastReadAt >= refreshMs) { refresh(); }
      return current;
    },
    invalidate: refresh,
  };
}
