import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

/**
 * Why no usable access token could be produced. Carries no token material, so it
 * is safe to render and to hand to the provider as a diagnostic.
 */
export type CredentialFailure =
  | "unsupported-platform"
  | "not-found"
  | "keychain-unavailable"
  | "corrupt"
  | "expired";

export type TokenResult =
  | { ok: true; token: string }
  | { ok: false; reason: CredentialFailure };

export interface OAuthCredentials {
  accessToken: string;
  expiresAt: number;
}

export type CredentialsResult =
  | { ok: true; creds: OAuthCredentials }
  | { ok: false; reason: CredentialFailure };

const KEYCHAIN_SERVICE_BASE = "Claude Code";
const KEYCHAIN_SERVICE_KIND = "-credentials";
const CREDENTIALS_FILE = ".credentials.json";
const DEFAULT_REREAD_MS = 30_000;
// Treat a token as spent a minute early: a request carrying a token that lapses
// mid-flight comes back 401, which costs a request against a very small budget.
const EXPIRY_SKEW_MS = 60_000;
// security(1) exits 44 (errSecItemNotFound) when the item simply is not there.
// Every other non-zero exit means the read failed — locked keychain, denied ACL,
// missing binary — which is a different problem with a different remedy.
const ITEM_NOT_FOUND_EXIT = 44;
const execFileAsync = promisify(execFile);

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
      creds: {
        accessToken,
        expiresAt: typeof oauth?.expiresAt === "number" ? oauth.expiresAt : 0,
      },
    };
  } catch {
    return { ok: false, reason: "corrupt" };
  }
}

type Env = Record<string, string | undefined>;

// A value the CLI would read as off, so a disabled flag does not send us looking
// for a Keychain item that was never written.
function enabled(value: string | undefined): boolean {
  return value !== undefined && value !== "" && value !== "0" && value !== "false";
}

// The env override is used verbatim, only NFC-normalized, so a decomposed path
// hashes to the same scope the CLI derived from it.
function configDir(env: Env): string {
  return (env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude")).normalize("NFC");
}

// Non-production sign-ins live under their own item; matching the suffix keeps a
// developer's local or custom-endpoint session readable.
function oauthSuffix(env: Env): string {
  if (enabled(env.CLAUDE_CODE_CUSTOM_OAUTH_URL)) { return "-custom-oauth"; }
  if (enabled(env.USE_LOCAL_OAUTH)) { return "-local-oauth"; }
  return "";
}

/**
 * The CLI scopes its Keychain item per config directory, so the service name is
 * only "Claude Code-credentials" for a default install. Hardcoding that name
 * reported "no credentials" to every user who sets CLAUDE_CONFIG_DIR — a signed-in
 * user told to sign in.
 */
export function keychainService(env: Env = process.env): string {
  const secureDir = env.CLAUDE_SECURESTORAGE_CONFIG_DIR;
  // An explicitly empty override means the default dir, which carries no scope.
  const unscoped = secureDir !== undefined ? secureDir === "" : !enabled(env.CLAUDE_CONFIG_DIR);
  const dir = secureDir !== undefined ? secureDir.normalize("NFC") : configDir(env);
  const scope = unscoped ? "" : `-${createHash("sha256").update(dir).digest("hex").slice(0, 8)}`;
  return `${KEYCHAIN_SERVICE_BASE}${oauthSuffix(env)}${KEYCHAIN_SERVICE_KIND}${scope}`;
}

/** Where the CLI keeps the same blob when it cannot use the Keychain. */
export function credentialsFilePath(env: Env = process.env): string {
  const secureDir = env.CLAUDE_SECURESTORAGE_CONFIG_DIR;
  const dir = secureDir !== undefined
    ? (secureDir || path.join(os.homedir(), ".claude")).normalize("NFC")
    : configDir(env);
  return path.join(dir, CREDENTIALS_FILE);
}

// A blob that came back but would not parse is the item the CLI owns; reporting it
// as corrupt is the truth. Only a Keychain with nothing to say defers to the file.
const FILE_FALLBACK_REASONS: ReadonlySet<CredentialFailure> = new Set<CredentialFailure>([
  "not-found",
  "keychain-unavailable",
]);

/**
 * The CLI falls back to a plaintext file when the Keychain is unusable, so a
 * Keychain miss is not proof that no credential exists.
 */
export function withFileFallback(
  keychain: CredentialsResult,
  readFileCreds: () => CredentialsResult | null,
): CredentialsResult {
  if (keychain.ok || !FILE_FALLBACK_REASONS.has(keychain.reason)) { return keychain; }
  const file = readFileCreds();
  return file?.ok ? file : keychain;
}

function keychainArgs(): string[] {
  return ["find-generic-password", "-s", keychainService(), "-a", os.userInfo().username, "-w"];
}

// execFileSync reports the exit status as `status`; promisified execFile puts it in
// `code`, which is a string ("ENOENT") when the binary itself could not be run.
export function failureFromExec(error: unknown): CredentialFailure {
  const value = error as { status?: unknown; code?: unknown } | null;
  const exit = typeof value?.status === "number" ? value.status : value?.code;
  return exit === ITEM_NOT_FOUND_EXIT ? "not-found" : "keychain-unavailable";
}

export function readOAuthCredentials(): CredentialsResult {
  if (process.platform !== "darwin") { return { ok: false, reason: "unsupported-platform" }; }
  let keychain: CredentialsResult;
  try { keychain = parseOAuthCredentials(execFileSync("security", keychainArgs(), { encoding: "utf8" })); }
  catch (error) { keychain = { ok: false, reason: failureFromExec(error) }; }
  return withFileFallback(keychain, () => {
    try { return parseOAuthCredentials(readFileSync(credentialsFilePath(), "utf8")); }
    catch { return null; }
  });
}

export async function readOAuthCredentialsAsync(): Promise<CredentialsResult> {
  if (process.platform !== "darwin") { return { ok: false, reason: "unsupported-platform" }; }
  let keychain: CredentialsResult;
  try {
    const { stdout } = await execFileAsync("security", keychainArgs(), { encoding: "utf8" });
    keychain = parseOAuthCredentials(stdout);
  } catch (error) {
    keychain = { ok: false, reason: failureFromExec(error) };
  }
  if (keychain.ok || !FILE_FALLBACK_REASONS.has(keychain.reason)) { return keychain; }
  const file = await readFile(credentialsFilePath(), "utf8").then(parseOAuthCredentials, () => null);
  return file?.ok ? file : keychain;
}

function toToken(result: CredentialsResult, nowMs: number): TokenResult {
  if (!result.ok) { return { ok: false, reason: result.reason }; }
  // expiresAt 0 means the blob never carried one; let the endpoint be the judge.
  if (result.creds.expiresAt > 0 && nowMs >= result.creds.expiresAt - EXPIRY_SKEW_MS) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, token: result.creds.accessToken };
}

