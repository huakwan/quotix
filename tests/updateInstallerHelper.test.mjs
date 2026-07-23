import assert from "node:assert/strict";
import test from "node:test";

import { runInstallTransaction } from "../out/src/update/installerHelper.js";

function transaction() {
  return {
    schemaVersion: 1,
    version: "1.0.7",
    installedApp: "/Applications/Quotix.app",
    stagedApp: "/tmp/update/Quotix.app",
    backupApp: "/Applications/Quotix.app.update-backup-abc",
    markerPath: "/tmp/update/success",
    resultPath: "/tmp/update/result.json",
    token: "a".repeat(64),
    originalPid: 123,
    phase: "prepared",
  };
}

function fakeDeps(options = {}) {
  const calls = [];
  let marker = false;
  return {
    calls,
    deps: {
      waitForExit: async (pid) => { calls.push(["wait", pid]); },
      rename: async (from, to) => {
        calls.push(["rename", from, to]);
        if (options.failRename === `${from}->${to}`) { throw new Error("rename failed"); }
      },
      rm: async (path) => { calls.push(["rm", path]); },
      writeTransaction: async (value) => { calls.push(["phase", value.phase]); },
      writeResult: async (value) => { calls.push(["result", value]); },
      launch: async (path, args) => {
        calls.push(["launch", path, args]);
        if (options.failLaunch && args.some((arg) => arg.startsWith("--quotix-update-token="))) {
          throw new Error("launch failed");
        }
        marker = options.marker !== false;
        return { pid: 456, kill: () => calls.push(["kill", 456]) };
      },
      readMarker: async () => marker ? "a".repeat(64) : null,
      wait: async () => undefined,
      now: (() => {
        let now = 0;
        return () => { now += options.marker === false ? 31_000 : 1; return now; };
      })(),
    },
  };
}

test("installer helper replaces, validates, and then removes backup", async () => {
  const { deps, calls } = fakeDeps();
  await runInstallTransaction(transaction(), deps);
  assert.deepEqual(calls.filter(([name]) => name === "rename"), [
    ["rename", "/Applications/Quotix.app", "/Applications/Quotix.app.update-backup-abc"],
    ["rename", "/tmp/update/Quotix.app", "/Applications/Quotix.app"],
  ]);
  assert.ok(calls.some(([name, path]) => name === "rm" && path.includes("update-backup")));
  assert.ok(calls.some(([name, result]) => name === "result" && result.status === "success"));
});

test("installer helper rolls back launch failure and marker timeout", async () => {
  for (const options of [{ failLaunch: true }, { marker: false }]) {
    const { deps, calls } = fakeDeps(options);
    await assert.rejects(() => runInstallTransaction(transaction(), deps));
    assert.ok(calls.some((call) =>
      call[0] === "rename"
      && call[1].includes("update-backup")
      && call[2] === "/Applications/Quotix.app"));
    assert.ok(calls.some(([name, result]) => name === "result" && result.status === "rolled-back"));
  }
});

test("installer helper restores backup when moving the staged app fails", async () => {
  const tx = transaction();
  const { deps, calls } = fakeDeps({
    failRename: `${tx.stagedApp}->${tx.installedApp}`,
  });
  await assert.rejects(() => runInstallTransaction(tx, deps));
  assert.ok(calls.some((call) =>
    call[0] === "rename"
    && call[1] === tx.backupApp
    && call[2] === tx.installedApp));
});
