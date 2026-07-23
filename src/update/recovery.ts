import { lstat, readFile, readdir, realpath, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { isContainedPath } from "./installPaths";
import {
  parseInstallTransaction,
  writeJsonAtomic,
  type InstallTransaction,
} from "./transaction";

export interface RecoveryNotice {
  status: "rolled-back" | "rollback-failed" | "manual-recovery";
  version: string;
}

export interface RecoveryOptions {
  updatesRoot: string;
  currentBundlePath?: string;
  currentVersion: string;
  skipTransactionPath?: string;
  removeBackup?(path: string): Promise<void>;
}

export interface OrphanedBackupCleanupOptions {
  updatesRoot: string;
  currentBundlePath?: string;
  removeBackup?(path: string): Promise<void>;
}

async function isSameDirectory(a: string, b: string): Promise<boolean> {
  if (a === b) { return true; }
  try {
    return await realpath(a) === await realpath(b);
  } catch {
    return a.toLowerCase() === b.toLowerCase();
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function pathStatus(path: string): Promise<"present" | "missing" | "indeterminate"> {
  try {
    await lstat(path);
    return "present";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "indeterminate";
  }
}

async function readTransaction(path: string): Promise<InstallTransaction | null> {
  try {
    return parseInstallTransaction(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return null;
  }
}

async function readNotice(transaction: InstallTransaction): Promise<RecoveryNotice | null> {
  try {
    const value = JSON.parse(await readFile(transaction.resultPath, "utf8")) as {
      status?: unknown;
      version?: unknown;
    };
    if (
      (value.status === "rolled-back" || value.status === "rollback-failed")
      && value.version === transaction.version
    ) {
      return { status: value.status, version: transaction.version };
    }
  } catch {
    /* a result is optional when recovery is reconstructing an interrupted transaction */
  }
  return null;
}

async function recordRollback(
  transactionPath: string,
  transaction: InstallTransaction,
): Promise<RecoveryNotice> {
  try {
    if (!await exists(transaction.backupApp)) {
      throw new Error("backup missing");
    }
    await rename(transaction.backupApp, transaction.installedApp);
    transaction.phase = "rolled-back";
    await writeJsonAtomic(transactionPath, transaction);
    await writeJsonAtomic(transaction.resultPath, {
      status: "rolled-back",
      version: transaction.version,
    });
    return { status: "rolled-back", version: transaction.version };
  } catch {
    await writeJsonAtomic(transaction.resultPath, {
      status: "rollback-failed",
      version: transaction.version,
    }).catch(() => undefined);
    return { status: "rollback-failed", version: transaction.version };
  }
}

async function recoverOne(
  stagingRoot: string,
  transactionPath: string,
  options: RecoveryOptions,
): Promise<{ notice?: RecoveryNotice; cleanup: boolean }> {
  const transactionFileStatus = await pathStatus(transactionPath);
  if (transactionFileStatus === "missing") { return { cleanup: true }; }
  if (transactionFileStatus === "indeterminate") {
    return {
      notice: { status: "manual-recovery", version: "unknown" },
      cleanup: false,
    };
  }
  const transaction = await readTransaction(transactionPath);
  if (!transaction || !await isSameDirectory(transaction.stagingRoot, stagingRoot)) {
    return {
      notice: { status: "manual-recovery", version: "unknown" },
      cleanup: false,
    };
  }

  let notice = await readNotice(transaction);
  const backupExists = await exists(transaction.backupApp);
  const installedExists = await exists(transaction.installedApp);
  const currentIsInstalled = options.currentBundlePath === transaction.installedApp;
  const currentIsTarget = currentIsInstalled && options.currentVersion === transaction.version;
  let backupCleaned = !backupExists;
  const removeBackup = async (): Promise<void> => {
    try {
      await (options.removeBackup
        ? options.removeBackup(transaction.backupApp)
        : rm(transaction.backupApp, { recursive: true, force: true }));
      backupCleaned = !await exists(transaction.backupApp);
    } catch {
      backupCleaned = false;
    }
  };
  if (installedExists && currentIsTarget) {
    notice = null;
    transaction.phase = "complete";
    await writeJsonAtomic(transactionPath, transaction);
    await removeBackup();
  } else if (!installedExists && backupExists) {
    notice = await recordRollback(transactionPath, transaction);
    backupCleaned = !await exists(transaction.backupApp);
  } else if (!installedExists) {
    notice = { status: "rollback-failed", version: transaction.version };
    await writeJsonAtomic(transaction.resultPath, notice).catch(() => undefined);
  } else if (
    currentIsInstalled
    && (transaction.phase === "complete" || transaction.phase === "rolled-back")
  ) {
    await removeBackup();
  } else if (!(transaction.phase === "prepared" && !backupExists)) {
    notice = { status: "manual-recovery", version: transaction.version };
  }
  return {
    ...(notice ? { notice } : {}),
    cleanup: backupCleaned
      && notice?.status !== "rollback-failed"
      && notice?.status !== "manual-recovery",
  };
}

export async function recoverInterruptedUpdates(
  options: RecoveryOptions,
): Promise<RecoveryNotice[]> {
  let entries;
  try {
    entries = await readdir(options.updatesRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const notices: RecoveryNotice[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("update-")) { continue; }
    const stagingRoot = resolve(options.updatesRoot, entry.name);
    if (!isContainedPath(resolve(options.updatesRoot), stagingRoot)) { continue; }
    const transactionPath = join(stagingRoot, "install-transaction.json");
    if (transactionPath === options.skipTransactionPath) { continue; }
    try {
      const outcome = await recoverOne(stagingRoot, transactionPath, options);
      if (outcome.notice) { notices.push(outcome.notice); }
      if (outcome.cleanup) {
        await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
      }
    } catch {
      notices.push({ status: "manual-recovery", version: "unknown" });
    }
  }
  return notices;
}

async function protectedBackupPaths(updatesRoot: string): Promise<Set<string> | null> {
  let entries;
  try {
    entries = await readdir(updatesRoot, { withFileTypes: true });
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? new Set() : null;
  }
  const protectedPaths = new Set<string>();
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("update-")) { continue; }
    const stagingRoot = resolve(updatesRoot, entry.name);
    if (!isContainedPath(resolve(updatesRoot), stagingRoot)) { return null; }
    const transactionPath = join(stagingRoot, "install-transaction.json");
    const transactionFileStatus = await pathStatus(transactionPath);
    if (transactionFileStatus === "missing") { continue; }
    if (transactionFileStatus === "indeterminate") { return null; }
    const transaction = await readTransaction(transactionPath);
    if (!transaction || !await isSameDirectory(transaction.stagingRoot, stagingRoot)) {
      return null;
    }
    protectedPaths.add(transaction.backupApp.toLowerCase());
  }
  return protectedPaths;
}

export async function cleanupOrphanedUpdateBackups(
  options: OrphanedBackupCleanupOptions,
): Promise<void> {
  const installedApp = options.currentBundlePath;
  if (!installedApp || !await exists(installedApp)) { return; }
  const protectedPaths = await protectedBackupPaths(options.updatesRoot);
  if (!protectedPaths) { return; }
  const applicationsDir = dirname(installedApp);
  const prefix = `${basename(installedApp)}.update-backup-`;
  let entries;
  try {
    entries = await readdir(applicationsDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const suffix = entry.name.slice(prefix.length);
    if (
      !entry.name.startsWith(prefix)
      || !/^[a-f0-9]{12}$/.test(suffix)
      || !entry.isDirectory()
      || entry.isSymbolicLink()
    ) {
      continue;
    }
    const candidate = join(applicationsDir, entry.name);
    if (protectedPaths.has(candidate.toLowerCase())) { continue; }
    await (options.removeBackup
      ? options.removeBackup(candidate)
      : rm(candidate, { recursive: true, force: true })).catch(() => undefined);
  }
}
