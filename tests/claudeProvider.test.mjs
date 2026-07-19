import assert from "node:assert/strict";
import test from "node:test";

import { ClaudeQuotaProvider } from "../out/src/quota/claude/provider.js";

function harness(token, fetchImpl) {
  let invalidations = 0;
  const provider = new ClaudeQuotaProvider({
    tokenProvider: { get: () => token, invalidate: () => { invalidations += 1; } },
    fetchImpl,
  });
  return { provider, invalidations: () => invalidations };
}

test("missing token maps to missing provider", async () => {
  const h = harness({ ok: false, reason: "keychain-unavailable" }, async () => { throw new Error("unused"); });
  assert.deepEqual(await h.provider.read(100), {
    ok: false, kind: "missing", error: "Claude Code credentials were not found",
  });
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

test("network failures become safe transient diagnostics", async () => {
  const h = harness({ ok: true, token: "secret" }, async () => { throw new TypeError("token in URL"); });
  assert.deepEqual(await h.provider.read(100), {
    ok: false, kind: "transient", error: "Network error (TypeError)",
  });
});
