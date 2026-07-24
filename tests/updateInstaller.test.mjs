import assert from "node:assert/strict";
import test from "node:test";

import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acknowledgeUpdatedLaunch,
  installVerifiedUpdate,
  removeVerifiedQuarantine,
  waitForInstallerExit,
} from "../out/src/update/installer.js";

test("installer never removes quarantine without consent", async () => {
  const calls = [];
  const result = await removeVerifiedQuarantine({
    stagingRoot: "/tmp/quotix/update-1",
    appPath: "/tmp/quotix/update-1/Quotix.app",
    confirm: async () => false,
    realpath: async (path) => path,
    execFile: async (...args) => { calls.push(args); },
  });
  assert.equal(result, false);
  assert.deepEqual(calls, []);
});

test("installer removes quarantine only from the exact contained verified app", async () => {
  const calls = [];
  const result = await removeVerifiedQuarantine({
    stagingRoot: "/tmp/quotix/update-1",
    appPath: "/tmp/quotix/update-1/Quotix.app",
    confirm: async () => true,
    realpath: async (path) => path,
    execFile: async (...args) => { calls.push(args); },
  });
  assert.equal(result, true);
  assert.deepEqual(calls, [[
    "/usr/bin/xattr",
    ["-dr", "com.apple.quarantine", "/tmp/quotix/update-1/Quotix.app"],
  ]]);
});

test("installer rejects changed or prefix-confused staging paths", async () => {
  for (const appPath of [
    "/tmp/quotix/update-1-evil/Quotix.app",
    "/tmp/quotix/update-1/../evil/Quotix.app",
  ]) {
    await assert.rejects(() => removeVerifiedQuarantine({
      stagingRoot: "/tmp/quotix/update-1",
      appPath,
      confirm: async () => true,
      realpath: async (path) => path,
      execFile: async () => undefined,
    }), { code: "install_path_changed" });
  }
});

test("installer reveals the verified app when quarantine removal fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "quotix-install-"));
  const installedApp = join(root, "Applications", "Quotix.app");
  const stagedApp = join(root, "updates", "update-1", "Quotix.app");
  await mkdir(join(installedApp, "Contents", "MacOS"), { recursive: true });
  await mkdir(stagedApp, { recursive: true });
  const revealed = [];
  const result = await installVerifiedUpdate({
    update: { version: "1.0.7", stagingRoot: join(root, "updates", "update-1"), appPath: stagedApp },
    execPath: join(installedApp, "Contents", "MacOS", "Quotix"),
    helperSource: join(root, "helper.js"),
    originalPid: 123,
    confirm: async () => true,
    quarantineRealpath: async (path) => path,
    quarantineExecFile: async () => { throw new Error("xattr denied"); },
    reveal: (path) => revealed.push(path),
    spawnHelper: () => { throw new Error("must not spawn"); },
    quit: () => { throw new Error("must not quit"); },
  });
  assert.equal(result, "fallback");
  assert.deepEqual(revealed, [stagedApp]);
});

test("updated launch acknowledgement validates the transaction before creating its marker", async () => {
  const root = await mkdtemp(join(tmpdir(), "quotix-ack-"));
  const updatesRoot = join(root, "updates");
  const stagingRoot = join(updatesRoot, "update-1");
  const token = "c".repeat(64);
  const markerPath = join(stagingRoot, "launch-success");
  const installedApp = join(root, "Applications", "Quotix.app");
  const transaction = {
    schemaVersion: 1,
    version: "1.0.7",
    stagingRoot,
    installedApp,
    stagedApp: join(stagingRoot, "Quotix.app"),
    backupApp: `${installedApp}.update-backup-${token.slice(0, 12)}`,
    markerPath,
    resultPath: join(stagingRoot, "install-result.json"),
    token,
    originalPid: 123,
    phase: "launching",
  };
  await mkdir(stagingRoot, { recursive: true });
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(join(stagingRoot, "install-transaction.json"), JSON.stringify(transaction)));
  const acknowledged = await acknowledgeUpdatedLaunch([
    `--quotix-update-token=${token}`,
    `--quotix-update-marker=${markerPath}`,
  ], root, "1.0.7");
  assert.equal(acknowledged.transactionPath, join(stagingRoot, "install-transaction.json"));
  await assert.rejects(() => acknowledgeUpdatedLaunch([
    `--quotix-update-token=${token}`,
    `--quotix-update-marker=${markerPath}`,
  ], root, "9.9.9"), { code: "launch_acknowledgement_invalid" });
});

