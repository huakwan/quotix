import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

/**
 * Why no usable OpenCode key could be produced. Carries no key material, so it is
 * safe to render in the popover and to hand to the provider as a diagnostic.
 */
export type CredentialFailure = "not-found" | "unreadable" | "corrupt" | "missing-key";

export type TokenResult =
  | { ok: true; token: string }
  | { ok: false; reason: CredentialFailure };

const AUTH_FILE = "auth.json";
const DEFAULT_REREAD_MS = 30_000;

// The OpenCode CLI keeps one document keyed by provider id. Quotix reports OpenCode
// Go's quota, and the Go key is the one the subscription issues, so it is tried
// first; a Zen key belongs to the same account and answers the same usage endpoint.
const PROVIDER_IDS = ["opencode-go", "opencode"] as const;

type Env = Record<string, string | undefined>;

/**
 * Where the CLI stores credentials: `$XDG_DATA_HOME/opencode/auth.json`, matching
 * the CLI's own resolution, with `~/.local/share` as the fallback base.
 */
export function authFilePath(env: Env = process.env, homedir: () => string = os.homedir): string {
  const base = env.XDG_DATA_HOME && env.XDG_DATA_HOME !== ""
    ? env.XDG_DATA_HOME
    : path.join(homedir(), ".local", "share");
  return path.join(base.normalize("NFC"), "opencode", AUTH_FILE);
}

function usableToken(entry: unknown): string | null {
  if (!entry || typeof entry !== "object") { return null; }
  const value = entry as Record<string, unknown>;
  // `key` is what `opencode auth login` writes for an API key; `access` is the
  // access token of an OAuth sign-in, which the CLI owns and renews.
  for (const field of ["key", "access"] as const) {
    const token = value[field];
    if (typeof token === "string" && token.length > 0) { return token; }
  }
  return null;
}

/** Never returns key material on failure — only why there is none. */
export function parseAuthFile(blob: string): TokenResult {
  let value: unknown;
  try { value = JSON.parse(blob); }
  catch { return { ok: false, reason: "corrupt" }; }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "corrupt" };
  }
  const document = value as Record<string, unknown>;
  for (const id of PROVIDER_IDS) {
    const token = usableToken(document[id]);
    if (token) { return { ok: true, token }; }
  }
  return { ok: false, reason: "missing-key" };
}

function readFailure(error: unknown): CredentialFailure {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code === "ENOENT") { return "not-found"; }
  return code === undefined ? "corrupt" : "unreadable";
}

export function readAuthFile(file = authFilePath()): TokenResult {
  try { return parseAuthFile(readFileSync(file, "utf8")); }
  catch (error) { return { ok: false, reason: readFailure(error) }; }
}

export async function readAuthFileAsync(file = authFilePath()): Promise<TokenResult> {
  try { return parseAuthFile(await readFile(file, "utf8")); }
  catch (error) { return { ok: false, reason: readFailure(error) }; }
}

export interface OpenCodeKeyProvider {
  get(): Promise<TokenResult>;
  invalidate(): void;
}

interface CachedKeyProviderDeps {
  readSync: () => TokenResult;
  readAsync: () => Promise<TokenResult>;
  now: () => number;
  rereadMs: number;
}

/**
 * Observes the credential the OpenCode CLI owns: reads auth.json, and never writes
 * or renews anything. Keys do not expire, so the only way this goes stale is the
 * user editing the file or logging out — both picked up by the next read.
 */
export function createCachedKeyProvider(
  deps: Partial<CachedKeyProviderDeps> = {},
): OpenCodeKeyProvider {
  const readSync = deps.readSync ?? readAuthFile;
  const readAsync = deps.readAsync ?? readAuthFileAsync;
  const now = deps.now ?? Date.now;
  const rereadMs = deps.rereadMs ?? DEFAULT_REREAD_MS;

  // Synchronous seed so the first poll of a launch has a key without waiting.
  let current: TokenResult = readSync();
  let readAtMs = now();
  let inFlight: Promise<void> | null = null;

  const reread = (): Promise<void> => {
    if (inFlight) { return inFlight; }
    inFlight = readAsync()
      .then(
        (result) => { current = result; },
        () => { /* retain the last known result */ },
      )
      .finally(() => { readAtMs = now(); inFlight = null; });
    return inFlight;
  };

  return {
    async get(): Promise<TokenResult> {
      if (now() - readAtMs >= rereadMs || !current.ok) { await reread(); }
      return current;
    },
    // A rejected key is usually one the CLI has since rewritten, so drop the
    // cached value and let the next read go back to the file.
    invalidate(): void { readAtMs = Number.NEGATIVE_INFINITY; },
  };
}
