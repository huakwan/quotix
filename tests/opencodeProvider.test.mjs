import { authFilePath, createCachedKeyProvider, parseAuthFile, readAuthFile, } from "../out/src/quota/opencode/credentials.js";
import { OpenCodeQuotaProvider } from "../out/src/quota/opencode/provider.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const unused = async () => { throw new Error("unused"); };

function harness(token, fetchImpl) {
  let invalidations = 0;
  const provider = new OpenCodeQuotaProvider({
    keyProvider: { get: async () => token, invalidate: () => { invalidations += 1; } },
    fetchImpl,
  });
  return { provider, invalidations: () => invalidations };
}

test("the CLI data directory is where the key is read from", () => {
  assert.equal(
    authFilePath({}, () => "/Users/dev"),
    join("/Users/dev", ".local", "share", "opencode", "auth.json"),
  );
  assert.equal(
    authFilePath({ XDG_DATA_HOME: "/volumes/data" }, () => "/Users/dev"),
    join("/volumes/data", "opencode", "auth.json"),
  );
});

test("the Go key wins and a Zen key is a usable fallback", () => {
  assert.deepEqual(
    parseAuthFile(JSON.stringify({ "opencode-go": { type: "api", key: "go-key" }, opencode: { type: "api", key: "zen-key" } })),
    { ok: true, token: "go-key" },
  );
  assert.deepEqual(
    parseAuthFile(JSON.stringify({ opencode: { type: "api", key: "zen-key" } })),
    { ok: true, token: "zen-key" },
  );
  assert.deepEqual(
    parseAuthFile(JSON.stringify({ opencode: { type: "oauth", access: "access-token", refresh: "r" } })),
    { ok: true, token: "access-token" },
  );
});

test("an unusable credential file reports its own cause", () => {
  assert.deepEqual(parseAuthFile("{not json"), { ok: false, reason: "corrupt" });
  assert.deepEqual(parseAuthFile("[]"), { ok: false, reason: "corrupt" });
  assert.deepEqual(parseAuthFile(JSON.stringify({ github: { type: "api", key: "x" } })), {
    ok: false, reason: "missing-key",
  });
  assert.deepEqual(parseAuthFile(JSON.stringify({ "opencode-go": { type: "api", key: "" } })), {
    ok: false, reason: "missing-key",
  });
});

test("a missing credentials file is not reported as corrupt", () => {
  const dir = mkdtempSync(join(tmpdir(), "quotix-opencode-"));
  assert.deepEqual(readAuthFile(join(dir, "absent.json")), { ok: false, reason: "not-found" });
  writeFileSync(join(dir, "auth.json"), JSON.stringify({ "opencode-go": { type: "api", key: "k" } }));
  assert.deepEqual(readAuthFile(join(dir, "auth.json")), { ok: true, token: "k" });
});

test("the cached key provider re-reads after a failure and on invalidation", async () => {
  let reads = 0;
  const result = () => { reads += 1; return reads === 1 ? { ok: false, reason: "not-found" } : { ok: true, token: "k" }; };
  const provider = createCachedKeyProvider({
    readSync: result,
    readAsync: async () => result(),
    now: () => 0,
    rereadMs: 30_000,
  });
  assert.deepEqual(await provider.get(), { ok: true, token: "k" });
  assert.equal(reads, 2);
  provider.invalidate();
  await provider.get();
  assert.equal(reads, 3);
});

test("OpenCode Go usage maps to the shared quota windows", async () => {
  const calls = [];
  const h = harness({ ok: true, token: "secret-key" }, async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({
      usage: {
        rolling: { status: "ok", percent: 6, resetsAt: "1970-01-01T00:05:00.000Z" },
        weekly: { status: "ok", percent: 42.5, resetsAt: "1970-01-01T00:10:00.000Z" },
        monthly: { status: "warning", percent: 91, resetsAt: "1970-01-01T00:15:00.000Z" },
      },
    }), { status: 200 });
  });
  const result = await h.provider.read(100);
  assert.equal(result.ok, true);
  assert.deepEqual(result.quota, {
    updatedAt: 100,
    session: { usedPct: 6, resetsAt: 300 },
    weekly: { usedPct: 42.5, resetsAt: 600 },
    monthly: { usedPct: 91, resetsAt: 900 },
    weeklyModels: [],
    planDetected: true,
  });
  assert.equal(calls[0].url, "https://opencode.ai/zen/go/v1/usage");
  assert.equal(calls[0].init.headers.Authorization, "Bearer secret-key");
});

