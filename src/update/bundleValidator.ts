import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { UpdateError, type UpdateArch } from "./model";

const execFileAsync = promisify(execFile);

export interface ExpectedBundle {
  version: string;
  arch: UpdateArch;
}

interface BundleInfo {
  CFBundleIdentifier?: unknown;
  CFBundleName?: unknown;
  CFBundleShortVersionString?: unknown;
  CFBundleExecutable?: unknown;
}

export function validateBundleMetadata(
  info: BundleInfo,
  architectures: string[],
  nestedApps: string[],
  expected: ExpectedBundle,
): { executable: string } {
  const expectedArchitecture = expected.arch === "x64" ? "x86_64" : "arm64";
  if (
    info.CFBundleIdentifier !== "com.huakwan.quotix"
    || info.CFBundleName !== "Quotix"
    || info.CFBundleShortVersionString !== expected.version
    || info.CFBundleExecutable !== "Quotix"
    || architectures.length !== 1
    || architectures[0] !== expectedArchitecture
    || nestedApps.length !== 0
  ) {
    throw new UpdateError("bundle_invalid");
  }
  return { executable: info.CFBundleExecutable };
}

async function nestedApps(root: string, current = root): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (!entry.isDirectory()) { continue; }
    if (entry.name.endsWith(".app")) {
      found.push(path);
    } else {
      found.push(...await nestedApps(root, path));
    }
  }
  return found;
}

export async function validateBundle(
  appPath: string,
  expected: ExpectedBundle,
): Promise<{ executablePath: string }> {
  try {
    const plistPath = join(appPath, "Contents", "Info.plist");
    const { stdout: rawInfo } = await execFileAsync(
      "/usr/bin/plutil",
      ["-convert", "json", "-o", "-", plistPath],
      { maxBuffer: 1024 * 1024, encoding: "utf8" },
    );
    const info = JSON.parse(rawInfo) as BundleInfo;
    if (typeof info.CFBundleExecutable !== "string") { throw new UpdateError("bundle_invalid"); }
    const executablePath = join(appPath, "Contents", "MacOS", info.CFBundleExecutable);
    const { stdout: rawArchitectures } = await execFileAsync(
      "/usr/bin/lipo",
      ["-archs", executablePath],
      { maxBuffer: 4096, encoding: "utf8" },
    );
    validateBundleMetadata(
      info,
      rawArchitectures.trim().split(/\s+/).filter(Boolean),
      await nestedApps(appPath),
      expected,
    );
    return { executablePath };
  } catch (error) {
    if (error instanceof UpdateError) { throw error; }
    throw new UpdateError("bundle_invalid");
  }
}
