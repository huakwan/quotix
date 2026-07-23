import { UpdateError } from "./model";

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
  installedApp: string;
  stagedApp: string;
  backupApp: string;
  markerPath: string;
  resultPath: string;
  token: string;
  originalPid: number;
  phase: InstallPhase;
}

export function parseInstallTransaction(value: unknown): InstallTransaction {
  if (typeof value !== "object" || value === null) {
    throw new UpdateError("transaction_invalid");
  }
  const tx = value as Partial<InstallTransaction>;
  if (
    tx.schemaVersion !== 1
    || typeof tx.version !== "string"
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
  return tx as InstallTransaction;
}
