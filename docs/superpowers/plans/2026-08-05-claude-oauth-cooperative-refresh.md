# Cooperative Claude OAuth Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Quotix renew the Claude OAuth access token itself without ever losing a refresh-token rotation race against the Claude Code CLI.

**Architecture:** Quotix stops being a pure observer and becomes a *second cooperating participant* in the exact protocol the CLI already uses: it takes the CLI's own `.oauth_refresh.lock` (same path, same `proper-lockfile` options), re-reads the credential under that lock and aborts if the access token changed (compare-and-swap), calls the same token endpoint, and writes the item back through `security -i` on stdin so the token never appears in `argv`. A refresh token that the server rejects is recorded as dead so it is never replayed. Refresh happens on demand only — when Quotix would otherwise report `expired` or has just been handed a 401 — never on a schedule.

**Tech Stack:** TypeScript, Electron (macOS only), Node's built-in test runner, `security(1)` CLI, `proper-lockfile` (new dependency), Anthropic OAuth token endpoint.

## Global Constraints

- macOS only. Every credential path already returns `unsupported-platform` off darwin; keep that.
- Never log, print, or persist an access token, a refresh token, or raw Keychain output. Diagnostics carry reasons, never token material.
- The raw credential blob may be held only inside a single function call during read-modify-write. Never cache it, never put it on an object that outlives the call, never include it in an error message.
- Cache only normalized quota fields (unchanged from today).
- Each credential failure reason keeps its own distinct message. Never collapse reasons into one.
- Preserve today's behaviour: synchronous startup seed, async re-read, 401 invalidation, per-reason diagnostics.
- Tests are Node's built-in runner. Production TypeScript is emitted to `out/` first (`pnpm test` runs `tsc --outDir out && node --test tests/*.test.mjs`), so tests import from `../out/src/...`.
- `pnpm run typecheck` and `pnpm test` must both pass at the end of every task.
- Commit messages: no `Co-Authored-By`, no `Signed-off-by`, no `Generated-by`, no AI attribution, no extra trailing lines.

## Reverse-Engineered Protocol (source of truth for this plan)

Extracted from the Claude Code native binary, version 2.1.222. Every constant below is used verbatim in the tasks.

**Token endpoint**

```
POST https://platform.claude.com/v1/oauth/token
Content-Type: application/json

{
  "grant_type": "refresh_token",
  "refresh_token": "<stored refresh token>",
  "client_id": "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
  "scope": "user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload"
}
```

Response on 200: `{ access_token, refresh_token?, expires_in, refresh_token_expires_in?, scope }`.
**`refresh_token` is optional in the response** — when absent, the existing refresh token remains valid. This is why the race is survivable at all: rotation is not guaranteed on every refresh.

Anything other than 200 is a failure; the CLI raises `Token refresh failed: <statusText>`.

**Cross-process lock** — `<dir>/.oauth_refresh.lock` where `dir` is the same directory `credentialsFilePath()` is built from (`CLAUDE_SECURESTORAGE_CONFIG_DIR` if defined, else the config dir). `proper-lockfile` options: `{ realpath: false, stale: 60000, update: 5000 }`. A second *legacy* lock is taken at `` `${realpath(dir)}.lock` ``. On `ELOCKED` the CLI waits `1000 + random() * 1000` ms and retries, at most 5 retries, then gives up with a lock-timeout outcome.

**Keychain write** — the payload is hex-encoded and the command string is fed to `security -i` on **stdin**:

```
add-generic-password -U -a "<account>" -s "<service>" -X "<hex payload>"
```

The CLI only falls back to passing those as `argv` when the payload exceeds the stdin limit, and logs a warning when it does. Keep the stdin path primary: `argv` is world-readable via `ps`.

**CAS sequence the CLI itself follows** — read; skip if no refresh needed; clear cache and re-read; if the access token changed, someone else already refreshed, so adopt it and stop; take the lock; re-read under the lock and check again; POST; write back. A refresh token that fails is added to a known-dead set and never retried.

**Why there is no "is the CLI idle?" gate.** The original sketch for this work guarded refreshes on the CLI looking inactive — refresh only if the token has been expired a while and `expiresAt` has not moved recently. That heuristic exists to avoid a race, and the lock plus the CAS check removes the race directly: whoever holds the lock reads last and the loser adopts the winner's token. Adding an activity heuristic on top would only delay legitimate refreshes and give two mechanisms to reason about. The gate that remains is narrower and is about cost, not correctness: refresh only when a token is actually within the expiry margin, and only when something asked for a token.

## File Structure

| File | Responsibility |
|---|---|
| `src/quota/claude/credentials.ts` (modify) | Add a raw-blob read used only by the refresh path. Existing normalized API unchanged. |
| `src/quota/claude/refreshLock.ts` (create) | Acquire and release the CLI-compatible lock pair, with the CLI's retry policy. Knows nothing about tokens. |
| `src/quota/claude/keychainWrite.ts` (create) | Write a blob to the Keychain item via `security -i` stdin, with the argv fallback. |
| `src/quota/claude/refreshRequest.ts` (create) | The HTTP call and response mapping. Pure given a `fetch` implementation. |
| `src/quota/claude/refresh.ts` (create) | Orchestration: gate, CAS, lock, write-back, dead-token set. The only module that holds a raw blob. |
| `src/quota/claude/provider.ts` (modify) | Ask for a refresh on `expired` and on a 401 that a re-read did not resolve. |
| `src/main.ts` (modify) | Wire the refresher into the cached token provider. |
| `tests/credentials.test.mjs` (modify) | Raw-blob read coverage. |
| `tests/claudeRefreshLock.test.mjs` (create) | Lock options, retry, release ordering. |
| `tests/claudeKeychainWrite.test.mjs` (create) | Command construction, hex payload, stdin-vs-argv choice. |
| `tests/claudeRefresh.test.mjs` (create) | Request shape and the whole CAS orchestration. |
| `tests/claudeProvider.test.mjs` (modify) | Provider-level refresh triggering. |
| `CLAUDE.md` (modify) | The documented "never refreshes, never writes" invariant is being replaced and must be rewritten. |

---

### Task 1: Raw credential blob read

The refresh path must write back every field the CLI owns (`subscriptionType`, `rateLimitTier`, `refreshTokenExpiresAt`, anything added in a future CLI release). That means reading the whole blob, not the two normalized fields. This lives beside the existing reader so the storage-location logic — Keychain service name, plaintext fallback — is not duplicated.

**Files:**
- Modify: `src/quota/claude/credentials.ts`
- Test: `tests/credentials.test.mjs`

**Interfaces:**
- Consumes: `keychainService()`, `credentialsFilePath()`, `withFileFallback()`, `failureFromExec()`, `CredentialFailure` — all already exported from `credentials.ts`.
- Produces:
  - `type RefreshableCredentials = { accessToken: string; refreshToken: string | null; expiresAt: number; scopes: string[]; subscriptionType: string | null }`
  - `type BlobResult = { ok: true; blob: string; creds: RefreshableCredentials } | { ok: false; reason: CredentialFailure }`
  - `parseRefreshableCredentials(blob: string): BlobResult`
  - `readOAuthBlobAsync(): Promise<BlobResult>`

- [ ] **Step 1: Write the failing test**

Add to `tests/credentials.test.mjs`. Import `parseRefreshableCredentials` alongside the existing imports.

```javascript
test("parseRefreshableCredentials exposes the fields a refresh needs, plus the raw blob", () => {
  const result = parseRefreshableCredentials(BLOB);
  assert.equal(result.ok, true);
  assert.deepEqual(result.creds, {
    accessToken: "old-access",
    refreshToken: "old-refresh",
    expiresAt: 1_000_000,
    scopes: ["user:inference"],
    subscriptionType: "team",
  });
  // The blob is carried verbatim so a write-back preserves fields we do not model.
  assert.equal(result.blob, BLOB);
});

test("parseRefreshableCredentials reports a blob with no refresh token rather than failing", () => {
  const result = parseRefreshableCredentials(blobWith({ expiresAt: 5 }));
  assert.equal(result.ok, true);
  assert.equal(result.creds.refreshToken, null);
  assert.deepEqual(result.creds.scopes, []);
  assert.equal(result.creds.subscriptionType, null);
});

test("parseRefreshableCredentials rejects the same blobs the normalized parser rejects", () => {
  assert.deepEqual(parseRefreshableCredentials("not json"), { ok: false, reason: "corrupt" });
  assert.deepEqual(
    parseRefreshableCredentials(JSON.stringify({ claudeAiOauth: { refreshToken: "x" } })),
    { ok: false, reason: "corrupt" },
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test 2>&1 | grep -A3 'parseRefreshableCredentials'`
Expected: FAIL — `parseRefreshableCredentials is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `src/quota/claude/credentials.ts`, after `parseOAuthCredentials`:

```typescript
/**
 * Everything a refresh needs, plus the blob it came from. The blob is carried so a
 * write-back can preserve fields the CLI owns and Quotix does not model; it must
 * never be cached, logged, or attached to an error.
 */
