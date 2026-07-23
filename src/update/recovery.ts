import { readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
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
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
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
  const transactionFileExists = await exists(transactionPath);
  const transaction = transactionFileExists ? await readTransaction(transactionPath) : null;
  if (!transactionFileExists) { return { cleanup: true }; }
  if (!transaction || transaction.stagingRoot !== stagingRoot) {
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
  if (installedExists && currentIsTarget) {
    notice = null;
    transaction.phase = "complete";
    await writeJsonAtomic(transactionPath, transaction);
    await rm(transaction.backupApp, { recursive: true, force: true }).catch(() => undefined);
  } else if (!installedExists && backupExists) {
    notice = await recordRollback(transactionPath, transaction);
  } else if (!installedExists) {
    notice = { status: "rollback-failed", version: transaction.version };
    await writeJsonAtomic(transaction.resultPath, notice).catch(() => undefined);
  } else if (
    currentIsInstalled
    && (transaction.phase === "complete" || transaction.phase === "rolled-back")
  ) {
    await rm(transaction.backupApp, { recursive: true, force: true }).catch(() => undefined);
  } else if (!(transaction.phase === "prepared" && !backupExists)) {
    notice = { status: "manual-recovery", version: transaction.version };
  }
  return {
    ...(notice ? { notice } : {}),
    cleanup: notice?.status !== "rollback-failed" && notice?.status !== "manual-recovery",
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