test("installer does not quit until helper startup is confirmed", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "quotix-helper-spawn-")));
  const installedApp = join(root, "Applications", "Quotix.app");
  const stagingRoot = join(root, "updates", "update-1");
  const stagedApp = join(stagingRoot, "Quotix.app");
  const helperSource = join(root, "installerHelper.js");
  await mkdir(join(installedApp, "Contents", "MacOS"), { recursive: true });
  await mkdir(stagedApp, { recursive: true });
  await writeFile(helperSource, "helper");
  let quit = false;
  await assert.rejects(() => installVerifiedUpdate({
    update: { version: "1.0.7", stagingRoot, appPath: stagedApp },
    execPath: join(installedApp, "Contents", "MacOS", "Quotix"),
    helperSource,
    originalPid: 123,
    confirm: async () => true,
    quarantineRealpath: async (path) => path,
    quarantineExecFile: async () => undefined,
    reveal: () => undefined,
    spawnHelper: async () => { throw new Error("spawn failed"); },
    quit: () => { quit = true; },
  }), /spawn failed/);
  assert.equal(quit, false);
});

test("new app waits for the current helper process to exit before cleanup", async () => {
  const statuses = ["running", "exited"];
  let now = 0;
  let waits = 0;
  const exited = await waitForInstallerExit({
    helperPid: 456,
    transactionPath: "/tmp/update/install-transaction.json",
    probeProcess: async (pid, transactionPath) => {
      assert.equal(pid, 456);
      assert.equal(transactionPath, "/tmp/update/install-transaction.json");
      return statuses.shift() ?? "exited";
    },
    wait: async () => {
      waits += 1;
      now += 100;
    },
    now: () => now,
  });
  assert.equal(exited, true);
  assert.equal(waits, 1);
});

test("new app waits for the exact legacy helper process to exit", async () => {
  const statuses = ["running", "exited"];
  let now = 0;
  const exited = await waitForInstallerExit({
    transactionPath: "/tmp/update/install-transaction.json",
    probeProcess: async (pid, transactionPath) => {
      assert.equal(pid, undefined);
      assert.equal(transactionPath, "/tmp/update/install-transaction.json");
      return statuses.shift() ?? "exited";
    },
    wait: async (milliseconds) => { now += milliseconds; },
    now: () => now,
  });
  assert.equal(exited, true);
  assert.equal(now, 100);
});

test("new app preserves the live backup when helper exit times out", async () => {
  let now = 0;
  const exited = await waitForInstallerExit({
    helperPid: 456,
    transactionPath: "/tmp/update/install-transaction.json",
    timeoutMs: 300,
    probeProcess: async () => "running",
    wait: async (milliseconds) => { now += milliseconds; },
    now: () => now,
  });
  assert.equal(exited, false);
});

test("new app treats a reused helper PID with another command as exited", async () => {
  const exited = await waitForInstallerExit({
    helperPid: 456,
    transactionPath: "/tmp/update/install-transaction.json",
    probeProcess: async () => "exited",
  });
  assert.equal(exited, true);
});

test("new app fails closed when installer process identity cannot be checked", async () => {
  let now = 0;
  const exited = await waitForInstallerExit({
    helperPid: 456,
    transactionPath: "/tmp/update/install-transaction.json",
    timeoutMs: 200,
    probeProcess: async () => "unknown",
    wait: async (milliseconds) => { now += milliseconds; },
    now: () => now,
  });
  assert.equal(exited, false);
});
