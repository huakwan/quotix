import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

let probe;

// Resolves the Electron binary and proves it can actually launch. A truncated or
// unsigned download aborts in dyld before any test code runs, which is an install
// problem the packaging job catches, not a regression in the module under test.
async function probeElectron() {
  let electronPath;
  try {
    electronPath = require("electron");
  } catch {
    return { reason: "electron is not installed" };
  }
  if (typeof electronPath !== "string" || !existsSync(electronPath)) {
    return { reason: "electron binary is unavailable" };
  }
  try {
    await execFileAsync(electronPath, ["-e", "process.stdout.write('ok')"], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      encoding: "utf8",
    });
  } catch (error) {
    return { reason: `electron binary cannot run: ${error.stderr || error.message}` };
  }
  return { electronPath };
}

// Returns the binary path, or skips the test and returns null when Electron is
// unusable. Probed once per process so the launch check costs one spawn.
export async function runnableElectron(t) {
  probe ??= probeElectron();
  const { electronPath, reason } = await probe;
  if (!electronPath) {
    t.skip(reason);
    return null;
  }
  return electronPath;
}