test("absent or malformed windows stay null", async () => {
  const h = harness({ ok: true, token: "k" }, async () => new Response(JSON.stringify({
    usage: { rolling: { percent: 4 }, weekly: { percent: "high" }, monthly: null },
  }), { status: 200 }));
  const result = await h.provider.read(7);
  assert.equal(result.ok, true);
  assert.deepEqual(result.quota.session, { usedPct: 4, resetsAt: null });
  assert.equal(result.quota.weekly, null);
  assert.equal(result.quota.monthly, null);
  assert.equal(result.quota.planDetected, true);
});

test("an empty payload reports no plan rather than a fake zero", async () => {
  const h = harness({ ok: true, token: "k" }, async () => new Response("{}", { status: 200 }));
  const result = await h.provider.read(7);
  assert.equal(result.ok, true);
  assert.deepEqual(result.quota, {
    updatedAt: 7,
    session: null,
    weekly: null,
    monthly: null,
    weeklyModels: [],
    planDetected: false,
  });
});

test("each credential failure reports its own cause", async () => {
  const cases = [
    ["not-found", "missing", "No OpenCode credentials file found. Sign in with the OpenCode CLI"],
    ["missing-key", "missing", "No OpenCode Go API key stored. Add it with opencode auth login"],
    ["corrupt", "missing", "The OpenCode credentials file could not be parsed. Add your key with opencode auth login"],
    ["unreadable", "transient", "Could not read the OpenCode credentials file"],
  ];
  for (const [reason, kind, error] of cases) {
    const h = harness({ ok: false, reason }, unused);
    assert.deepEqual(await h.provider.read(100), { ok: false, kind, error }, reason);
  }
});

test("401 invalidates the cached key without echoing it", async () => {
  const h = harness({ ok: true, token: "super-secret" }, async () => new Response(JSON.stringify({
    type: "error", error: { type: "AuthError", message: "Unauthorized" },
  }), { status: 401 }));
  const result = await h.provider.read(100);
  assert.equal(result.ok, false);
  assert.equal(result.kind, "auth");
  assert.ok(!result.error.includes("super-secret"));
  assert.equal(h.invalidations(), 1);
});

test("403 is a subscription problem the user has to fix", async () => {
  const h = harness({ ok: true, token: "k" }, async () => new Response("", { status: 403 }));
  assert.deepEqual(await h.provider.read(100), {
    ok: false, kind: "missing", error: "This OpenCode account has no OpenCode Go subscription",
  });
});

test("429 exposes retry-after seconds", async () => {
  const h = harness({ ok: true, token: "k" }, async () => new Response("", {
    status: 429, headers: { "retry-after": "45" },
  }));
  assert.deepEqual(await h.provider.read(100), {
    ok: false, kind: "rate-limited", error: "HTTP 429", retryAfterSeconds: 45,
  });
});

test("other statuses and network failures are transient", async () => {
  const server = harness({ ok: true, token: "k" }, async () => new Response("", { status: 503 }));
  assert.deepEqual(await server.provider.read(100), { ok: false, kind: "transient", error: "HTTP 503" });

  const offline = harness({ ok: true, token: "k" }, async () => { throw new TypeError("fetch failed"); });
  assert.deepEqual(await offline.provider.read(100), {
    ok: false, kind: "transient", error: "Network error (TypeError)",
  });

  const garbage = harness({ ok: true, token: "k" }, async () => new Response("<html>", { status: 200 }));
  assert.equal((await garbage.provider.read(100)).ok, false);
});
