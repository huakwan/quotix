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

function factories(events) {
  return {
    claude: () => fakeRuntime("claude", events),
    codex: () => fakeRuntime("codex", events),
    opencode: () => fakeRuntime("opencode", events),
  };
}

test("both creates and polls every provider", async () => {
  const events = [];
  const coordinator = new QuotaCoordinator(factories(events), ["claude", "codex", "opencode"]);
  await coordinator.pollEnabled();
  assert.deepEqual(
    events.filter((event) => event.startsWith("start:")).sort(),
    ["start:claude", "start:codex", "start:opencode"],
  );
  assert.equal(coordinator.snapshot().claude.enabled, true);
  assert.equal(coordinator.snapshot().codex.enabled, true);
  assert.equal(coordinator.snapshot().opencode.enabled, true);
});

test("changing sources disposes disabled runtime and immediately polls enabled runtime", async () => {
  const events = [];
  const coordinator = new QuotaCoordinator(factories(events), ["claude"]);
  coordinator.setSources(["codex"]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events.includes("dispose:claude"), true);
  assert.equal(events.includes("start:codex"), true);
  assert.equal(coordinator.snapshot().claude.enabled, false);
  assert.equal(coordinator.snapshot().opencode.enabled, false);
});

test("selecting OpenCode Go polls only its runtime and keeps the others off", async () => {
  const events = [];
  const coordinator = new QuotaCoordinator(factories(events), ["claude"]);
  coordinator.setSources(["opencode"]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    events.filter((event) => event.startsWith("start:")),
    ["start:opencode"],
  );
  assert.deepEqual(events.filter((event) => event.startsWith("dispose:")), ["dispose:claude"]);
  assert.equal(coordinator.snapshot().opencode.enabled, true);
  assert.equal(coordinator.snapshot().codex.enabled, false);
});
