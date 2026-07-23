import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";
import { isContainedPath } from "./installPaths";
import { UpdateError } from "./model";

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
