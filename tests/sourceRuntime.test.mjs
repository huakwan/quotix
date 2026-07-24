import assert from "node:assert/strict";
import test from "node:test";

import { SourceRuntime } from "../out/src/quota/sourceRuntime.js";

const quota = { updatedAt: 100, session: { usedPct: 10, resetsAt: 500 }, weekly: null, planDetected: true };

function harness(results, cached = null) {
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
  const runtime = new SourceRuntime(provider, cache, { nowMs: () => nowMs });
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

  const request = h.runtime.poll(true);
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

test("in-flight polls are deduplicated even for manual refresh", async () => {
  let resolve;
  const pending = new Promise((done) => { resolve = done; });
  const h = harness([]);
  h.provider.read = async () => { h.provider.calls += 1; return pending; };
  const first = h.runtime.poll();
  const second = h.runtime.poll(true);
  assert.equal(h.provider.calls, 1);
  resolve({ ok: true, quota });
  await Promise.all([first, second]);
});

test("rate-limit backoff blocks scheduled polls but manual refresh can recover", async () => {
  const h = harness([
    { ok: false, kind: "rate-limited", error: "429", retryAfterSeconds: 60 },
    { ok: true, quota },
  ]);
  await h.runtime.poll();
  h.setNow(30_000);
  await h.runtime.poll();
  assert.equal(h.provider.calls, 1);
  await h.runtime.poll(true);
  assert.equal(h.provider.calls, 2);
  assert.deepEqual(h.runtime.state().lastGood, quota);
});

test("manual refresh bypasses an active backoff only once", async () => {
  const h = harness([
    { ok: false, kind: "rate-limited", error: "429", retryAfterSeconds: 60 },
    { ok: false, kind: "rate-limited", error: "429", retryAfterSeconds: 60 },
    { ok: true, quota },
  ]);
  await h.runtime.poll();
  h.setNow(30_000);
  await h.runtime.poll(true);
  await h.runtime.poll(true);
  assert.equal(h.provider.calls, 2);
  h.setNow(150_000);
  await h.runtime.poll(true);
  assert.equal(h.provider.calls, 3);
});

test("repeated scheduled rate limits still grow exponential backoff", async () => {
  const h = harness([
    { ok: false, kind: "rate-limited", error: "429", retryAfterSeconds: 60 },
    { ok: false, kind: "rate-limited", error: "429", retryAfterSeconds: 60 },
    { ok: true, quota },
  ]);
  await h.runtime.poll();
  h.setNow(60_000);
  await h.runtime.poll();
  assert.equal(h.provider.calls, 2);
  h.setNow(179_000);
  await h.runtime.poll();
  assert.equal(h.provider.calls, 2);
  h.setNow(180_000);
  await h.runtime.poll();
  assert.equal(h.provider.calls, 3);
});

test("rate-limit backoff starts when the failed request finishes", async () => {
  let resolve;
  const pending = new Promise((done) => { resolve = done; });
  const h = harness([{ ok: true, quota }]);
  h.provider.read = async () => { h.provider.calls += 1; return pending; };
  const request = h.runtime.poll();
  h.setNow(30_000);
  resolve({ ok: false, kind: "rate-limited", error: "429", retryAfterSeconds: 60 });
  await request;
  h.provider.read = async () => { h.provider.calls += 1; return { ok: true, quota }; };
  h.setNow(60_000);
  await h.runtime.poll();
  assert.equal(h.provider.calls, 1);
  h.setNow(90_000);
  await h.runtime.poll();
  assert.equal(h.provider.calls, 2);
});
