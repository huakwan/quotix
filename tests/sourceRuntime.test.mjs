import assert from "node:assert/strict";
import test from "node:test";

import { SourceRuntime } from "../out/src/quota/sourceRuntime.js";

const quota = { updatedAt: 100, session: { usedPct: 10, resetsAt: 500 }, weekly: null, planDetected: true };

// Deterministic policy: 1 min spacing, 5 min quiet after a 429 growing 1.5x to a
// 10 min ceiling, jitter disabled so waits are exact.
const policy = {
  minSpacingMs: 60_000,
  minBackoffMs: 300_000,
  maxBackoffMs: 600_000,
  growth: 1.5,
  jitterMs: 0,
};

function harness(results, cached = null, { random = () => 0, ...policyOverrides } = {}) {
  let nowMs = 0;
  let saved = null;
  const provider = {
    id: "claude",
    calls: 0,
    disposed: false,
    read: async () => { provider.calls += 1; return results.shift(); },
    dispose: () => { provider.disposed = true; },
  };
  const cache = { path: "/cache", load: () => cached, save: (value) => { saved = value; } };
  const runtime = new SourceRuntime(provider, cache, {
    nowMs: () => nowMs,
    random,
    policy: { ...policy, ...policyOverrides },
  });
  return { provider, runtime, setNow: (value) => { nowMs = value; }, saved: () => saved };
}

test("runtime seeds its state from last-good cache", () => {
  const { runtime } = harness([], quota);
  assert.equal(runtime.state().loading, false);
  assert.deepEqual(runtime.state().lastGood, quota);
  assert.deepEqual(runtime.state().result, { ok: true, quota });
});

test("runtime saves success and exposes it", async () => {
  const fresh = { ...quota, updatedAt: 200 };
  const h = harness([{ ok: true, quota: fresh }]);
  await h.runtime.poll();
  assert.deepEqual(h.runtime.state().lastGood, fresh);
  assert.deepEqual(h.saved(), fresh);
});

test("runtime reports loading while refreshing cached quota", async () => {
  let resolve;
  const pending = new Promise((done) => { resolve = done; });
  const h = harness([], quota);
  h.provider.read = async () => pending;

  const request = h.runtime.poll();
  assert.equal(h.runtime.state().loading, true);
  resolve({ ok: true, quota });
  await request;
  assert.equal(h.runtime.state().loading, false);
});

test("transient failure retains last-good data with diagnostic", async () => {
  const h = harness([{ ok: false, kind: "transient", error: "offline" }], quota);
  await h.runtime.poll();
  assert.deepEqual(h.runtime.state().result, { ok: true, quota, diagnostic: "offline" });
});

test("missing provider without cache becomes unavailable", async () => {
  const h = harness([{ ok: false, kind: "missing", error: "not found" }]);
  await h.runtime.poll();
  assert.deepEqual(h.runtime.state().result, { ok: false, reason: "missing", error: "not found" });
});

test("in-flight polls are deduplicated", async () => {
  let resolve;
  const pending = new Promise((done) => { resolve = done; });
  const h = harness([]);
  h.provider.read = async () => { h.provider.calls += 1; return pending; };
  const first = h.runtime.poll();
  const second = h.runtime.poll();
  assert.equal(h.provider.calls, 1);
  resolve({ ok: true, quota });
  await Promise.all([first, second]);
});

test("minimum spacing caps how often any caller can reach the provider", async () => {
  const h = harness([{ ok: true, quota }, { ok: true, quota }]);
  await h.runtime.poll();
  h.setNow(59_999);
  await h.runtime.poll();
  assert.equal(h.provider.calls, 1);
  assert.equal(h.runtime.waitMs(), 1);
  h.setNow(60_000);
  await h.runtime.poll();
  assert.equal(h.provider.calls, 2);
});

test("a 429 stays quiet for the policy minimum despite retry-after 0", async () => {
  const h = harness([
    { ok: false, kind: "rate-limited", error: "429", retryAfterSeconds: undefined },
    { ok: true, quota },
  ], quota);
  await h.runtime.poll();
  assert.equal(h.runtime.waitMs(), 300_000);
  h.setNow(299_999);
  await h.runtime.poll();
  assert.equal(h.provider.calls, 1);
  h.setNow(300_000);
  await h.runtime.poll();
  assert.equal(h.provider.calls, 2);
});

test("manual refresh cannot bypass an active rate-limit backoff", async () => {
  const h = harness([
    { ok: false, kind: "rate-limited", error: "429" },
    { ok: true, quota },
  ], quota);
  await h.runtime.poll();
  h.setNow(120_000);
  await h.runtime.poll();
  await h.runtime.poll();
  assert.equal(h.provider.calls, 1);
});

test("consecutive rate limits grow the quiet period up to the ceiling", async () => {
  const h = harness([
    { ok: false, kind: "rate-limited", error: "429" },
    { ok: false, kind: "rate-limited", error: "429" },
    { ok: false, kind: "rate-limited", error: "429" },
  ], quota);
  await h.runtime.poll();
  h.setNow(300_000);
  await h.runtime.poll();
  assert.equal(h.runtime.waitMs(), 450_000); // 300_000 * 1.5
  h.setNow(750_000);
  await h.runtime.poll();
  assert.equal(h.runtime.waitMs(), 600_000); // 300_000 * 2.25 clamped to the ceiling
});

test("a server retry-after longer than the ceiling is honoured", async () => {
  const h = harness([{ ok: false, kind: "rate-limited", error: "429", retryAfterSeconds: 3600 }], quota);
  await h.runtime.poll();
  assert.equal(h.runtime.waitMs(), 3_600_000);
});

test("jitter spreads the quiet period so pollers do not retry in lockstep", async () => {
  const h = harness(
    [{ ok: false, kind: "rate-limited", error: "429" }],
    quota,
    { jitterMs: 30_000, random: () => 1 },
  );
  await h.runtime.poll();
  assert.equal(h.runtime.waitMs(), 330_000);
});

test("a successful poll clears the rate-limit backoff", async () => {
  const h = harness([
    { ok: false, kind: "rate-limited", error: "429" },
    { ok: true, quota },
    { ok: true, quota },
  ], quota);
  await h.runtime.poll();
  h.setNow(300_000);
  await h.runtime.poll();
  assert.equal(h.provider.calls, 2);
  assert.equal(h.runtime.waitMs(), 60_000); // spacing only, no backoff left
});

test("rate-limit backoff starts when the failed request finishes", async () => {
  let resolve;
  const pending = new Promise((done) => { resolve = done; });
  const h = harness([], quota);
  h.provider.read = async () => { h.provider.calls += 1; return pending; };
  const request = h.runtime.poll();
  h.setNow(30_000);
  resolve({ ok: false, kind: "rate-limited", error: "429" });
  await request;
  h.provider.read = async () => { h.provider.calls += 1; return { ok: true, quota }; };
  h.setNow(300_000);
  await h.runtime.poll();
  assert.equal(h.provider.calls, 1);
  h.setNow(330_000);
  await h.runtime.poll();
  assert.equal(h.provider.calls, 2);
});
