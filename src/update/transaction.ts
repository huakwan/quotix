import { UpdateError } from "./model";
import { randomBytes } from "node:crypto";
import { open, rename, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { isContainedPath } from "./installPaths";
import { parseAppVersion } from "./version";

export type InstallPhase =
  | "prepared"
  | "backup-created"
  | "new-installed"
  | "launching"
  | "complete"
  | "rolled-back";

export interface InstallTransaction {
  schemaVersion: 1;
  version: string;
  stagingRoot: string;
  installedApp: string;
  stagedApp: string;
  backupApp: string;
  markerPath: string;
  resultPath: string;
  token: string;
  originalPid: number;
  phase: InstallPhase;
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.tmp-${process.pid}-${randomBytes(8).toString("hex")}`;
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(JSON.stringify(value));
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
    const directory = await open(dirname(path), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

export function parseInstallTransaction(value: unknown): InstallTransaction {
  if (typeof value !== "object" || value === null) {
    throw new UpdateError("transaction_invalid");
  }
  const tx = value as Partial<InstallTransaction>;
  const expectedKeys = [
    "schemaVersion", "version", "stagingRoot", "installedApp", "stagedApp",
    "backupApp", "markerPath", "resultPath", "token", "originalPid", "phase",
  ];
  if (
    Object.keys(tx).sort().join(",") !== expectedKeys.sort().join(",")
    || tx.schemaVersion !== 1
    || typeof tx.version !== "string"
    || !parseAppVersion(tx.version)
    || typeof tx.stagingRoot !== "string"
    || typeof tx.installedApp !== "string"
    || typeof tx.stagedApp !== "string"
    || typeof tx.backupApp !== "string"
    || typeof tx.markerPath !== "string"
    || typeof tx.resultPath !== "string"
    || typeof tx.token !== "string"
    || !/^[a-f0-9]{64}$/.test(tx.token)
    || !Number.isSafeInteger(tx.originalPid)
    || (tx.originalPid ?? 0) <= 0
    || !["prepared", "backup-created", "new-installed", "launching", "complete", "rolled-back"]
      .includes(tx.phase ?? "")
  ) {
    throw new UpdateError("transaction_invalid");
  }
  const paths = [
    tx.stagingRoot,
    tx.installedApp,
    tx.stagedApp,
    tx.backupApp,
    tx.markerPath,
    tx.resultPath,
  ] as string[];
  const expectedBackup = `${tx.installedApp}.update-backup-${tx.token.slice(0, 12)}`;
  if (
    paths.some((path) => !isAbsolute(path) || resolve(path) !== path)
    || basename(tx.installedApp) !== "Quotix.app"
    || !isContainedPath(tx.stagingRoot, tx.stagedApp)
    || tx.stagedApp === tx.stagingRoot
    || basename(tx.stagedApp) !== "Quotix.app"
    || tx.backupApp !== expectedBackup
    || dirname(tx.markerPath) !== tx.stagingRoot
    || basename(tx.markerPath) !== "launch-success"
    || dirname(tx.resultPath) !== tx.stagingRoot
    || basename(tx.resultPath) !== "install-result.json"
  ) {
    throw new UpdateError("transaction_invalid");
  }
  return tx as InstallTransaction;
}
