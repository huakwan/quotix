import assert from "node:assert/strict";
import test from "node:test";

import { createHash } from "node:crypto";
import * as os from "node:os";
import * as path from "node:path";

import {
  parseOAuthCredentials,
  createCachedTokenProvider,
  credentialsFilePath,
  failureFromExec,
  keychainService,
  withFileFallback,
} from "../out/src/quota/claude/credentials.js";

const scope = (dir) => createHash("sha256").update(dir).digest("hex").slice(0, 8);
const defaultDir = path.join(os.homedir(), ".claude");

const BLOB = JSON.stringify({
  claudeAiOauth: {
    accessToken: "old-access",
    refreshToken: "old-refresh",
    expiresAt: 1_000_000,
    refreshTokenExpiresAt: 9_000_000,
    scopes: ["user:inference"],
    subscriptionType: "team",
    rateLimitTier: "tier-x",
  },
});

function blobWith(fields) {
  return JSON.stringify({ claudeAiOauth: { accessToken: "old-access", ...fields } });
}

test("parseOAuthCredentials keeps only the access token and its expiry", () => {
  const result = parseOAuthCredentials(BLOB);
  assert.equal(result.ok, true);
  // No refresh token, no raw blob: nothing that could rotate or overwrite the item.
  assert.deepEqual(result.creds, { accessToken: "old-access", expiresAt: 1_000_000 });
  assert.equal(result.raw, undefined);
});

test("parseOAuthCredentials rejects blob without access token", () => {
  const result = parseOAuthCredentials(JSON.stringify({ claudeAiOauth: { refreshToken: "x" } }));
  assert.deepEqual(result, { ok: false, reason: "corrupt" });
});

test("parseOAuthCredentials rejects a non-JSON blob", () => {
  assert.deepEqual(parseOAuthCredentials("not json"), { ok: false, reason: "corrupt" });
});

test("provider seeds synchronously without reading again", async () => {
  let asyncReads = 0;
  const provider = createCachedTokenProvider({
    readSync: () => parseOAuthCredentials(BLOB),
    readAsync: async () => { asyncReads += 1; return parseOAuthCredentials(BLOB); },
    now: () => 0,
    rereadMs: 30_000,
  });

  assert.deepEqual(await provider.get(), { ok: true, token: "old-access" });
  assert.equal(asyncReads, 0);
});

test("an expired access token is reported as expired, never refreshed", async () => {
  const provider = createCachedTokenProvider({
    readSync: () => parseOAuthCredentials(blobWith({ expiresAt: 1_000_000 })),
    readAsync: async () => parseOAuthCredentials(blobWith({ expiresAt: 1_000_000 })),
    now: () => 1_000_000,
    rereadMs: 30_000,
  });

  assert.deepEqual(await provider.get(), { ok: false, reason: "expired" });
});

test("a token inside the expiry skew counts as expired", async () => {
  const provider = createCachedTokenProvider({
    readSync: () => parseOAuthCredentials(blobWith({ expiresAt: 100_000 })),
    readAsync: async () => parseOAuthCredentials(blobWith({ expiresAt: 100_000 })),
    now: () => 100_000 - 60_000,
    rereadMs: 30_000,
  });

  assert.deepEqual(await provider.get(), { ok: false, reason: "expired" });
});

test("a blob without an expiry is used rather than assumed expired", async () => {
  const provider = createCachedTokenProvider({
    readSync: () => parseOAuthCredentials(blobWith({})),
    readAsync: async () => parseOAuthCredentials(blobWith({})),
    now: () => 5_000_000,
    rereadMs: 30_000,
  });

  assert.deepEqual(await provider.get(), { ok: true, token: "old-access" });
});

test("a failed seed never outlives the credential that fixed it", async () => {
  let t = 0;
  let stored = { ok: false, reason: "not-found" };
  const provider = createCachedTokenProvider({
    readSync: () => stored,
    readAsync: async () => stored,
    now: () => t,
    rereadMs: 30_000,
  });

  assert.deepEqual(await provider.get(), { ok: false, reason: "not-found" });

  // The CLI signs in; the very next get() must see it, without waiting out rereadMs.
  stored = parseOAuthCredentials(blobWith({ expiresAt: 9_000_000 }));
  assert.deepEqual(await provider.get(), { ok: true, token: "old-access" });
  assert.equal(t, 0);
});

test("a good token is re-read once the cache goes stale", async () => {
  let t = 0;
  let stored = parseOAuthCredentials(blobWith({ accessToken: "first", expiresAt: 9_000_000 }));
  const provider = createCachedTokenProvider({
    readSync: () => stored,
    readAsync: async () => stored,
    now: () => t,
    rereadMs: 30_000,
  });

  assert.deepEqual(await provider.get(), { ok: true, token: "first" });

  stored = parseOAuthCredentials(blobWith({ accessToken: "second", expiresAt: 9_000_000 }));
  assert.deepEqual(await provider.get(), { ok: true, token: "first" }, "still fresh");

  t = 30_000;
  assert.deepEqual(await provider.get(), { ok: true, token: "second" });
});

test("invalidate forces the next get to re-read without reading eagerly", async () => {
  let asyncReads = 0;
  let stored = parseOAuthCredentials(blobWith({ accessToken: "first", expiresAt: 9_000_000 }));
  const provider = createCachedTokenProvider({
    readSync: () => stored,
    readAsync: async () => { asyncReads += 1; return stored; },
    now: () => 0,
    rereadMs: 30_000,
  });

  await provider.get();
  stored = parseOAuthCredentials(blobWith({ accessToken: "second", expiresAt: 9_000_000 }));
  provider.invalidate();
  assert.equal(asyncReads, 0, "invalidate must not spend a read of its own");

  assert.deepEqual(await provider.get(), { ok: true, token: "second" });
  assert.equal(asyncReads, 1);
});