export interface CachedTokenProvider {
  get(): Promise<TokenResult>;
  invalidate(): void;
}

interface CachedTokenProviderDeps {
  readSync: () => CredentialsResult;
  readAsync: () => Promise<CredentialsResult>;
  now: () => number;
  rereadMs: number;
}

/**
 * Observes the credential Claude Code owns: reads the Keychain, never refreshes
 * and never writes it.
 *
 * Refreshing rotates the refresh token inside an item shared with the CLI, so the
 * two race for it, and a rotation that loses has no local recovery — every later
 * refresh is rejected and the app reports a credential error until something else
 * repairs the item. Renewal belongs to the CLI; an expired token is reported as
 * expired, and the next read picks up whatever the CLI wrote.
 */
export function createCachedTokenProvider(
  deps: Partial<CachedTokenProviderDeps> = {},
): CachedTokenProvider {
  const readSync = deps.readSync ?? readOAuthCredentials;
  const readAsync = deps.readAsync ?? readOAuthCredentialsAsync;
  const now = deps.now ?? Date.now;
  const rereadMs = deps.rereadMs ?? DEFAULT_REREAD_MS;

  // Synchronous seed so the first poll of a launch has a token without waiting.
  let current: TokenResult = toToken(readSync(), now());
  let readAtMs = now();
  let inFlight: Promise<void> | null = null;

  const reread = (): Promise<void> => {
    if (inFlight) { return inFlight; }
    inFlight = readAsync()
      .then(
        (result) => { current = toToken(result, now()); },
        () => { /* retain the last known token */ },
      )
      .finally(() => { readAtMs = now(); inFlight = null; });
    return inFlight;
  };

  return {
    // Awaited rather than fire-and-forget: the read is local and cheap, and a
    // stale in-memory failure must not outlive the Keychain item that fixed it.
    async get(): Promise<TokenResult> {
      if (now() - readAtMs >= rereadMs || !current.ok) { await reread(); }
      return current;
    },
    // Cheap: marks the cache stale so the next get() re-reads, rather than
    // spending a read the caller may not need.
    invalidate(): void { readAtMs = Number.NEGATIVE_INFINITY; },
  };
}
