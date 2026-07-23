import assert from "node:assert/strict";
import test from "node:test";

import { UpdateCoordinator } from "../out/src/update/coordinator.js";
import { UpdateError } from "../out/src/update/model.js";

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

test("update coordinator keeps a verified update ready when install is cancelled", async () => {
  const coordinator = new UpdateCoordinator({
    check: async () => ({ status: "available", release }),
    stage: async () => ({
      version: "1.0.7", stagingRoot: "/tmp/update", appPath: "/tmp/update/Quotix.app",
    }),
    install: async () => { throw new UpdateError("install_cancelled"); },
    reveal: async () => undefined,
  });
  await coordinator.check(true);
  await coordinator.download();
  await coordinator.install();
  assert.deepEqual(coordinator.view(), { status: "ready", version: "1.0.7" });
});

test("update coordinator enters installing before awaiting preparation", async () => {
  let finishInstall;
  const coordinator = new UpdateCoordinator({
    check: async () => ({ status: "available", release }),
    stage: async () => ({
      version: "1.0.7", stagingRoot: "/tmp/update", appPath: "/tmp/update/Quotix.app",
    }),
    install: () => new Promise((resolve) => { finishInstall = resolve; }),
    reveal: async () => undefined,
  });
  await coordinator.check(true);
  await coordinator.download();
  const pending = coordinator.install();
  assert.deepEqual(coordinator.view(), { status: "installing", version: "1.0.7" });
  await assert.rejects(() => coordinator.install(), { code: "update_action_invalid" });
  finishInstall("installing");
  await pending;
});

test("a new successful check cleans an abandoned verified download", async () => {
  const cleaned = [];
  const coordinator = new UpdateCoordinator({
    currentVersion: "1.0.7",
    check: async () => ({ status: "available", release }),
    stage: async () => ({
      version: "1.0.7", stagingRoot: "/tmp/update", appPath: "/tmp/update/Quotix.app",
    }),
    install: async () => "installing",
    reveal: async () => undefined,
    cleanup: async (update) => { cleaned.push(update.stagingRoot); },
  });
  await coordinator.check(true);
  await coordinator.download();
  await coordinator.check(true);
  assert.deepEqual(cleaned, ["/tmp/update"]);
});