test("concurrent get calls share one keychain read", async () => {
  let asyncReads = 0;
  const provider = createCachedTokenProvider({
    readSync: () => ({ ok: false, reason: "not-found" }),
    readAsync: async () => {
      asyncReads += 1;
      return parseOAuthCredentials(blobWith({ expiresAt: 9_000_000 }));
    },
    now: () => 0,
    rereadMs: 30_000,
  });

  const results = await Promise.all([provider.get(), provider.get(), provider.get()]);
  for (const result of results) { assert.deepEqual(result, { ok: true, token: "old-access" }); }
  assert.equal(asyncReads, 1);
});

test("a read that throws retains the last known token", async () => {
  let t = 0;
  const provider = createCachedTokenProvider({
    readSync: () => parseOAuthCredentials(blobWith({ expiresAt: 9_000_000 })),
    readAsync: async () => { throw new Error("keychain blew up"); },
    now: () => t,
    rereadMs: 30_000,
  });

  await provider.get();
  t = 30_000;
  assert.deepEqual(await provider.get(), { ok: true, token: "old-access" });
});

test("a default install reads the unscoped keychain service", () => {
  assert.equal(keychainService({}), "Claude Code-credentials");
  // A flag the CLI reads as off must not send us to a non-production item.
  assert.equal(keychainService({ USE_LOCAL_OAUTH: "0" }), "Claude Code-credentials");
  assert.equal(keychainService({ CLAUDE_CONFIG_DIR: "" }), "Claude Code-credentials");
});

test("a custom config dir scopes the keychain service the way the CLI does", () => {
  assert.equal(
    keychainService({ CLAUDE_CONFIG_DIR: "/tmp/cc" }),
    `Claude Code-credentials-${scope("/tmp/cc")}`,
  );
  // The secure-storage override wins, and an explicitly empty one means the default.
  assert.equal(
    keychainService({ CLAUDE_CONFIG_DIR: "/tmp/cc", CLAUDE_SECURESTORAGE_CONFIG_DIR: "/tmp/ss" }),
    `Claude Code-credentials-${scope("/tmp/ss")}`,
  );
  assert.equal(
    keychainService({ CLAUDE_CONFIG_DIR: "/tmp/cc", CLAUDE_SECURESTORAGE_CONFIG_DIR: "" }),
    "Claude Code-credentials",
  );
});

test("non-production sign-ins carry their own service suffix", () => {
  assert.equal(
    keychainService({ CLAUDE_CODE_CUSTOM_OAUTH_URL: "https://example.test" }),
    "Claude Code-custom-oauth-credentials",
  );
  assert.equal(keychainService({ USE_LOCAL_OAUTH: "1" }), "Claude Code-local-oauth-credentials");
  assert.equal(
    keychainService({ USE_LOCAL_OAUTH: "1", CLAUDE_CONFIG_DIR: "/tmp/cc" }),
    `Claude Code-local-oauth-credentials-${scope("/tmp/cc")}`,
  );
});

test("the plaintext fallback path follows the same config dir", () => {
  assert.equal(credentialsFilePath({}), path.join(defaultDir, ".credentials.json"));
  assert.equal(
    credentialsFilePath({ CLAUDE_CONFIG_DIR: "/tmp/cc" }),
    path.join("/tmp/cc", ".credentials.json"),
  );
  assert.equal(
    credentialsFilePath({ CLAUDE_SECURESTORAGE_CONFIG_DIR: "" }),
    path.join(defaultDir, ".credentials.json"),
  );
});

test("an empty keychain defers to the file the CLI wrote instead", () => {
  const fromFile = parseOAuthCredentials(blobWith({ accessToken: "from-file" }));

  for (const reason of ["not-found", "keychain-unavailable"]) {
    assert.deepEqual(withFileFallback({ ok: false, reason }, () => fromFile), fromFile);
  }
});

test("the keychain failure survives when the file cannot stand in for it", () => {
  const keychain = { ok: false, reason: "keychain-unavailable" };
  assert.deepEqual(withFileFallback(keychain, () => null), keychain);
  assert.deepEqual(
    withFileFallback(keychain, () => ({ ok: false, reason: "corrupt" })),
    keychain,
    "a bad file must not rename the keychain's failure",
  );
});

test("a keychain that answered is never second-guessed by the file", () => {
  const good = parseOAuthCredentials(blobWith({ accessToken: "from-keychain" }));
  assert.deepEqual(withFileFallback(good, () => { throw new Error("must not read"); }), good);

  // A blob that would not parse is the item the CLI owns: report it as corrupt.
  const corrupt = { ok: false, reason: "corrupt" };
  assert.deepEqual(withFileFallback(corrupt, () => { throw new Error("must not read"); }), corrupt);
});

test("a missing keychain item is told apart from a failed keychain read", () => {
  // security(1) exits 44 for errSecItemNotFound; execFileSync reports it as
  // `status`, promisified execFile as `code`.
  assert.equal(failureFromExec({ status: 44 }), "not-found");
  assert.equal(failureFromExec({ code: 44 }), "not-found");

  assert.equal(failureFromExec({ status: 36 }), "keychain-unavailable");
  assert.equal(failureFromExec({ code: "ENOENT" }), "keychain-unavailable");
  assert.equal(failureFromExec(new Error("no exit code")), "keychain-unavailable");
});
