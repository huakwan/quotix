import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { recoverInterruptedUpdates } from "../out/src/update/recovery.js";

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function fixture(phase) {
  const root = await mkdtemp(join(tmpdir(), "quotix-recovery-"));
  const updatesRoot = join(root, "updates");
  const stagingRoot = join(updatesRoot, "update-test");
  const installedApp = join(root, "Applications", "Quotix.app");
  const token = "b".repeat(64);
  const transaction = {
    schemaVersion: 1,
    version: "1.0.7",
    stagingRoot,
    installedApp,
    stagedApp: join(stagingRoot, "extracted", "Quotix.app"),
    backupApp: `${installedApp}.update-backup-${token.slice(0, 12)}`,
    markerPath: join(stagingRoot, "launch-success"),
    resultPath: join(stagingRoot, "install-result.json"),
    token,
    originalPid: 123,
    phase,
  };
  await mkdir(stagingRoot, { recursive: true });
  await writeFile(join(stagingRoot, "install-transaction.json"), JSON.stringify(transaction));
  return { root, updatesRoot, stagingRoot, installedApp, transaction };
}

test("startup recovery restores a backup interrupted after the first rename", async () => {
  const value = await fixture("backup-created");
  await mkdir(value.transaction.backupApp, { recursive: true });
  await writeFile(join(value.transaction.backupApp, "old"), "old app");

  const notices = await recoverInterruptedUpdates({
    updatesRoot: value.updatesRoot,
    currentVersion: "1.0.6",
  });

  assert.deepEqual(notices, [{ status: "rolled-back", version: "1.0.7" }]);
  assert.equal(await readFile(join(value.installedApp, "old"), "utf8"), "old app");
  assert.equal(await pathExists(value.stagingRoot), false);
});

test("startup recovery completes a launched current version and removes its backup", async () => {
  const value = await fixture("launching");
  await mkdir(value.installedApp, { recursive: true });
  await mkdir(value.transaction.backupApp, { recursive: true });

  const notices = await recoverInterruptedUpdates({
    updatesRoot: value.updatesRoot,
    currentBundlePath: value.installedApp,
    currentVersion: "1.0.7",
  });

  assert.deepEqual(notices, []);
  assert.equal(await pathExists(value.installedApp), true);
  assert.equal(await pathExists(value.transaction.backupApp), false);
  assert.equal(await pathExists(value.stagingRoot), false);
});

test("startup recovery leaves the helper's acknowledged transaction untouched", async () => {
  const value = await fixture("launching");
  await mkdir(value.installedApp, { recursive: true });
  await recoverInterruptedUpdates({
    updatesRoot: value.updatesRoot,
    currentBundlePath: value.installedApp,
    currentVersion: "1.0.7",
    skipTransactionPath: join(value.stagingRoot, "install-transaction.json"),
  });
  assert.equal(await pathExists(value.stagingRoot), true);
});

test("startup recovery preserves the transaction when backup cleanup fails", async () => {
  const value = await fixture("complete");
  await mkdir(value.installedApp, { recursive: true });
  await mkdir(value.transaction.backupApp, { recursive: true });

  const notices = await recoverInterruptedUpdates({
    updatesRoot: value.updatesRoot,
    currentBundlePath: value.installedApp,
    currentVersion: "1.0.7",
    removeBackup: async () => { throw new Error("backup cleanup failed"); },
  });

  assert.deepEqual(notices, []);
  assert.equal(await pathExists(value.transaction.backupApp), true);
  assert.equal(await pathExists(value.stagingRoot), true);

  const retryNotices = await recoverInterruptedUpdates({
    updatesRoot: value.updatesRoot,
    currentBundlePath: value.installedApp,
    currentVersion: "1.0.7",
  });

  assert.deepEqual(retryNotices, []);
  assert.equal(await pathExists(value.transaction.backupApp), false);
  assert.equal(await pathExists(value.stagingRoot), false);
});

test("startup recovery never replaces a valid manually installed newer app", async () => {
  const value = await fixture("backup-created");
  await mkdir(value.installedApp, { recursive: true });
  await writeFile(join(value.installedApp, "version"), "manually installed 1.0.8");
  await mkdir(value.transaction.backupApp, { recursive: true });
  await writeFile(join(value.transaction.backupApp, "version"), "stale 1.0.6");

  const notices = await recoverInterruptedUpdates({
    updatesRoot: value.updatesRoot,
    currentBundlePath: value.installedApp,
    currentVersion: "1.0.8",
  });

  assert.deepEqual(notices, [{ status: "manual-recovery", version: "1.0.7" }]);
  assert.equal(
    await readFile(join(value.installedApp, "version"), "utf8"),
    "manually installed 1.0.8",
  );
  assert.equal(await pathExists(value.transaction.backupApp), true);
  assert.equal(await pathExists(value.stagingRoot), true);
});

test("startup recovery restores the only usable backup even after a recorded completion", async () => {
  const value = await fixture("complete");
  await mkdir(value.transaction.backupApp, { recursive: true });
  await writeFile(join(value.transaction.backupApp, "version"), "last usable app");

  const notices = await recoverInterruptedUpdates({
    updatesRoot: value.updatesRoot,
    currentVersion: "1.0.7",
  });

  assert.deepEqual(notices, [{ status: "rolled-back", version: "1.0.7" }]);
  assert.equal(await readFile(join(value.installedApp, "version"), "utf8"), "last usable app");
});

test("startup recovery removes the backup when the transaction records a differently cased staging root", async () => {
  const root = await mkdtemp(join(tmpdir(), "quotix-recovery-"));
  const updatesRoot = join(root, "updates");
  const stagingRoot = join(updatesRoot, "update-test");
  // The transaction was written by an older build whose userData path used a
  // different case (e.g. "quotix" vs "Quotix"); the on-disk dir is the same.
  const recordedStagingRoot = join(root, "UPDATES", "update-test");
  const installedApp = join(root, "Applications", "Quotix.app");
  const token = "b".repeat(64);
  const transaction = {
    schemaVersion: 1,
    version: "1.0.7",
    stagingRoot: recordedStagingRoot,
    installedApp,
    stagedApp: join(recordedStagingRoot, "extracted", "Quotix.app"),
    backupApp: `${installedApp}.update-backup-${token.slice(0, 12)}`,
    markerPath: join(recordedStagingRoot, "launch-success"),
    resultPath: join(recordedStagingRoot, "install-result.json"),
    token,
    originalPid: 123,
    phase: "complete",
  };
  await mkdir(stagingRoot, { recursive: true });
  await writeFile(join(stagingRoot, "install-transaction.json"), JSON.stringify(transaction));
  await mkdir(installedApp, { recursive: true });
  await mkdir(transaction.backupApp, { recursive: true });

  const notices = await recoverInterruptedUpdates({
    updatesRoot,
    currentBundlePath: installedApp,
    currentVersion: "1.0.7",
  });

  assert.deepEqual(notices, []);
  assert.equal(await pathExists(transaction.backupApp), false);
  assert.equal(await pathExists(stagingRoot), false);
});

test("startup recovery preserves a corrupt transaction for manual inspection", async () => {
  const value = await fixture("prepared");
  await writeFile(join(value.stagingRoot, "install-transaction.json"), "{broken");
  const notices = await recoverInterruptedUpdates({
    updatesRoot: value.updatesRoot,
    currentVersion: "1.0.7",
  });
  assert.deepEqual(notices, [{ status: "manual-recovery", version: "unknown" }]);
  assert.equal(await pathExists(value.stagingRoot), true);
});
