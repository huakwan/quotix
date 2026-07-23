import assert from "node:assert/strict";
import test from "node:test";

import { UpdateCoordinator } from "../out/src/update/coordinator.js";

const release = {
  version: "1.0.7",
  tag: "v1.0.7",
  asset: {
    filename: "Quotix-v1.0.7-macos-arm64.zip",
    size: 10,
    sha256: "a".repeat(64),
    url: "https://github.com/huakwan/quotix/releases/download/v1.0.7/Quotix.zip",
  },
};

test("update coordinator checks, downloads, verifies, and installs through valid states", async () => {
  const states = [];
  let installed;
  const coordinator = new UpdateCoordinator({
    check: async () => ({ status: "available", release }),
    stage: async (_release, hooks) => {
      hooks.progress(42);
      hooks.verifying();
      return { version: "1.0.7", stagingRoot: "/tmp/update", appPath: "/tmp/update/Quotix.app" };
    },
    install: async (update) => { installed = update; return "installing"; },
    reveal: async () => undefined,
  });
  coordinator.subscribe((state) => states.push(state.status));
  await coordinator.check(true);
  assert.equal(coordinator.view().status, "available");
  await coordinator.download();
  assert.equal(coordinator.view().status, "ready");
  await coordinator.install();
  assert.equal(coordinator.view().status, "installing");
  assert.equal(installed.version, "1.0.7");
  assert.ok(states.includes("downloading"));
  assert.ok(states.includes("verifying"));
});

test("update coordinator is quiet for automatic errors and visible for manual errors", async () => {
  const coordinator = new UpdateCoordinator({
    check: async () => { throw new Error("secret network detail"); },
    stage: async () => { throw new Error("unused"); },
    install: async () => "installing",
    reveal: async () => undefined,
  });
  await coordinator.check(false);
  assert.equal(coordinator.view().status, "idle");
  await coordinator.check(true);
  assert.deepEqual(coordinator.view(), {
    status: "error",
    error: "Unable to check for updates.",
  });
});

test("update coordinator rejects duplicate invalid actions and cancels a download", async () => {
  let resolveStage;
  const coordinator = new UpdateCoordinator({
    check: async () => ({ status: "available", release }),
    stage: (_release, _hooks, signal) => new Promise((resolve, reject) => {
      resolveStage = resolve;
      signal.addEventListener("abort", () => reject(new Error("aborted")));
    }),
    install: async () => "installing",
    reveal: async () => undefined,
  });
  await assert.rejects(() => coordinator.download(), { code: "update_action_invalid" });
  await coordinator.check(true);
  const pending = coordinator.download();
  await assert.rejects(() => coordinator.download(), { code: "update_action_invalid" });
  coordinator.cancel();
  await pending;
  assert.equal(coordinator.view().status, "available");
  resolveStage?.();
});
