import assert from "node:assert/strict";
import test from "node:test";

import { ClaudeQuotaProvider } from "../out/src/quota/claude/provider.js";

function harness(token, fetchImpl) {
  let invalidations = 0;
  const provider = new ClaudeQuotaProvider({
    tokenProvider: { get: async () => token, invalidate: () => { invalidations += 1; } },
    fetchImpl,
  });
  return { provider, invalidations: () => invalidations };
}

const unused = async () => { throw new Error("unused"); };

test("each credential failure reports its own cause", async () => {
  const cases = [
    ["not-found", "missing", "No Claude Code credentials in the Keychain. Sign in with the Claude Code CLI"],
    ["corrupt", "missing", "The Claude Code credential could not be parsed. Sign in with the Claude Code CLI"],
    ["unsupported-platform", "missing", "Claude Code credentials are only readable on macOS"],
    ["keychain-unavailable", "transient", "Could not read the Claude Code credential from the Keychain"],
    ["expired", "transient", "The Claude Code access token expired. Run Claude Code to renew it"],
  ];
  for (const [reason, kind, error] of cases) {
    const h = harness({ ok: false, reason }, unused);
    assert.deepEqual(await h.provider.read(100), { ok: false, kind, error }, reason);
  }
});

test("no credential failure claims the token was simply not found", async () => {
  for (const reason of ["keychain-unavailable", "corrupt", "expired", "unsupported-platform"]) {
    const h = harness({ ok: false, reason }, unused);
    const result = await h.provider.read(100);
    assert.notEqual(result.error, "Claude Code credentials were not found", reason);
  }
});

test("successful OAuth usage maps to shared quota", async () => {
  const h = harness({ ok: true, token: "secret" }, async () => new Response(JSON.stringify({
    five_hour: { utilization: 12, resets_at: "1970-01-01T00:03:20.000Z" },
    seven_day: { utilization: 34, resets_at: "1970-01-01T00:06:40.000Z" },
  }), { status: 200 }));
  const result = await h.provider.read(100);
  assert.equal(result.ok, true);
  assert.equal(result.quota.updatedAt, 100);
  assert.equal(result.quota.session.usedPct, 12);
  assert.equal(result.quota.weekly.resetsAt, 400);
});

test("per-model weekly limits surface as weeklyModels, active or not", async () => {
  const h = harness({ ok: true, token: "secret" }, async () => new Response(JSON.stringify({
    five_hour: { utilization: 12, resets_at: "1970-01-01T00:03:20.000Z" },
    seven_day: { utilization: 34, resets_at: "1970-01-01T00:06:40.000Z" },
    limits: [
      { kind: "session", group: "session", percent: 12, resets_at: "1970-01-01T00:03:20.000Z" },
      { kind: "weekly_all", group: "weekly", percent: 34, resets_at: "1970-01-01T00:06:40.000Z" },
      {
        kind: "weekly_scoped", group: "weekly", percent: 5, resets_at: "1970-01-01T00:06:40.000Z",
        scope: { model: { id: null, display_name: "Fable" } },
      },
      { kind: "weekly_scoped", group: "weekly", percent: 0, resets_at: null, scope: { model: { display_name: "Inactive" } } },
      { kind: "weekly_scoped", group: "weekly", percent: 0, resets_at: null, scope: { model: null } },
    ],
  }), { status: 200 }));
  const result = await h.provider.read(100);
  assert.equal(result.ok, true);
  assert.deepEqual(result.quota.weeklyModels, [
    { model: "Fable", window: { usedPct: 5, resetsAt: 400 } },
    { model: "Inactive", window: null },
  ]);
});

test("401 invalidates the cached token", async () => {
  const h = harness({ ok: true, token: "secret" }, async () => new Response("", { status: 401 }));
  assert.deepEqual(await h.provider.read(100), { ok: false, kind: "auth", error: "HTTP 401" });
  assert.equal(h.invalidations(), 1);
});

test("429 exposes retry-after seconds", async () => {
  const h = harness({ ok: true, token: "secret" }, async () => new Response("", {
    status: 429, headers: { "retry-after": "90" },
  }));
  assert.deepEqual(await h.provider.read(100), {
    ok: false, kind: "rate-limited", error: "HTTP 429", retryAfterSeconds: 90,
  });
});

test("429 omits retry-after when the header is absent or non-positive", async () => {
  for (const headers of [{}, { "retry-after": "0" }, { "retry-after": "later" }]) {
    const h = harness({ ok: true, token: "secret" }, async () => new Response("", {
      status: 429, headers,
    }));
    assert.deepEqual(await h.provider.read(100), {
      ok: false, kind: "rate-limited", error: "HTTP 429", retryAfterSeconds: undefined,
    });
  }
});

test("network failures become safe transient diagnostics", async () => {
  const h = harness({ ok: true, token: "secret" }, async () => { throw new TypeError("token in URL"); });
  assert.deepEqual(await h.provider.read(100), {
    ok: false, kind: "transient", error: "Network error (TypeError)",
  });
});
