import assert from "node:assert/strict";
import test from "node:test";

import { QuotaCoordinator } from "../out/src/quota/coordinator.js";

function fakeRuntime(id, events) {
  let listener = () => {};
  const state = { enabled: true, loading: false, result: { ok: false, reason: "missing" }, lastGood: null };
  return {
    id,
    polls: 0,
    disposed: false,
    state: () => state,
    subscribe: (cb) => { listener = cb; return () => { listener = () => {}; }; },
    poll: async () => { events.push(`start:${id}`); await Promise.resolve(); events.push(`end:${id}`); },
    dispose: () => { events.push(`dispose:${id}`); },
  };
}

test("both creates and polls both providers", async () => {
  const events = [];
  const coordinator = new QuotaCoordinator({
    claude: () => fakeRuntime("claude", events),
    codex: () => fakeRuntime("codex", events),
  }, "both");
  await coordinator.pollEnabled();
  assert.deepEqual(events.slice(0, 2).sort(), ["start:claude", "start:codex"]);
  assert.equal(coordinator.snapshot().claude.enabled, true);
  assert.equal(coordinator.snapshot().codex.enabled, true);
});

test("changing source disposes disabled runtime and immediately polls enabled runtime", async () => {
  const events = [];
  const coordinator = new QuotaCoordinator({
    claude: () => fakeRuntime("claude", events),
    codex: () => fakeRuntime("codex", events),
  }, "claude");
  coordinator.setSource("codex");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events.includes("dispose:claude"), true);
  assert.equal(events.includes("start:codex"), true);
  assert.equal(coordinator.snapshot().claude.enabled, false);
});
