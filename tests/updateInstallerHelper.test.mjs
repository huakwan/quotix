import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  appLaunchEnvironment,
  runInstallTransaction,
} from "../out/src/update/installerHelper.js";
import { writeJsonAtomic } from "../out/src/update/transaction.js";

function transaction() {
  return {
    schemaVersion: 1,
    version: "1.0.7",
    stagingRoot: "/tmp/update",
    installedApp: "/Applications/Quotix.app",
    stagedApp: "/tmp/update/Quotix.app",
    backupApp: "/Applications/Quotix.app.update-backup-aaaaaaaaaaaa",
    markerPath: "/tmp/update/launch-success",
    resultPath: "/tmp/update/install-result.json",
    token: "a".repeat(64),
    originalPid: 123,
    phase: "prepared",
  };
}

function fakeDeps(options = {}) {
  const calls = [];
  let marker = false;
  let backupCleanupFailures = options.backupCleanupFailures
    ?? (options.failBackupCleanup ? Number.POSITIVE_INFINITY : 0);
  return {
    calls,
    deps: {
      waitForExit: async (pid) => { calls.push(["wait", pid]); },
      rename: async (from, to) => {
        calls.push(["rename", from, to]);
        if (options.failRename === `${from}->${to}`) { throw new Error("rename failed"); }
      },
      rm: async (path) => {
        calls.push(["rm", path]);
        if (backupCleanupFailures > 0 && path.includes("update-backup")) {
          backupCleanupFailures -= 1;
          throw new Error("backup cleanup failed");
        }
      },
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
    ["rename", "/Applications/Quotix.app", "/Applications/Quotix.app.update-backup-aaaaaaaaaaaa"],
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

test("installer helper keeps the successful new app when backup cleanup fails", async () => {
  const { deps, calls } = fakeDeps({ failBackupCleanup: true });
  await runInstallTransaction(transaction(), deps);
  assert.ok(calls.some(([name, result]) => name === "result" && result.status === "success"));
  assert.equal(
    calls.some((call) =>
      call[0] === "rename"
      && call[1].includes("update-backup")
      && call[2] === "/Applications/Quotix.app"),
    false,
  );
  assert.equal(
    calls.filter(([name, path]) => name === "rm" && path.includes("update-backup")).length,
    3,
  );
});

test("installer helper retries a transient backup cleanup failure", async () => {
  const { deps, calls } = fakeDeps({ backupCleanupFailures: 1 });
  await runInstallTransaction(transaction(), deps);
  assert.equal(
    calls.filter(([name, path]) => name === "rm" && path.includes("update-backup")).length,
    2,
  );
});

test("installer helper does not roll back a healthy app for post-marker bookkeeping failure", async () => {
  const { deps, calls } = fakeDeps();
  deps.writeTransaction = async (value) => {
    calls.push(["phase", value.phase]);
    if (value.phase === "complete") { throw new Error("disk diagnostic failure"); }
  };
  deps.writeResult = async () => { throw new Error("result diagnostic failure"); };
  await runInstallTransaction(transaction(), deps);
  assert.equal(
    calls.some((call) =>
      call[0] === "rename"
      && call[1].includes("update-backup")
      && call[2] === "/Applications/Quotix.app"),
    false,
  );
});

test("installer helper relaunches the unchanged app when its first rename fails", async () => {
  const tx = transaction();
  const { deps, calls } = fakeDeps({
    failRename: `${tx.installedApp}->${tx.backupApp}`,
  });
  await assert.rejects(() => runInstallTransaction(tx, deps));
  assert.ok(calls.some((call) =>
    call[0] === "launch"
    && call[1] === "/Applications/Quotix.app/Contents/MacOS/Quotix"
    && call[2][0] === "--quotix-update-rollback"));
});

test("installer helper rejects unrelated destructive paths before doing work", async () => {
  const tx = transaction();
  tx.installedApp = "/tmp/victim";
  const { deps, calls } = fakeDeps();
  await assert.rejects(() => runInstallTransaction(tx, deps), { code: "transaction_invalid" });
  assert.deepEqual(calls, []);
});

test("installer helper never passes Electron Node mode into launched apps", () => {
  assert.deepEqual(
    appLaunchEnvironment({
      PATH: "/usr/bin",
      ELECTRON_RUN_AS_NODE: "1",
      QUOTIX_TEST: "yes",
    }),
    { PATH: "/usr/bin", QUOTIX_TEST: "yes" },
  );
});

test("installer helper replaces an app using the real filesystem transaction", async () => {
  const root = await mkdtemp(join(tmpdir(), "quotix-helper-"));
  const stagingRoot = join(root, "updates", "update-real");
  const installedApp = join(root, "Applications", "Quotix.app");
  const stagedApp = join(stagingRoot, "Quotix.app");
  const token = "d".repeat(64);
  await mkdir(installedApp, { recursive: true });
  await mkdir(stagedApp, { recursive: true });
  await import("node:fs/promises").then(({ writeFile }) => Promise.all([
    writeFile(join(installedApp, "version"), "old"),
    writeFile(join(stagedApp, "version"), "new"),
  ]));
  const tx = {
    schemaVersion: 1,
    version: "1.0.7",
    stagingRoot,
    installedApp,
    stagedApp,
    backupApp: `${installedApp}.update-backup-${token.slice(0, 12)}`,
    markerPath: join(stagingRoot, "launch-success"),
    resultPath: join(stagingRoot, "install-result.json"),
    token,
    originalPid: 123,
    phase: "prepared",
  };
  let marker = null;
  await runInstallTransaction(tx, {
    waitForExit: async () => undefined,
    rename,
    rm: (path) => rm(path, { recursive: true, force: true }),
    writeTransaction: (value) => writeJsonAtomic(join(stagingRoot, "install-transaction.json"), value),
    writeResult: (value) => writeJsonAtomic(tx.resultPath, value),
    launch: async () => {
      marker = token;
      return { kill: () => undefined };
    },
    readMarker: async () => marker,
    wait: async () => undefined,
    now: Date.now,
  });
  assert.equal(await readFile(join(installedApp, "version"), "utf8"), "new");
  await assert.rejects(() => stat(tx.backupApp));
  assert.equal(JSON.parse(await readFile(tx.resultPath, "utf8")).status, "success");
});