export interface RefreshableCredentials {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  scopes: string[];
  subscriptionType: string | null;
}

export type BlobResult =
  | { ok: true; blob: string; creds: RefreshableCredentials }
  | { ok: false; reason: CredentialFailure };

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function parseRefreshableCredentials(blob: string): BlobResult {
  const normalized = parseOAuthCredentials(blob);
  if (!normalized.ok) { return { ok: false, reason: normalized.reason }; }
  const oauth = (JSON.parse(blob) as Record<string, unknown>).claudeAiOauth as Record<string, unknown>;
  return {
    ok: true,
    blob,
    creds: {
      accessToken: normalized.creds.accessToken,
      expiresAt: normalized.creds.expiresAt,
      refreshToken: typeof oauth.refreshToken === "string" && oauth.refreshToken.length > 0
        ? oauth.refreshToken
        : null,
      scopes: stringArray(oauth.scopes),
      subscriptionType: typeof oauth.subscriptionType === "string" ? oauth.subscriptionType : null,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test 2>&1 | tail -8`
Expected: PASS, total count up by 3, 0 fail.

- [ ] **Step 5: Write the failing test for the async blob read**

```javascript
test("readOAuthBlobAsync falls back to the file the same way the normalized read does", async () => {
  const result = await readOAuthBlobAsync({
    readKeychain: async () => { throw Object.assign(new Error("nope"), { code: 44 }); },
    readFileText: async () => blobWith({ refreshToken: "from-file", expiresAt: 9_000_000 }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.creds.refreshToken, "from-file");
});

test("readOAuthBlobAsync keeps the keychain reason when the file cannot stand in", async () => {
  const result = await readOAuthBlobAsync({
    readKeychain: async () => { throw Object.assign(new Error("locked"), { code: 36 }); },
    readFileText: async () => { throw new Error("ENOENT"); },
  });
  assert.deepEqual(result, { ok: false, reason: "keychain-unavailable" });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm test 2>&1 | grep -A3 'readOAuthBlobAsync'`
Expected: FAIL — `readOAuthBlobAsync is not a function`.

- [ ] **Step 7: Implement the async blob read**

```typescript
interface BlobReadDeps {
  readKeychain: () => Promise<string>;
  readFileText: () => Promise<string>;
}

export async function readOAuthBlobAsync(deps: Partial<BlobReadDeps> = {}): Promise<BlobResult> {
  if (process.platform !== "darwin") { return { ok: false, reason: "unsupported-platform" }; }
  const readKeychain = deps.readKeychain
    ?? (async () => (await execFileAsync("security", keychainArgs(), { encoding: "utf8" })).stdout);
  const readFileText = deps.readFileText ?? (() => readFile(credentialsFilePath(), "utf8"));

  let keychain: BlobResult;
  try { keychain = parseRefreshableCredentials(await readKeychain()); }
  catch (error) { keychain = { ok: false, reason: failureFromExec(error) }; }
  if (keychain.ok || !FILE_FALLBACK_REASONS.has(keychain.reason)) { return keychain; }

  const file = await readFileText().then(parseRefreshableCredentials, () => null);
  return file?.ok ? file : keychain;
}
```

- [ ] **Step 8: Run tests and typecheck**

Run: `pnpm run typecheck && pnpm test 2>&1 | tail -8`
Expected: typecheck silent, tests PASS with 0 fail.

- [ ] **Step 9: Commit**

```bash
git add src/quota/claude/credentials.ts tests/credentials.test.mjs
git commit -m "feat: read the full Claude credential blob for refresh"
```

---

### Task 2: CLI-compatible refresh lock

Mutual exclusion only works if both processes use the same lock file with the same semantics. `proper-lockfile` creates the lock as a directory and touches its mtime on an interval; hand-rolling that risks a lock that looks held to us and free to the CLI. Take the dependency instead.

**Files:**
- Create: `src/quota/claude/refreshLock.ts`
- Modify: `package.json`
- Test: `tests/claudeRefreshLock.test.mjs`

**Interfaces:**
- Consumes: `credentialsFilePath()` from `credentials.ts` — the lock lives in that file's directory.
- Produces:
  - `type LockRelease = () => Promise<void>`
  - `lockOptionsFor(dir: string, onCompromised: (error: Error) => void): { lockfilePath: string; realpath: false; stale: 60000; update: 5000; onCompromised: (error: Error) => void }`
  - `acquireRefreshLock(deps?: Partial<RefreshLockDeps>): Promise<LockRelease | "contended">`
  - `interface RefreshLockDeps { dir: string; lock: (path: string, options: unknown) => Promise<LockRelease>; realpath: (path: string) => Promise<string>; sleep: (ms: number) => Promise<void>; random: () => number; maxRetries: number }`

- [ ] **Step 1: Add the dependency**

```bash
pnpm add proper-lockfile
pnpm add -D @types/proper-lockfile
```

- [ ] **Step 2: Write the failing test**

Create `tests/claudeRefreshLock.test.mjs`:

```javascript
import assert from "node:assert/strict";
import test from "node:test";
import * as path from "node:path";

import { acquireRefreshLock, lockOptionsFor } from "../out/src/quota/claude/refreshLock.js";

const noop = () => {};

test("lock options match the CLI's exactly", () => {
  const options = lockOptionsFor("/tmp/cc", noop);
  assert.equal(options.lockfilePath, path.join("/tmp/cc", ".oauth_refresh.lock"));
  assert.equal(options.realpath, false);
  assert.equal(options.stale, 60_000);
  assert.equal(options.update, 5_000);
});

test("both the current and the legacy lock are taken, and released newest first", async () => {
  const taken = [];
  const released = [];
  const release = await acquireRefreshLock({
    dir: "/tmp/cc",
    realpath: async (p) => p,
    lock: async (target, options) => {
      taken.push(options.lockfilePath);
      return async () => { released.push(options.lockfilePath); };
    },
  });

  assert.deepEqual(taken, [path.join("/tmp/cc", ".oauth_refresh.lock"), "/tmp/cc.lock"]);
  await release();
  assert.deepEqual(released, ["/tmp/cc.lock", path.join("/tmp/cc", ".oauth_refresh.lock")]);
});

test("a contended lock is retried with jittered backoff, then reported as contended", async () => {
  const waits = [];
  const result = await acquireRefreshLock({
    dir: "/tmp/cc",
    realpath: async (p) => p,
    lock: async () => { throw Object.assign(new Error("held"), { code: "ELOCKED" }); },
    sleep: async (ms) => { waits.push(ms); },
    random: () => 0.5,
    maxRetries: 5,
  });

  assert.equal(result, "contended");
  // The CLI waits 1000 + random()*1000 between attempts and gives up after 5 retries.
  assert.deepEqual(waits, [1500, 1500, 1500, 1500, 1500]);
});

test("a legacy lock held elsewhere releases the lock we already took", async () => {
  const released = [];
  const result = await acquireRefreshLock({
    dir: "/tmp/cc",
    realpath: async (p) => p,
    lock: async (target, options) => {
      if (options.lockfilePath === "/tmp/cc.lock") {
        throw Object.assign(new Error("held"), { code: "ELOCKED" });
      }
      return async () => { released.push(options.lockfilePath); };
    },
    sleep: async () => {},
    random: () => 0,
    maxRetries: 0,
  });

  assert.equal(result, "contended");
  assert.deepEqual(released, [path.join("/tmp/cc", ".oauth_refresh.lock")], "no lock may be left behind");
});

test("a non-ELOCKED failure is not swallowed", async () => {
  await assert.rejects(
    acquireRefreshLock({
      dir: "/tmp/cc",
      realpath: async (p) => p,
      lock: async () => { throw Object.assign(new Error("disk gone"), { code: "EIO" }); },
    }),
    /disk gone/,
  );
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test 2>&1 | grep -iE 'refreshLock|Cannot find module'`
Expected: FAIL — cannot find `../out/src/quota/claude/refreshLock.js`.

- [ ] **Step 4: Write the implementation**

Create `src/quota/claude/refreshLock.ts`:

```typescript
import { realpath as realpathAsync } from "node:fs/promises";
import * as path from "node:path";
import { lock } from "proper-lockfile";

import { credentialsFilePath } from "./credentials";

const LOCK_FILE = ".oauth_refresh.lock";
// The CLI's values. A lock the CLI would consider stale, or refresh on a different
// interval, is not mutual exclusion — these must match exactly.
const STALE_MS = 60_000;
const UPDATE_MS = 5_000;
const MAX_RETRIES = 5;

export type LockRelease = () => Promise<void>;

export interface RefreshLockDeps {
  dir: string;
  lock: (target: string, options: unknown) => Promise<LockRelease>;
  realpath: (target: string) => Promise<string>;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
  maxRetries: number;
}

export function lockOptionsFor(dir: string, onCompromised: (error: Error) => void) {
  return {
    lockfilePath: path.join(dir, LOCK_FILE),
    realpath: false as const,
    stale: STALE_MS,
    update: UPDATE_MS,
    onCompromised,
  };
}

const isLocked = (error: unknown): boolean =>
  (error as { code?: unknown } | null)?.code === "ELOCKED";

/**
 * Takes the same lock pair the Claude Code CLI takes before refreshing: the current
 * lock inside the credential directory and the legacy lock beside it. Returns
 * "contended" when another process held it for the whole retry budget — the caller
 * must then leave the credential alone rather than refresh anyway.
 */
export async function acquireRefreshLock(
  deps: Partial<RefreshLockDeps> = {},
): Promise<LockRelease | "contended"> {
  const dir = deps.dir ?? path.dirname(credentialsFilePath());
  const take = deps.lock ?? lock;
  const resolve = deps.realpath ?? realpathAsync;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = deps.random ?? Math.random;
  const maxRetries = deps.maxRetries ?? MAX_RETRIES;

  // A compromised lock means our hold lapsed while we still thought we had it. There
  // is nothing to recover locally; abandoning the refresh is the safe outcome.
  let compromised = false;
  const options = lockOptionsFor(dir, () => { compromised = true; });
  const legacyPath = `${await resolve(dir).catch(() => dir)}.lock`;

  for (let attempt = 0; ; attempt += 1) {
    let releaseCurrent: LockRelease;
    try { releaseCurrent = await take(dir, options); }
    catch (error) {
      if (!isLocked(error)) { throw error; }
      if (attempt >= maxRetries) { return "contended"; }
      await sleep(1000 + random() * 1000);
      continue;
    }

    let releaseLegacy: LockRelease;
    try { releaseLegacy = await take(legacyPath, { ...options, lockfilePath: legacyPath }); }
    catch (error) {
      await releaseCurrent().catch(() => {});
      if (!isLocked(error)) { throw error; }
      if (attempt >= maxRetries) { return "contended"; }
      await sleep(1000 + random() * 1000);
      continue;
    }

    return async () => {
      await releaseLegacy().catch(() => {});
      await releaseCurrent().catch(() => {});
      if (compromised) { throw new Error("refresh lock was compromised"); }
    };
  }
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm run typecheck && pnpm test 2>&1 | tail -8`
Expected: typecheck silent, tests PASS with 0 fail.

- [ ] **Step 6: Verify the lock actually blocks a second holder**

Run:

```bash
node -e '
const { acquireRefreshLock } = require("./out/src/quota/claude/refreshLock.js");
(async () => {
  const dir = require("fs").mkdtempSync("/tmp/qx-lock-");
  const first = await acquireRefreshLock({ dir, maxRetries: 0 });
  console.log("first:", typeof first === "function" ? "held" : first);
  const second = await acquireRefreshLock({ dir, maxRetries: 0, sleep: async () => {} });
  console.log("second:", typeof second === "function" ? "held" : second);
  await first();
  const third = await acquireRefreshLock({ dir, maxRetries: 0 });
  console.log("after release:", typeof third === "function" ? "held" : third);
  await third();
})();'
```

Expected output:

```
first: held
second: contended
after release: held
```

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml src/quota/claude/refreshLock.ts tests/claudeRefreshLock.test.mjs
git commit -m "feat: take the Claude CLI's oauth refresh lock"
```

---

### Task 3: Keychain write via stdin

`security add-generic-password` with the payload in `argv` exposes the token to any process that can run `ps`. The CLI avoids that by feeding the command to `security -i` on stdin and only falls back to `argv` for payloads too large for stdin. Match that, including the fallback, because a blob that grows past the limit must still be written rather than silently dropped.

**Files:**
- Create: `src/quota/claude/keychainWrite.ts`
- Test: `tests/claudeKeychainWrite.test.mjs`

**Interfaces:**
- Consumes: `keychainService()` from `credentials.ts`.
- Produces:
  - `type WriteOutcome = { ok: true } | { ok: false; transient: boolean }`
  - `writeKeychainBlob(blob: string, deps?: Partial<KeychainWriteDeps>): Promise<WriteOutcome>`
  - `interface KeychainWriteDeps { service: string; account: string; runStdin: (input: string) => Promise<number>; runArgv: (args: string[]) => Promise<number>; stdinLimit: number }`

- [ ] **Step 1: Write the failing test**

Create `tests/claudeKeychainWrite.test.mjs`:

```javascript
import assert from "node:assert/strict";
import test from "node:test";

import { writeKeychainBlob } from "../out/src/quota/claude/keychainWrite.js";

const BLOB = JSON.stringify({ claudeAiOauth: { accessToken: "secret-token" } });
const HEX = Buffer.from(BLOB, "utf-8").toString("hex");

test("the payload goes over stdin, never over argv", async () => {
  let stdinInput = null;
  let argvCalls = 0;
  const result = await writeKeychainBlob(BLOB, {
    service: "Claude Code-credentials",
    account: "someone",
    runStdin: async (input) => { stdinInput = input; return 0; },
    runArgv: async () => { argvCalls += 1; return 0; },
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(argvCalls, 0);
  assert.equal(
    stdinInput,
    `add-generic-password -U -a "someone" -s "Claude Code-credentials" -X "${HEX}"\n`,
  );
  // The token must never appear in plaintext in the command we build.
  assert.equal(stdinInput.includes("secret-token"), false);
});

test("a payload past the stdin limit falls back to argv rather than failing", async () => {
  let argvArgs = null;
  const result = await writeKeychainBlob(BLOB, {
    service: "svc",
    account: "someone",
    stdinLimit: 10,
    runStdin: async () => { throw new Error("must not use stdin"); },
    runArgv: async (args) => { argvArgs = args; return 0; },
  });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(argvArgs, ["add-generic-password", "-U", "-a", "someone", "-s", "svc", "-X", HEX]);
});

test("a non-zero exit is a failure and says whether retrying could help", async () => {
  const failed = await writeKeychainBlob(BLOB, {
    service: "svc",
    account: "someone",
    runStdin: async () => 1,
  });
  assert.deepEqual(failed, { ok: false, transient: false });

  const threw = await writeKeychainBlob(BLOB, {
    service: "svc",
    account: "someone",
    runStdin: async () => { throw Object.assign(new Error("timed out"), { killed: true }); },
  });
  assert.deepEqual(threw, { ok: false, transient: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test 2>&1 | grep -iE 'keychainWrite|Cannot find module'`
Expected: FAIL — cannot find `../out/src/quota/claude/keychainWrite.js`.

- [ ] **Step 3: Write the implementation**

Create `src/quota/claude/keychainWrite.ts`:

```typescript
import { execFile } from "node:child_process";
import * as os from "node:os";

import { keychainService } from "./credentials";

// The CLI's threshold for what it will push through `security -i`. Past this it uses
// argv, which is world-readable via ps — so this is a last resort, not a shortcut.
const STDIN_LIMIT = 4032;
const TIMEOUT_MS = 2000;

export type WriteOutcome = { ok: true } | { ok: false; transient: boolean };

export interface KeychainWriteDeps {
  service: string;
  account: string;
  runStdin: (input: string) => Promise<number>;
  runArgv: (args: string[]) => Promise<number>;
  stdinLimit: number;
}

function run(args: string[], input?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = execFile("security", args, { encoding: "utf8", timeout: TIMEOUT_MS }, (error) => {
      if (error) { reject(error); return; }
      resolve(0);
    });
    if (input !== undefined) { child.stdin?.end(input); }
  });
}

/**
 * Writes the credential blob back to the item the Claude Code CLI owns. Callers must
 * hold the refresh lock and must have re-read the item under it; this function does
 * no checking of its own.
 */
export async function writeKeychainBlob(
  blob: string,
  deps: Partial<KeychainWriteDeps> = {},
): Promise<WriteOutcome> {
  const service = deps.service ?? keychainService();
  const account = deps.account ?? os.userInfo().username;
  const runStdin = deps.runStdin ?? ((input: string) => run(["-i"], input));
  const runArgv = deps.runArgv ?? ((args: string[]) => run(args));
  const stdinLimit = deps.stdinLimit ?? STDIN_LIMIT;

  const hex = Buffer.from(blob, "utf-8").toString("hex");
  const args = ["add-generic-password", "-U", "-a", account, "-s", service, "-X", hex];

  try {
    const code = hex.length <= stdinLimit
      ? await runStdin(`add-generic-password -U -a "${account}" -s "${service}" -X "${hex}"\n`)
      : await runArgv(args);
    return code === 0 ? { ok: true } : { ok: false, transient: false };
  } catch (error) {
    // A timeout may succeed on the next attempt; anything else will not.
    const killed = (error as { killed?: unknown } | null)?.killed === true;
    return { ok: false, transient: killed };
  }
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm run typecheck && pnpm test 2>&1 | tail -8`
Expected: typecheck silent, tests PASS with 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/quota/claude/keychainWrite.ts tests/claudeKeychainWrite.test.mjs
git commit -m "feat: write the Claude credential item over security stdin"
```

---

### Task 4: The refresh request

**Files:**
- Create: `src/quota/claude/refreshRequest.ts`
- Test: `tests/claudeRefresh.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `type RefreshFailure = "http" | "network" | "malformed"`
  - `type RefreshResult = { ok: true; accessToken: string; refreshToken: string | null; expiresAt: number; refreshTokenExpiresAt: number | null; scopes: string[] } | { ok: false; reason: RefreshFailure; status?: number }`
  - `requestRefresh(refreshToken: string, scopes: string[], deps?: Partial<RefreshRequestDeps>): Promise<RefreshResult>`
  - `interface RefreshRequestDeps { fetchImpl: (url: string, init?: RequestInit) => Promise<Response>; nowMs: () => number }`

- [ ] **Step 1: Write the failing test**

Create `tests/claudeRefresh.test.mjs`:

```javascript
import assert from "node:assert/strict";
import test from "node:test";

import { requestRefresh } from "../out/src/quota/claude/refreshRequest.js";

const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const DEFAULT_SCOPES =
  "user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";

function okResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

test("the refresh request matches the CLI's contract", async () => {
  let seenUrl = null;
  let seenInit = null;
  await requestRefresh("the-refresh-token", ["user:profile", "user:inference"], {
    fetchImpl: async (url, init) => {
      seenUrl = url;
      seenInit = init;
      return okResponse({ access_token: "new", expires_in: 3600, scope: "user:profile" });
    },
    nowMs: () => 0,
  });

  assert.equal(seenUrl, "https://platform.claude.com/v1/oauth/token");
  assert.equal(seenInit.method, "POST");
  assert.equal(seenInit.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(seenInit.body), {
    grant_type: "refresh_token",
    refresh_token: "the-refresh-token",
    client_id: CLIENT_ID,
    scope: "user:profile user:inference",
  });
});

test("stored scopes are used when present and the CLI's set when not", async () => {
  let body = null;
  await requestRefresh("t", [], {
    fetchImpl: async (url, init) => {
      body = JSON.parse(init.body);
      return okResponse({ access_token: "new", expires_in: 60, scope: DEFAULT_SCOPES });
    },
    nowMs: () => 0,
  });
  assert.equal(body.scope, DEFAULT_SCOPES);
});

test("a response without a refresh token means the old one is still good", async () => {
  const result = await requestRefresh("t", [], {
    fetchImpl: async () => okResponse({ access_token: "new", expires_in: 3600, scope: "user:profile" }),
    nowMs: () => 1_000,
  });

  assert.deepEqual(result, {
    ok: true,
    accessToken: "new",
    refreshToken: null,
    expiresAt: 1_000 + 3_600_000,
    refreshTokenExpiresAt: null,
    scopes: ["user:profile"],
  });
});

test("a rotated refresh token and its expiry are both reported", async () => {
  const result = await requestRefresh("t", [], {
    fetchImpl: async () => okResponse({
      access_token: "new",
      refresh_token: "rotated",
      expires_in: 10,
      refresh_token_expires_in: 20,
      scope: "user:inference",
    }),
    nowMs: () => 0,
  });

  assert.equal(result.refreshToken, "rotated");
  assert.equal(result.refreshTokenExpiresAt, 20_000);
});

test("failures are told apart by kind", async () => {
  const http = await requestRefresh("t", [], {
    fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({}) }),
  });
  assert.deepEqual(http, { ok: false, reason: "http", status: 400 });

  const network = await requestRefresh("t", [], {
    fetchImpl: async () => { throw new Error("offline"); },
  });
  assert.deepEqual(network, { ok: false, reason: "network" });

  const malformed = await requestRefresh("t", [], {
    fetchImpl: async () => okResponse({ expires_in: 60 }),
  });
  assert.deepEqual(malformed, { ok: false, reason: "malformed" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test 2>&1 | grep -iE 'refreshRequest|Cannot find module'`
Expected: FAIL — cannot find `../out/src/quota/claude/refreshRequest.js`.

- [ ] **Step 3: Write the implementation**

Create `src/quota/claude/refreshRequest.ts`:

```typescript
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const REQUEST_TIMEOUT_MS = 30_000;
// The scope set the CLI asks for when the stored credential does not name one.
const DEFAULT_SCOPES = [
  "user:profile",
  "user:inference",
  "user:sessions:claude_code",
  "user:mcp_servers",
  "user:file_upload",
];

export type RefreshFailure = "http" | "network" | "malformed";

export type RefreshResult =
  | {
      ok: true;
      accessToken: string;
      refreshToken: string | null;
      expiresAt: number;
      refreshTokenExpiresAt: number | null;
      scopes: string[];
    }
  | { ok: false; reason: RefreshFailure; status?: number };

export interface RefreshRequestDeps {
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;
  nowMs: () => number;
}

/**
 * Exchanges a refresh token for a new access token. Asks for the scopes the stored
 * credential already carries so a refresh never quietly narrows what the CLI can do —
 * dropping user:profile, for instance, would cost both of us the usage endpoint.
 */
export async function requestRefresh(
  refreshToken: string,
  scopes: string[],
  deps: Partial<RefreshRequestDeps> = {},
): Promise<RefreshResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const nowMs = deps.nowMs ?? Date.now;

  let response: Response;
  try {
    response = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
        scope: (scopes.length > 0 ? scopes : DEFAULT_SCOPES).join(" "),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: "network" };
  }

  if (!response.ok) { return { ok: false, reason: "http", status: response.status }; }

  let body: Record<string, unknown>;
  try { body = (await response.json()) as Record<string, unknown>; }
  catch { return { ok: false, reason: "malformed" }; }

  const accessToken = body.access_token;
  const expiresIn = body.expires_in;
  if (typeof accessToken !== "string" || accessToken.length === 0 || typeof expiresIn !== "number") {
    return { ok: false, reason: "malformed" };
  }
  const refreshTokenExpiresIn = body.refresh_token_expires_in;
  return {
    ok: true,
    accessToken,
    refreshToken: typeof body.refresh_token === "string" && body.refresh_token.length > 0
      ? body.refresh_token
      : null,
    expiresAt: nowMs() + expiresIn * 1000,
    refreshTokenExpiresAt: typeof refreshTokenExpiresIn === "number"
      ? nowMs() + refreshTokenExpiresIn * 1000
      : null,
    scopes: typeof body.scope === "string" ? body.scope.split(" ").filter(Boolean) : [],
  };
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm run typecheck && pnpm test 2>&1 | tail -8`
Expected: typecheck silent, tests PASS with 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/quota/claude/refreshRequest.ts tests/claudeRefresh.test.mjs
git commit -m "feat: add the Claude oauth refresh request"
```

---

### Task 5: Cooperative refresh orchestration

This is the task that actually resolves the race. Everything here mirrors the CLI's own sequence, because two processes running the same protocol cannot lose to each other in a way neither can recover from.

**Files:**
- Create: `src/quota/claude/refresh.ts`
- Test: `tests/claudeRefresh.test.mjs` (extend)

**Interfaces:**
- Consumes: `readOAuthBlobAsync()`, `parseRefreshableCredentials()`, `BlobResult` (Task 1); `acquireRefreshLock()`, `LockRelease` (Task 2); `writeKeychainBlob()` (Task 3); `requestRefresh()` (Task 4).
- Produces:
  - `type RefreshOutcome = "refreshed" | "adopted" | "not-needed" | "no-refresh-token" | "contended" | "dead-refresh-token" | "request-failed" | "write-failed" | "unreadable"`
  - `createRefresher(deps?: Partial<RefresherDeps>): { run(): Promise<RefreshOutcome> }`
  - `interface RefresherDeps { readBlob: () => Promise<BlobResult>; acquireLock: () => Promise<LockRelease | "contended">; request: typeof requestRefresh; write: (blob: string) => Promise<{ ok: boolean }>; nowMs: () => number; marginMs: number }`
  - `mergeRefreshedBlob(blob: string, refreshed: RefreshResult & { ok: true }, previousRefreshToken: string): string`

- [ ] **Step 1: Write the failing test for the blob merge**

Add to `tests/claudeRefresh.test.mjs`:

```javascript
import { createRefresher, mergeRefreshedBlob } from "../out/src/quota/claude/refresh.js";

const FULL_BLOB = JSON.stringify({
  claudeAiOauth: {
    accessToken: "old-access",
    refreshToken: "old-refresh",
    expiresAt: 1_000,
    refreshTokenExpiresAt: 2_000,
    scopes: ["user:profile", "user:inference"],
    subscriptionType: "team",
    rateLimitTier: "tier-x",
  },
  someFutureCliField: { keep: true },
});

test("a write-back updates only the refreshed fields and keeps everything else", () => {
  const merged = JSON.parse(mergeRefreshedBlob(
    FULL_BLOB,
    {
      ok: true,
      accessToken: "new-access",
      refreshToken: null,
      expiresAt: 9_000,
      refreshTokenExpiresAt: null,
      scopes: ["user:profile"],
    },
    "old-refresh",
  ));

  assert.equal(merged.claudeAiOauth.accessToken, "new-access");
  assert.equal(merged.claudeAiOauth.expiresAt, 9_000);
  assert.deepEqual(merged.claudeAiOauth.scopes, ["user:profile"]);
  // No rotation: the stored refresh token and its expiry must survive untouched.
  assert.equal(merged.claudeAiOauth.refreshToken, "old-refresh");
  assert.equal(merged.claudeAiOauth.refreshTokenExpiresAt, 2_000);
  // Fields the CLI owns and Quotix does not model must survive a round trip.
  assert.equal(merged.claudeAiOauth.subscriptionType, "team");
  assert.equal(merged.claudeAiOauth.rateLimitTier, "tier-x");
  assert.deepEqual(merged.someFutureCliField, { keep: true });
});

test("a rotated refresh token replaces the stored one", () => {
  const merged = JSON.parse(mergeRefreshedBlob(
    FULL_BLOB,
    {
      ok: true,
      accessToken: "new-access",
      refreshToken: "rotated",
      expiresAt: 9_000,
      refreshTokenExpiresAt: 12_000,
      scopes: [],
    },
    "old-refresh",
  ));

  assert.equal(merged.claudeAiOauth.refreshToken, "rotated");
  assert.equal(merged.claudeAiOauth.refreshTokenExpiresAt, 12_000);
  // An empty scope list in the response is no answer; keep what was stored.
  assert.deepEqual(merged.claudeAiOauth.scopes, ["user:profile", "user:inference"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test 2>&1 | grep -iE 'mergeRefreshedBlob|Cannot find module'`
Expected: FAIL — cannot find `../out/src/quota/claude/refresh.js`.

- [ ] **Step 3: Write the merge implementation**

Create `src/quota/claude/refresh.ts` with the merge only:

```typescript
import {
  parseRefreshableCredentials,
  readOAuthBlobAsync,
  type BlobResult,
} from "./credentials";
import { acquireRefreshLock, type LockRelease } from "./refreshLock";
import { writeKeychainBlob } from "./keychainWrite";
import { requestRefresh, type RefreshResult } from "./refreshRequest";

type Refreshed = RefreshResult & { ok: true };

/**
 * Rebuilds the stored blob with the refreshed fields patched in. Unknown keys are
 * preserved: the item belongs to the CLI, and dropping a field it added would break
 * it in a way it cannot detect.
 */
export function mergeRefreshedBlob(
  blob: string,
  refreshed: Refreshed,
  previousRefreshToken: string,
): string {
  const parsed = JSON.parse(blob) as Record<string, unknown>;
  const oauth = { ...(parsed.claudeAiOauth as Record<string, unknown>) };

  oauth.accessToken = refreshed.accessToken;
  oauth.expiresAt = refreshed.expiresAt;
  oauth.refreshToken = refreshed.refreshToken ?? previousRefreshToken;
  if (refreshed.refreshToken !== null && refreshed.refreshTokenExpiresAt !== null) {
    oauth.refreshTokenExpiresAt = refreshed.refreshTokenExpiresAt;
  }
  if (refreshed.scopes.length > 0) { oauth.scopes = refreshed.scopes; }

  return JSON.stringify({ ...parsed, claudeAiOauth: oauth });
}
```

- [ ] **Step 4: Run tests to verify the merge passes**

Run: `pnpm run typecheck && pnpm test 2>&1 | tail -8`
Expected: typecheck silent, tests PASS with 0 fail.

- [ ] **Step 5: Write the failing test for the orchestration**

Add to `tests/claudeRefresh.test.mjs`:

```javascript
function blob(fields) {
  return JSON.stringify({
    claudeAiOauth: {
      accessToken: "old-access",
      refreshToken: "old-refresh",
      expiresAt: 1_000,
      scopes: ["user:profile", "user:inference"],
      ...fields,
    },
  });
}

function refresherWith(overrides) {
  const written = [];
  const release = async () => {};
  const deps = {
    readBlob: async () => ({ ok: false, reason: "not-found" }),
    acquireLock: async () => release,
    request: async () => ({
      ok: true,
      accessToken: "new-access",
      refreshToken: null,
      expiresAt: 9_999_999,
      refreshTokenExpiresAt: null,
      scopes: [],
    }),
    write: async (b) => { written.push(b); return { ok: true }; },
    nowMs: () => 1_000_000,
    marginMs: 60_000,
    ...overrides,
  };
  return { refresher: createRefresher(deps), written };
}

test("a token with plenty of life left is left alone", async () => {
  const stored = blob({ expiresAt: 9_000_000 });
  const { refresher, written } = refresherWith({
    readBlob: async () => parseRefreshableCredentials(stored),
    acquireLock: async () => { throw new Error("must not lock"); },
  });

  assert.equal(await refresher.run(), "not-needed");
  assert.deepEqual(written, []);
});

test("a credential with no refresh token is reported, not refreshed", async () => {
  const stored = blob({ refreshToken: undefined, expiresAt: 1_000 });
  const { refresher } = refresherWith({
    readBlob: async () => parseRefreshableCredentials(stored),
    acquireLock: async () => { throw new Error("must not lock"); },
  });

  assert.equal(await refresher.run(), "no-refresh-token");
});

test("a token that changed before we locked is adopted instead of refreshed", async () => {
  let reads = 0;
  const { refresher, written } = refresherWith({
    readBlob: async () => {
      reads += 1;
      return parseRefreshableCredentials(blob({ accessToken: `access-${reads}`, expiresAt: 1_000 }));
    },
    acquireLock: async () => { throw new Error("must not lock"); },
    request: async () => { throw new Error("must not refresh"); },
  });

  assert.equal(await refresher.run(), "adopted");
  assert.deepEqual(written, [], "the CLI already wrote a good token");
});

test("a token that changed under the lock is adopted instead of refreshed", async () => {
  let reads = 0;
  const { refresher, written } = refresherWith({
    readBlob: async () => {
      reads += 1;
      // Same token for the pre-lock check, different once the lock is held.
      const accessToken = reads <= 2 ? "old-access" : "someone-elses";
      return parseRefreshableCredentials(blob({ accessToken, expiresAt: 1_000 }));
    },
    request: async () => { throw new Error("must not refresh"); },
  });

  assert.equal(await refresher.run(), "adopted");
  assert.deepEqual(written, []);
});

test("a refresh writes the merged blob back", async () => {
  const { refresher, written } = refresherWith({
    readBlob: async () => parseRefreshableCredentials(blob({ expiresAt: 1_000 })),
  });

  assert.equal(await refresher.run(), "refreshed");
  assert.equal(written.length, 1);
  const merged = JSON.parse(written[0]).claudeAiOauth;
  assert.equal(merged.accessToken, "new-access");
  assert.equal(merged.refreshToken, "old-refresh");
});

test("a contended lock never refreshes anyway", async () => {
  const { refresher, written } = refresherWith({
    readBlob: async () => parseRefreshableCredentials(blob({ expiresAt: 1_000 })),
    acquireLock: async () => "contended",
    request: async () => { throw new Error("must not refresh"); },
  });

  assert.equal(await refresher.run(), "contended");
  assert.deepEqual(written, []);
});

test("the lock is released even when the write fails", async () => {
  let released = 0;
  const { refresher } = refresherWith({
    readBlob: async () => parseRefreshableCredentials(blob({ expiresAt: 1_000 })),
    acquireLock: async () => async () => { released += 1; },
    write: async () => ({ ok: false }),
  });

  assert.equal(await refresher.run(), "write-failed");
  assert.equal(released, 1);
});

test("a refresh token the server rejected is never sent again", async () => {
  let requests = 0;
  const { refresher } = refresherWith({
    readBlob: async () => parseRefreshableCredentials(blob({ expiresAt: 1_000 })),
    request: async () => { requests += 1; return { ok: false, reason: "http", status: 400 }; },
  });

  assert.equal(await refresher.run(), "request-failed");
  assert.equal(await refresher.run(), "dead-refresh-token");
  assert.equal(requests, 1, "replaying a rejected refresh token cannot succeed");
});

test("a network failure leaves the refresh token usable", async () => {
  let requests = 0;
  const { refresher } = refresherWith({
    readBlob: async () => parseRefreshableCredentials(blob({ expiresAt: 1_000 })),
    request: async () => { requests += 1; return { ok: false, reason: "network" }; },
  });

  assert.equal(await refresher.run(), "request-failed");
  assert.equal(await refresher.run(), "request-failed");
  assert.equal(requests, 2, "the token was never rejected, only unreachable");
});

test("concurrent runs share one refresh", async () => {
  let requests = 0;
  const { refresher } = refresherWith({
    readBlob: async () => parseRefreshableCredentials(blob({ expiresAt: 1_000 })),
    request: async () => {
      requests += 1;
      return {
        ok: true,
        accessToken: "new-access",
        refreshToken: null,
        expiresAt: 9_999_999,
        refreshTokenExpiresAt: null,
        scopes: [],
      };
    },
  });

  const outcomes = await Promise.all([refresher.run(), refresher.run(), refresher.run()]);
  assert.deepEqual(outcomes, ["refreshed", "refreshed", "refreshed"]);
  assert.equal(requests, 1);
});

test("an unreadable credential is reported without touching the lock", async () => {
  const { refresher } = refresherWith({
    readBlob: async () => ({ ok: false, reason: "not-found" }),
    acquireLock: async () => { throw new Error("must not lock"); },
  });

  assert.equal(await refresher.run(), "unreadable");
});
```

Also add `parseRefreshableCredentials` to this file's imports from `../out/src/quota/claude/credentials.js`.

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm test 2>&1 | grep -iE 'createRefresher|not a function'`
Expected: FAIL — `createRefresher is not a function`.

- [ ] **Step 7: Write the orchestration**

Append to `src/quota/claude/refresh.ts`:

```typescript
// A token is refreshed once it is inside this margin of expiry, matching the skew the
// read path already treats as expired.
const REFRESH_MARGIN_MS = 60_000;

export type RefreshOutcome =
  | "refreshed"
  | "adopted"
  | "not-needed"
  | "no-refresh-token"
  | "contended"
  | "dead-refresh-token"
  | "request-failed"
  | "write-failed"
  | "unreadable";

export interface RefresherDeps {
  readBlob: () => Promise<BlobResult>;
  acquireLock: () => Promise<LockRelease | "contended">;
  request: typeof requestRefresh;
  write: (blob: string) => Promise<{ ok: boolean }>;
  nowMs: () => number;
  marginMs: number;
}

export interface Refresher {
  run(): Promise<RefreshOutcome>;
}

/**
 * Renews the access token the Claude Code CLI owns, by running the CLI's own
 * protocol rather than competing with it: check whether a refresh is even needed,
 * re-read and compare before and after taking the CLI's refresh lock, and abort in
 * favour of whatever the other process wrote. A refresh token the server rejected is
 * remembered as dead, because replaying it cannot succeed and each attempt spends a
 * request the endpoint counts.
 */
export function createRefresher(deps: Partial<RefresherDeps> = {}): Refresher {
  const readBlob = deps.readBlob ?? readOAuthBlobAsync;
  const acquireLock = deps.acquireLock ?? (() => acquireRefreshLock());
  const request = deps.request ?? requestRefresh;
  const write = deps.write ?? writeKeychainBlob;
  const nowMs = deps.nowMs ?? Date.now;
  const marginMs = deps.marginMs ?? REFRESH_MARGIN_MS;

  const deadRefreshTokens = new Set<string>();
  let inFlight: Promise<RefreshOutcome> | null = null;

  // expiresAt 0 means the blob never carried one; let the endpoint be the judge
  // rather than refreshing a token that may well still work.
  const needsRefresh = (expiresAt: number): boolean =>
    expiresAt > 0 && nowMs() >= expiresAt - marginMs;

  const attempt = async (): Promise<RefreshOutcome> => {
    const first = await readBlob();
    if (!first.ok) { return "unreadable"; }
    if (!needsRefresh(first.creds.expiresAt)) { return "not-needed"; }
    if (first.creds.refreshToken === null) { return "no-refresh-token"; }
    if (deadRefreshTokens.has(first.creds.refreshToken)) { return "dead-refresh-token"; }

    // Cheap race check before paying for the lock: the CLI may already have written a
    // usable token while we were deciding.
    const second = await readBlob();
    if (!second.ok) { return "unreadable"; }
    if (second.creds.accessToken !== first.creds.accessToken) { return "adopted"; }

    const release = await acquireLock();
    if (release === "contended") { return "contended"; }
    try {
      // The only check that matters: whoever holds the lock reads last.
      const locked = await readBlob();
      if (!locked.ok) { return "unreadable"; }
      if (locked.creds.accessToken !== first.creds.accessToken) { return "adopted"; }
      if (locked.creds.refreshToken === null) { return "no-refresh-token"; }
      if (!needsRefresh(locked.creds.expiresAt)) { return "not-needed"; }

      const refreshed = await request(locked.creds.refreshToken, locked.creds.scopes);
      if (!refreshed.ok) {
        // Only a rejection kills the token. A network failure says nothing about it.
        if (refreshed.reason !== "network") { deadRefreshTokens.add(locked.creds.refreshToken); }
        return "request-failed";
      }

      const merged = mergeRefreshedBlob(locked.blob, refreshed, locked.creds.refreshToken);
      const written = await write(merged);
      return written.ok ? "refreshed" : "write-failed";
    } finally {
      await release().catch(() => {});
    }
  };

  return {
    run(): Promise<RefreshOutcome> {
      if (inFlight) { return inFlight; }
      inFlight = attempt().finally(() => { inFlight = null; });
      return inFlight;
    },
  };
}
```

- [ ] **Step 8: Run tests and typecheck**

Run: `pnpm run typecheck && pnpm test 2>&1 | tail -8`
Expected: typecheck silent, tests PASS with 0 fail.

- [ ] **Step 9: Commit**

```bash
git add src/quota/claude/refresh.ts tests/claudeRefresh.test.mjs
git commit -m "feat: refresh the Claude token under the CLI's lock with a CAS check"
```

---

### Task 6: Wire the refresher into the read path

The refresher exists but nothing calls it. Two triggers: a token the read path would report `expired`, and a 401 that a re-read did not explain. Both go through the same refresher, so the singleflight and dead-token set apply.

**Files:**
- Modify: `src/quota/claude/credentials.ts` (`createCachedTokenProvider`)
- Modify: `src/quota/claude/provider.ts:53-61`
- Modify: `src/main.ts`
- Test: `tests/credentials.test.mjs`, `tests/claudeProvider.test.mjs`

**Interfaces:**
- Consumes: `createRefresher()` and `RefreshOutcome` from Task 5.
- Produces:
  - `CachedTokenProviderDeps` gains `refresh?: () => Promise<unknown>` — the caller reports the token it can see afterwards, so the outcome enum is deliberately not part of this contract.
  - `CachedTokenProvider` gains `refresh(): Promise<TokenResult>` — refresh, then re-read and return the current token.

- [ ] **Step 1: Write the failing test for the provider-level refresh**

Add to `tests/credentials.test.mjs`:

```javascript
test("an expired token triggers one refresh, then reports the token that refresh produced", async () => {
  let refreshes = 0;
  let stored = parseOAuthCredentials(blobWith({ accessToken: "stale", expiresAt: 1_000 }));
  const provider = createCachedTokenProvider({
    readSync: () => stored,
    readAsync: async () => stored,
    now: () => 1_000_000,
    rereadMs: 30_000,
    refresh: async () => {
      refreshes += 1;
      stored = parseOAuthCredentials(blobWith({ accessToken: "fresh", expiresAt: 9_000_000 }));
      return "refreshed";
    },
  });

  assert.deepEqual(await provider.get(), { ok: true, token: "fresh" });
  assert.equal(refreshes, 1);
});

test("a refresh that cannot help still reports the honest failure", async () => {
  const stored = parseOAuthCredentials(blobWith({ accessToken: "stale", expiresAt: 1_000 }));
  const provider = createCachedTokenProvider({
    readSync: () => stored,
    readAsync: async () => stored,
    now: () => 1_000_000,
    rereadMs: 30_000,
    refresh: async () => "no-refresh-token",
  });

  assert.deepEqual(await provider.get(), { ok: false, reason: "expired" });
});

test("get never refreshes a token that is still good", async () => {
  const stored = parseOAuthCredentials(blobWith({ accessToken: "good", expiresAt: 9_000_000 }));
  const provider = createCachedTokenProvider({
    readSync: () => stored,
    readAsync: async () => stored,
    now: () => 0,
    rereadMs: 30_000,
    refresh: async () => { throw new Error("must not refresh"); },
  });

  assert.deepEqual(await provider.get(), { ok: true, token: "good" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test 2>&1 | grep -B2 -A6 'triggers one refresh'`
Expected: FAIL — the expired token is reported as `expired` because `refresh` is ignored.

- [ ] **Step 3: Extend the cached token provider**

In `src/quota/claude/credentials.ts`, add `refresh` to `CachedTokenProviderDeps`, add it to `CachedTokenProvider`, and use it in `get()`:

```typescript
export interface CachedTokenProvider {
  get(): Promise<TokenResult>;
  refresh(): Promise<TokenResult>;
  invalidate(): void;
}

interface CachedTokenProviderDeps {
  readSync: () => CredentialsResult;
  readAsync: () => Promise<CredentialsResult>;
  now: () => number;
  rereadMs: number;
  refresh: () => Promise<unknown>;
}
```

Inside `createCachedTokenProvider`:

```typescript
  const refresh = deps.refresh ?? (async () => "not-needed");

  // Renewing is worth a request only for a token that has actually lapsed; the
  // refresher itself decides whether it can help and re-reads afterwards either way.
  const refreshThenReread = async (): Promise<TokenResult> => {
    await refresh().catch(() => { /* the re-read below reports the real state */ });
    readAtMs = Number.NEGATIVE_INFINITY;
    await reread();
    return current;
  };
```

and in `get()`:

```typescript
    async get(): Promise<TokenResult> {
      if (now() - readAtMs >= rereadMs || !current.ok) { await reread(); }
      if (!current.ok && current.reason === "expired") { return refreshThenReread(); }
      return current;
    },
    // A 401 means the token was rejected whatever its stated expiry said. Re-read
    // first — the CLI may already have replaced it — and only then spend a refresh.
    async refresh(): Promise<TokenResult> {
      readAtMs = Number.NEGATIVE_INFINITY;
      await reread();
      return current.ok ? current : refreshThenReread();
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run typecheck && pnpm test 2>&1 | tail -8`
Expected: typecheck silent, tests PASS with 0 fail.

- [ ] **Step 5: Teach the existing provider test harness about recovery**

`tests/claudeProvider.test.mjs:6-13` builds a `tokenProvider` stub with only `get` and
`invalidate`. Once the provider calls `refresh()` on a 401, that stub throws a
`TypeError` and the existing "401 invalidates the cached token" test fails for the wrong
reason. Replace the harness with one that records recovery too:

```javascript
function harness(token, fetchImpl, recovery) {
  let invalidations = 0;
  let refreshes = 0;
  const provider = new ClaudeQuotaProvider({
    tokenProvider: {
      get: async () => token,
      // Default recovery changes nothing, which is what a stale credential really does.
      refresh: async () => { refreshes += 1; return recovery ? recovery() : token; },
      invalidate: () => { invalidations += 1; },
    },
    fetchImpl,
  });
  return { provider, invalidations: () => invalidations, refreshes: () => refreshes };
}
```

- [ ] **Step 6: Write the failing tests for the 401 recovery path**

Add to `tests/claudeProvider.test.mjs`. These build responses the same way the file
already does, with `new Response(...)`:

```javascript
const USAGE_BODY = JSON.stringify({
  five_hour: { utilization: 10, resets_at: "2026-08-05T12:00:00Z" },
});

test("a 401 asks the token provider to recover, then retries once with the new token", async () => {
  const sent = [];
  const responses = [
    new Response(null, { status: 401 }),
    new Response(USAGE_BODY, { status: 200 }),
  ];
  const h = harness(
    { ok: true, token: "rejected" },
    async (_url, init) => { sent.push(init.headers.Authorization); return responses.shift(); },
    () => ({ ok: true, token: "accepted" }),
  );

  const result = await h.provider.read(100);
  assert.equal(result.ok, true, "the retry with the renewed token must be the answer");
  assert.equal(h.refreshes(), 1);
  assert.deepEqual(sent, ["Bearer rejected", "Bearer accepted"]);
});

test("a 401 that recovery cannot fix is still reported as auth", async () => {
  const h = harness(
    { ok: true, token: "rejected" },
    async () => new Response(null, { status: 401 }),
    () => ({ ok: false, reason: "expired" }),
  );

  assert.deepEqual(await h.provider.read(100), { ok: false, kind: "auth", error: "HTTP 401" });
  assert.equal(h.refreshes(), 1);
});

test("a token rejected twice does not retry forever", async () => {
  let requests = 0;
  const h = harness(
    { ok: true, token: "rejected" },
    async () => { requests += 1; return new Response(null, { status: 401 }); },
    () => ({ ok: true, token: "also-rejected" }),
  );

  assert.deepEqual(await h.provider.read(100), { ok: false, kind: "auth", error: "HTTP 401" });
  assert.equal(requests, 2, "one original request and one retry, never a third");
});
```

Note: if the existing "successful OAuth usage maps to shared quota" test uses a different
usage payload shape than `USAGE_BODY` above, use that file's shape instead — the point of
this fixture is only that the response parses, not what it contains.

- [ ] **Step 7: Run tests to verify they fail**

Run: `pnpm test 2>&1 | grep -A6 'asks the token provider to recover'`
Expected: FAIL — `h.refreshes()` is 0 and the result is the 401.

- [ ] **Step 8: Rewrite the provider read path**

Replace `src/quota/claude/provider.ts:48-92` (the whole class) with the version below. The
retry is bounded to one extra request per `read`, so a permanently rejected token cannot
spin, and `invalidate()` still runs on every 401 so a stale in-memory token cannot outlive
the rejection.

```typescript
type UsageAttempt =
  | { kind: "done"; result: ProviderReadResult }
  | { kind: "token-rejected" };

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

    const first = await this.fetchUsage(token.token, nowSec);
    if (first.kind === "done") { return first.result; }

    // The endpoint rejected the token whatever its stated expiry claimed. Recovery
    // re-reads the credential — the CLI may already have replaced it — and renews it
    // only if that was not enough. One retry, then the failure stands.
    const renewed = await this.deps.tokenProvider.refresh();
    if (!renewed.ok) { return { ok: false, kind: "auth", error: "HTTP 401" }; }
    const second = await this.fetchUsage(renewed.token, nowSec);
    return second.kind === "done"
      ? second.result
      : { ok: false, kind: "auth", error: "HTTP 401" };
  }

  dispose(): void { /* no persistent external resource */ }

  private async fetchUsage(token: string, nowSec: number): Promise<UsageAttempt> {
    try {
      const response = await this.deps.fetchImpl(USAGE_URL, {
        headers: {
          Authorization: `Bearer ${token}`,
          "anthropic-beta": "oauth-2025-04-20",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status === 401) {
        this.deps.tokenProvider.invalidate();
        return { kind: "token-rejected" };
      }
      if (response.status === 429) {
        return {
          kind: "done",
          result: {
            ok: false,
            kind: "rate-limited",
            error: "HTTP 429",
            retryAfterSeconds: retryAfterSeconds(response),
          },
        };
      }
      if (!response.ok) {
        return { kind: "done", result: { ok: false, kind: "transient", error: `HTTP ${response.status}` } };
      }
      return {
        kind: "done",
        result: { ok: true, quota: quotaFromOAuthUsage(await response.json(), nowSec) },
      };
    } catch (error) {
      return { kind: "done", result: { ok: false, kind: "transient", error: safeFetchError(error) } };
    }
  }
}
```

- [ ] **Step 9: Correct the now-false `expired` diagnostic**

`CREDENTIAL_DIAGNOSTICS.expired` in `src/quota/claude/provider.ts:31` reads "The Claude
Code access token expired. Run Claude Code to renew it". Quotix now renews it itself, so
that message tells the user to do work that is no longer theirs. It is only reached when a
refresh could not help — a missing refresh token, a rejected one, or a lock we never got.

Change the constant to:

```typescript
  expired: "The Claude Code access token expired and could not be renewed. Run Claude Code",
```

Then update the expectation in `tests/claudeProvider.test.mjs:23`:

```javascript
    ["expired", "transient", "The Claude Code access token expired and could not be renewed. Run Claude Code"],
```

- [ ] **Step 10: Run tests and typecheck**

Run: `pnpm run typecheck && pnpm test 2>&1 | tail -8`
Expected: typecheck silent, tests PASS with 0 fail.

- [ ] **Step 11: Wire it up in main**

In `src/main.ts`, where `createCachedTokenProvider()` is constructed, pass the refresher:

```typescript
import { createRefresher } from "./quota/claude/refresh";

const refresher = createRefresher();
const tokenProvider = createCachedTokenProvider({ refresh: () => refresher.run() });
```

- [ ] **Step 12: Run the full check**

Run: `pnpm run typecheck && pnpm test 2>&1 | tail -8 && pnpm run compile`
Expected: typecheck silent, tests PASS with 0 fail, compile succeeds.

- [ ] **Step 13: Commit**

```bash
git add src/quota/claude/credentials.ts src/quota/claude/provider.ts src/main.ts tests/credentials.test.mjs tests/claudeProvider.test.mjs
git commit -m "feat: renew the Claude token on expiry and on a 401"
```

---

### Task 7: Replace the documented never-refresh invariant

`CLAUDE.md` currently instructs future work that Quotix never refreshes and never writes the Keychain. Leaving that in place would have the next contributor treat this feature as a bug.

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Replace the Claude adapter paragraph**

In the architecture list, item 4 currently reads:

> 4. `src/quota/claude/` — Keychain credential reader and Anthropic OAuth usage
>    adapter. Preserve sync startup seed, async re-read, 401 invalidation, and safe
>    diagnostics. Quotix only observes the credential the Claude Code CLI owns: it
>    never refreshes the OAuth token and never writes the Keychain item. Refreshing
>    rotates a refresh token shared with the CLI, and a rotation that loses the race
>    has no local recovery. An expired token is reported as expired; the next read
>    picks up whatever the CLI wrote. Each failure reason gets its own message —
>    never collapse them into one.

Replace it with:

```markdown
4. `src/quota/claude/` — Keychain credential reader, cooperative OAuth refresher, and
   Anthropic OAuth usage adapter. Preserve sync startup seed, async re-read, 401
   invalidation, and safe diagnostics. Each failure reason gets its own message —
   never collapse them into one.

   Quotix shares one credential with the Claude Code CLI, so refreshing is only safe
   as a *participant* in the CLI's protocol, never as a competitor. Every refresh must
   keep all four properties: take the CLI's own lock at
   `<credential dir>/.oauth_refresh.lock` plus the legacy lock beside it, with the
   CLI's `proper-lockfile` options; re-read the credential under that lock and abandon
   the refresh if the access token changed; write the item back through `security -i`
   on stdin so no token reaches `argv`; and preserve every field in the blob, because
   the CLI owns fields Quotix does not model. A refresh token the server rejects is
   recorded as dead and never replayed. Refresh on demand only — an expired token or a
   401 — never on a schedule. The protocol constants are documented in
   `docs/superpowers/plans/2026-08-05-claude-oauth-cooperative-refresh.md`.
```

- [ ] **Step 2: Verify nothing else contradicts it**

Run: `grep -rn "never refreshes\|never writes the Keychain" CLAUDE.md README.md docs/ src/`
Expected: no matches.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: describe the cooperative refresh invariants"
```

---

## Manual Verification

Automated tests cover the protocol; only a live run proves Quotix and the CLI actually cooperate. Run these on a machine signed in to the Claude Code CLI.

- [ ] **Refresh happens and the CLI keeps working.** Note the current token's expiry, wait for (or arrange) an expired token, open Quotix's popover, confirm quota renders. Then run `claude auth status` and confirm it still reports `loggedIn: true` with the same email — the CLI's credential survived Quotix's write.
- [ ] **Contention resolves rather than corrupting.** Start a `claude` session and open Quotix's popover at the same time near token expiry. Both must end up working. `claude auth status` must still report `loggedIn: true`.
- [ ] **No token leaks to the process table.** During a refresh, run `ps -Aww | grep -c add-generic-password`. Expected: `0` — the payload went over stdin.
- [ ] **A dead refresh token does not spin.** Nothing to arrange: confirm from Quotix's diagnostics that a repeated failure keeps reporting the same reason instead of re-requesting on every poll.

## Risks and Non-Goals

- **The refresh token can still be rotated out from under us in a window the lock does not cover** — specifically, a CLI build that refreshes *without* taking the lock. Nothing in Quotix can prevent that. The mitigation is that a rejected refresh token is marked dead, so the failure is one bad refresh reported honestly rather than a spin, and the next CLI run repairs the item.
- **The protocol is reverse-engineered from CLI 2.1.222 and is not a public contract.** A CLI update can change the lock path, the client id, the scope set, or the blob shape. Every constant is in one place per module for that reason. If a future CLI diverges, the honest failure modes (`contended`, `request-failed`, `write-failed`) all leave the CLI's credential intact.
- **This does not reduce 429s on the usage endpoint, and is not meant to.** Refreshes go to `platform.claude.com/v1/oauth/token`, a different endpoint from `api.anthropic.com/api/oauth/usage` with its own budget, so `SourceRuntime`'s backoff policy is untouched and unhelped. What this buys is that an expired token stops being a dead end until the user next runs the CLI. Poll cadence and the 429 policy are a separate piece of work.
- **Not in scope:** minting Quotix's own OAuth credential (no third-party client registration exists for the subscription usage endpoint), `claude setup-token` (its token carries only `user:inference`, and the usage endpoint's own guard requires `user:profile` as well), and any change to poll cadence or the 429 backoff policy.
