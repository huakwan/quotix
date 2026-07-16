import { TokenResult } from "./oauthSource";
import { execFile, execFileSync } from "child_process";
import { promisify } from "util";
import * as os from "os";

const KEYCHAIN_SERVICE = "Claude Code-credentials";
const DEFAULT_TOKEN_REFRESH_MS = 30_000;

const execFileAsync = promisify(execFile);

export function parseCredentialsBlob(blob: string): TokenResult {
  try {
    const o = JSON.parse(blob) as Record<string, unknown>;
    const oauth = o.claudeAiOauth as Record<string, unknown> | undefined;
    const token = oauth?.accessToken;
    if (typeof token !== "string" || token.length === 0) {
      return { ok: false, reason: "corrupt" };
    }
    return { ok: true, token };
  } catch {
    return { ok: false, reason: "corrupt" };
  }
}

function keychainArgs(): string[] {
  return ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", os.userInfo().username, "-w"];
}

function readKeychainBlobDarwin(): string {
  return execFileSync("security", keychainArgs(), { encoding: "utf8" });
}

async function readKeychainBlobDarwinAsync(): Promise<string> {
  const { stdout } = await execFileAsync("security", keychainArgs(), { encoding: "utf8" });
  return stdout;
}

export interface ReadOAuthAccessTokenDeps {
  platform: NodeJS.Platform;
  readKeychainBlob: () => string;
}

export function readOAuthAccessToken(
  deps: ReadOAuthAccessTokenDeps = { platform: process.platform, readKeychainBlob: readKeychainBlobDarwin },
): TokenResult {
  if (deps.platform !== "darwin") { return { ok: false, reason: "unsupported-platform" }; }
  let blob: string;
  try { blob = deps.readKeychainBlob(); }
  catch { return { ok: false, reason: "keychain-unavailable" }; }
  return parseCredentialsBlob(blob);
}

export interface ReadOAuthAccessTokenAsyncDeps {
  platform: NodeJS.Platform;
  readKeychainBlob: () => Promise<string>;
}

export async function readOAuthAccessTokenAsync(
  deps: ReadOAuthAccessTokenAsyncDeps = { platform: process.platform, readKeychainBlob: readKeychainBlobDarwinAsync },
): Promise<TokenResult> {
  if (deps.platform !== "darwin") { return { ok: false, reason: "unsupported-platform" }; }
  let blob: string;
  try { blob = await deps.readKeychainBlob(); }
  catch { return { ok: false, reason: "keychain-unavailable" }; }
  return parseCredentialsBlob(blob);
}

export interface CachedTokenProviderDeps {
  readSync: () => TokenResult;
  readAsync: () => Promise<TokenResult>;
  now: () => number;
  refreshMs: number;
}

export interface CachedTokenProvider {
  get(): TokenResult;
  invalidate(): void;
}

// Wraps the Keychain read so the poller can call get() every tick without ever
// blocking the event loop: the Keychain is read synchronously once to seed the
// first paint, then refreshed in the background via `security` (execFile, async)
// no more often than refreshMs. Callers always get the last-known token from
// memory, so a corrupt/removed credential surfaces within one refresh window.
export function createCachedTokenProvider(
  deps: Partial<CachedTokenProviderDeps> = {},
): CachedTokenProvider {
  const readSync = deps.readSync ?? (() => readOAuthAccessToken());
  const readAsync = deps.readAsync ?? (() => readOAuthAccessTokenAsync());
  const now = deps.now ?? Date.now;
  const refreshMs = deps.refreshMs ?? DEFAULT_TOKEN_REFRESH_MS;

  let current = readSync();
  let lastReadAt = now();
  let inFlight = false;

  const refresh = (): void => {
    if (inFlight) { return; }
    inFlight = true;
    readAsync()
      .then((r) => { current = r; })
      .catch(() => { /* keep last-known token on a failed refresh */ })
      .finally(() => { lastReadAt = now(); inFlight = false; });
  };

  return {
    get: () => {
      if (now() - lastReadAt >= refreshMs) { refresh(); }
      return current;
    },
    invalidate: () => { refresh(); },
  };
}
