import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import { UpdateError, type UpdateArch } from "./model";

const execFileAsync = promisify(execFile);

const EXPECTED_HELPERS = [
  {
    path: "Contents/Frameworks/Quotix Helper.app",
    identifier: "com.huakwan.quotix.helper",
    executable: "Quotix Helper",
  },
  {
    path: "Contents/Frameworks/Quotix Helper (Renderer).app",
    identifier: "com.huakwan.quotix.helper.Renderer",
    executable: "Quotix Helper (Renderer)",
  },
  {
    path: "Contents/Frameworks/Quotix Helper (GPU).app",
    identifier: "com.huakwan.quotix.helper.GPU",
    executable: "Quotix Helper (GPU)",
  },
  {
    path: "Contents/Frameworks/Quotix Helper (Plugin).app",
    identifier: "com.huakwan.quotix.helper.Plugin",
    executable: "Quotix Helper (Plugin)",
  },
] as const;

export interface ExpectedBundle {
  version: string;
  arch: UpdateArch;
}

interface BundleInfo {
  CFBundleIdentifier?: unknown;
  CFBundleName?: unknown;
  CFBundleShortVersionString?: unknown;
  CFBundleVersion?: unknown;
  CFBundleExecutable?: unknown;
}

function exactArchitecture(architectures: string[], expected: ExpectedBundle): boolean {
  const expectedArchitecture = expected.arch === "x64" ? "x86_64" : "arm64";
  return architectures.length === 1 && architectures[0] === expectedArchitecture;
}

export function validateBundleMetadata(
  info: BundleInfo,
  architectures: string[],
  nestedApps: string[],
  expected: ExpectedBundle,
): { executable: string } {
  const expectedNestedApps = EXPECTED_HELPERS.map((helper) => helper.path).sort();
  if (
    info.CFBundleIdentifier !== "com.huakwan.quotix"
    || info.CFBundleName !== "Quotix"
    || info.CFBundleShortVersionString !== expected.version
    || info.CFBundleExecutable !== "Quotix"
    || !exactArchitecture(architectures, expected)
    || nestedApps.length !== expectedNestedApps.length
    || [...nestedApps].sort().some((path, index) => path !== expectedNestedApps[index])
  ) {
    throw new UpdateError("bundle_invalid");
  }
  return { executable: info.CFBundleExecutable };
}

export function validateHelperBundleMetadata(
  path: string,
  info: BundleInfo,
  architectures: string[],
  expected: ExpectedBundle,
): { executable: string } {
  const helper = EXPECTED_HELPERS.find((candidate) => candidate.path === path);
  if (
    !helper
    || info.CFBundleIdentifier !== helper.identifier
    || info.CFBundleVersion !== expected.version
    || info.CFBundleExecutable !== helper.executable
    || !exactArchitecture(architectures, expected)
  ) {
    throw new UpdateError("bundle_invalid");
  }
  return { executable: helper.executable };
}

async function nestedApps(root: string, current = root): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.name.endsWith(".app")) {
      found.push(path);
    }
    if (entry.isDirectory()) { found.push(...await nestedApps(root, path)); }
  }
  return found;
}

async function readBundleInfo(appPath: string): Promise<BundleInfo> {
  const { stdout } = await execFileAsync(
    "/usr/bin/plutil",
    ["-convert", "json", "-o", "-", join(appPath, "Contents", "Info.plist")],
    { maxBuffer: 1024 * 1024, encoding: "utf8" },
  );
  return JSON.parse(stdout) as BundleInfo;
}

async function executableArchitectures(path: string): Promise<string[]> {
  const { stdout } = await execFileAsync(
    "/usr/bin/lipo",
    ["-archs", path],
    { maxBuffer: 4096, encoding: "utf8" },
  );
  return stdout.trim().split(/\s+/).filter(Boolean);
}

export async function validateBundle(
  appPath: string,
  expected: ExpectedBundle,
): Promise<{ executablePath: string }> {
  try {
    const info = await readBundleInfo(appPath);
    if (typeof info.CFBundleExecutable !== "string") { throw new UpdateError("bundle_invalid"); }
    const executablePath = join(appPath, "Contents", "MacOS", info.CFBundleExecutable);
    const helperPaths = await nestedApps(appPath);
    const relativeHelperPaths = helperPaths.map((path) => relative(appPath, path));
    validateBundleMetadata(
      info,
      await executableArchitectures(executablePath),
      relativeHelperPaths,
      expected,
    );
    for (let index = 0; index < helperPaths.length; index += 1) {
      const helperInfo = await readBundleInfo(helperPaths[index]);
      if (typeof helperInfo.CFBundleExecutable !== "string") {
        throw new UpdateError("bundle_invalid");
      }
      validateHelperBundleMetadata(
        relativeHelperPaths[index],
        helperInfo,
        await executableArchitectures(join(
          helperPaths[index],
          "Contents",
          "MacOS",
          helperInfo.CFBundleExecutable,
        )),
        expected,
      );
    }
    return { executablePath };
  } catch (error) {
    if (error instanceof UpdateError) { throw error; }
    throw new UpdateError("bundle_invalid");
  }
}
