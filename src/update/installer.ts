import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFile, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { isContainedPath, resolveInstalledBundle } from "./installPaths";
import { UpdateError, type VerifiedUpdate } from "./model";
import {
  parseInstallTransaction,
  writeJsonAtomic,
  type InstallTransaction,
} from "./transaction";

const execFileAsync = promisify(execFile);

export interface QuarantineOptions {
  stagingRoot: string;
  appPath: string;
  confirm(): Promise<boolean>;
  realpath?(path: string): Promise<string>;
  execFile?(executable: string, args: string[]): Promise<unknown>;
}

export async function removeVerifiedQuarantine(options: QuarantineOptions): Promise<boolean> {
  if (!await options.confirm()) { return false; }
  const resolveRealpath = options.realpath ?? realpath;
  const run = options.execFile ?? ((executable, args) =>
    execFileAsync(executable, args, { maxBuffer: 1024 * 1024 }));
  let root: string;
  let app: string;
  try {
    [root, app] = await Promise.all([
      resolveRealpath(options.stagingRoot),
      resolveRealpath(options.appPath),
    ]);
  } catch {
    throw new UpdateError("install_path_changed");
  }
  if (
    !isContainedPath(root, app)
    || app === root
    || !app.endsWith("/Quotix.app")
  ) {
    throw new UpdateError("install_path_changed");
  }
  try {
    await run("/usr/bin/xattr", ["-dr", "com.apple.quarantine", app]);
    return true;
  } catch {
    throw new UpdateError("quarantine_removal_failed");
  }
}

export interface InstallUpdateOptions {
  update: VerifiedUpdate;
  execPath: string;
  helperSource: string;
  originalPid: number;
  confirm(mode: "automatic" | "finder"): Promise<boolean>;
  quarantineRealpath?(path: string): Promise<string>;
  quarantineExecFile?(executable: string, args: string[]): Promise<unknown>;
  reveal(path: string): void;
  spawnHelper(
    executable: string,
    args: string[],
    options: { env: NodeJS.ProcessEnv; detached: true; stdio: "ignore" },
  ): Promise<{ unref(): void }>;
  quit(): void;
}

export async function installVerifiedUpdate(
  options: InstallUpdateOptions,
): Promise<"installing" | "fallback"> {
  const location = await resolveInstalledBundle(options.execPath);
  const mode = location.eligible ? "automatic" : "finder";
  let consented: boolean;
  try {
    consented = await removeVerifiedQuarantine({
      stagingRoot: options.update.stagingRoot,
      appPath: options.update.appPath,
      confirm: () => options.confirm(mode),
      realpath: options.quarantineRealpath,
      execFile: options.quarantineExecFile,
    });
  } catch (error) {
    if (error instanceof UpdateError && error.code === "quarantine_removal_failed") {
      options.reveal(options.update.appPath);
      return "fallback";
    }
    throw error;
  }
  if (!consented) { throw new UpdateError("install_cancelled"); }
  if (!location.eligible) {
    options.reveal(options.update.appPath);
    return "fallback";
  }

  const token = randomBytes(32).toString("hex");
  const transactionPath = join(options.update.stagingRoot, "install-transaction.json");
  const helperPath = join(options.update.stagingRoot, "installerHelper.js");
  const transaction: InstallTransaction = {
    schemaVersion: 1,
    version: options.update.version,
    stagingRoot: options.update.stagingRoot,
    installedApp: location.bundlePath,
    stagedApp: options.update.appPath,
    backupApp: `${location.bundlePath}.update-backup-${token.slice(0, 12)}`,
    markerPath: join(options.update.stagingRoot, "launch-success"),
    resultPath: join(options.update.stagingRoot, "install-result.json"),
    token,
    originalPid: options.originalPid,
    phase: "prepared",
  };
  await copyFile(options.helperSource, helperPath);
  await writeJsonAtomic(transactionPath, transaction);
  const helper = await options.spawnHelper(options.execPath, [helperPath, transactionPath], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    detached: true,
    stdio: "ignore",
  });
  helper.unref();
  options.quit();
  return "installing";
}

function argumentValue(argv: string[], name: string): string | undefined {
  return argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
}

export async function acknowledgeUpdatedLaunch(
  argv: string[],
  userDataDir: string,
  currentVersion: string,
): Promise<{
  markerPath: string;
  transactionPath: string;
  helperPid?: number;
} | null> {
  const token = argumentValue(argv, "--quotix-update-token");
  const marker = argumentValue(argv, "--quotix-update-marker");
  if (!token && !marker) { return null; }
  const updatesRoot = join(userDataDir, "updates");
  const stagingRoot = marker ? dirname(marker) : "";
  const transactionPath = join(stagingRoot, "install-transaction.json");
  if (
    !token
    || !marker
    || !/^[a-f0-9]{64}$/.test(token)
    || !isContainedPath(updatesRoot, marker)
    || stagingRoot === updatesRoot
  ) {
    throw new UpdateError("launch_acknowledgement_invalid");
  }
  let transaction: InstallTransaction;
  try {
    const [canonicalUpdates, canonicalStaging] = await Promise.all([
      realpath(updatesRoot),
      realpath(stagingRoot),
    ]);
    if (!isContainedPath(canonicalUpdates, canonicalStaging)) {
      throw new Error("outside updates root");
    }
    transaction = parseInstallTransaction(JSON.parse(await readFile(transactionPath, "utf8")));
  } catch {
    throw new UpdateError("launch_acknowledgement_invalid");
  }
  if (
    transaction.stagingRoot !== stagingRoot
    || transaction.markerPath !== marker
    || transaction.token !== token
    || transaction.version !== currentVersion
    || !["new-installed", "launching"].includes(transaction.phase)
  ) {
    throw new UpdateError("launch_acknowledgement_invalid");
  }
  await writeFile(marker, token, { mode: 0o600, flag: "wx" });
  return {
    markerPath: marker,
    transactionPath,
    ...(transaction.helperPid ? { helperPid: transaction.helperPid } : {}),
  };
}

export interface InstallerExitWaitOptions {
  helperPid?: number;
  transactionPath: string;
  timeoutMs?: number;
  pollMs?: number;
  probeProcess?(
    helperPid: number | undefined,
    transactionPath: string,
  ): Promise<"running" | "exited" | "unknown">;
  wait?(milliseconds: number): Promise<void>;
  now?(): number;
}

function pidExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function probeInstallerProcess(
  helperPid: number | undefined,
  transactionPath: string,
): Promise<"running" | "exited" | "unknown"> {
  const args = helperPid
    ? ["-ww", "-p", String(helperPid), "-o", "command="]
    : ["-ww", "-axo", "command="];
  try {
    const { stdout } = await execFileAsync("/bin/ps", args, {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
    return stdout.split("\n").some((command) => command.includes(transactionPath))
      ? "running"
      : "exited";
  } catch {
    if (helperPid && !pidExists(helperPid)) { return "exited"; }
    return "unknown";
  }
}

export async function waitForInstallerExit(
  options: InstallerExitWaitOptions,
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const pollMs = options.pollMs ?? 100;
  const probeProcess = options.probeProcess ?? probeInstallerProcess;
  const wait = options.wait
    ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const now = options.now ?? Date.now;
  const started = now();

  while (now() - started < timeoutMs) {
    if (await probeProcess(options.helperPid, options.transactionPath) === "exited") {
      return true;
    }
    await wait(pollMs);
  }
  return false;
}
