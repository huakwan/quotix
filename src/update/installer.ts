import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { isContainedPath, resolveInstalledBundle } from "./installPaths";
import { UpdateError, type VerifiedUpdate } from "./model";
import type { InstallTransaction } from "./transaction";

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
  reveal(path: string): void;
  spawnHelper(
    executable: string,
    args: string[],
    options: { env: NodeJS.ProcessEnv; detached: true; stdio: "ignore" },
  ): { unref(): void };
  quit(): void;
}

export async function installVerifiedUpdate(
  options: InstallUpdateOptions,
): Promise<"installing" | "fallback"> {
  const location = await resolveInstalledBundle(options.execPath);
  const mode = location.eligible ? "automatic" : "finder";
  const consented = await removeVerifiedQuarantine({
    stagingRoot: options.update.stagingRoot,
    appPath: options.update.appPath,
    confirm: () => options.confirm(mode),
  });
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
  await writeFile(transactionPath, JSON.stringify(transaction), { mode: 0o600 });
  const helper = options.spawnHelper(options.execPath, [helperPath, transactionPath], {
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
): Promise<void> {
  const token = argumentValue(argv, "--quotix-update-token");
  const marker = argumentValue(argv, "--quotix-update-marker");
  if (!token && !marker) { return; }
  const updatesRoot = join(userDataDir, "updates");
  if (
    !token
    || !marker
    || !/^[a-f0-9]{64}$/.test(token)
    || !isContainedPath(updatesRoot, marker)
    || dirname(marker) === updatesRoot
  ) {
    throw new UpdateError("launch_acknowledgement_invalid");
  }
  await writeFile(marker, token, { mode: 0o600, flag: "wx" });
}
