import { spawn, type ChildProcess } from "node:child_process";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { UpdateError } from "./model";
import { parseInstallTransaction, type InstallTransaction } from "./transaction";

interface LaunchedProcess {
  pid?: number;
  kill(): unknown;
}

export interface InstallerHelperDeps {
  waitForExit(pid: number): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  rm(path: string): Promise<void>;
  writeTransaction(transaction: InstallTransaction): Promise<void>;
  writeResult(result: Record<string, unknown>): Promise<void>;
  launch(path: string, args: string[]): Promise<LaunchedProcess>;
  readMarker(): Promise<string | null>;
  wait(milliseconds: number): Promise<void>;
  now(): number;
}

function executablePath(appPath: string): string {
  return join(appPath, "Contents", "MacOS", "Quotix");
}

async function waitForMarker(
  transaction: InstallTransaction,
  child: LaunchedProcess,
  deps: InstallerHelperDeps,
): Promise<void> {
  const started = deps.now();
  while (deps.now() - started < 30_000) {
    if (await deps.readMarker() === transaction.token) { return; }
    await deps.wait(250);
  }
  child.kill();
  throw new UpdateError("updated_launch_timeout");
}

export async function runInstallTransaction(
  transaction: InstallTransaction,
  deps: InstallerHelperDeps,
): Promise<void> {
  const tx = parseInstallTransaction(transaction);
  let backupCreated = false;
  let newInstalled = false;
  let child: LaunchedProcess | undefined;
  try {
    await deps.waitForExit(tx.originalPid);
    await deps.rename(tx.installedApp, tx.backupApp);
    backupCreated = true;
    tx.phase = "backup-created";
    await deps.writeTransaction(tx);
    await deps.rename(tx.stagedApp, tx.installedApp);
    newInstalled = true;
    tx.phase = "new-installed";
    await deps.writeTransaction(tx);
    child = await deps.launch(executablePath(tx.installedApp), [
      `--quotix-update-token=${tx.token}`,
      `--quotix-update-marker=${tx.markerPath}`,
    ]);
    tx.phase = "launching";
    await deps.writeTransaction(tx);
    await waitForMarker(tx, child, deps);
    await deps.rm(tx.backupApp);
    tx.phase = "complete";
    await deps.writeTransaction(tx);
    await deps.writeResult({ status: "success", version: tx.version });
  } catch (error) {
    child?.kill();
    try {
      if (newInstalled) { await deps.rm(tx.installedApp); }
      if (backupCreated) {
        await deps.rename(tx.backupApp, tx.installedApp);
        await deps.launch(executablePath(tx.installedApp), ["--quotix-update-rollback"]);
      }
      tx.phase = "rolled-back";
      await deps.writeTransaction(tx);
      await deps.writeResult({ status: "rolled-back", version: tx.version });
    } catch {
      await deps.writeResult({ status: "rollback-failed", version: tx.version });
    }
    if (error instanceof Error) { throw error; }
    throw new UpdateError("install_failed");
  }
}

async function waitForExit(pid: number): Promise<void> {
  for (;;) {
    try {
      process.kill(pid, 0);
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") { return; }
      throw error;
    }
  }
}

async function launch(path: string, args: string[]): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn(path, args, { detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.removeListener("error", reject);
      child.unref();
      resolve(child);
    });
  });
}

async function main(): Promise<void> {
  const transactionPath = process.argv[2];
  if (!transactionPath) { throw new UpdateError("transaction_invalid"); }
  const tx = parseInstallTransaction(JSON.parse(await readFile(transactionPath, "utf8")));
  const deps: InstallerHelperDeps = {
    waitForExit,
    rename,
    rm: (path) => rm(path, { recursive: true, force: true }),
    writeTransaction: (value) => writeFile(transactionPath, JSON.stringify(value), { mode: 0o600 }),
    writeResult: (value) => writeFile(tx.resultPath, JSON.stringify(value), { mode: 0o600 }),
    launch,
    readMarker: async () => {
      try { return (await readFile(tx.markerPath, "utf8")).trim(); } catch { return null; }
    },
    wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    now: Date.now,
  };
  await runInstallTransaction(tx, deps);
}

if (require.main === module) {
  void main().catch(() => { process.exitCode = 1; });
}
