import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { removeTree } from "../out/src/update/removeTree.js";
import { packAsar } from "./helpers/asar.mjs";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

async function appBundle(root) {
  const bundle = join(root, "Quotix.app");
  await mkdir(join(bundle, "Contents", "Resources"), { recursive: true });
  await mkdir(join(bundle, "Contents", "MacOS"), { recursive: true });
  await writeFile(join(bundle, "Contents", "MacOS", "Quotix"), "binary");
  await writeFile(join(bundle, "Contents", "Info.plist"), "<plist/>");
  await writeFile(
    join(bundle, "Contents", "Resources", "app.asar"),
    packAsar({ "index.js": "console.log(1)\n" }),
  );
  return bundle;
}

test("removeTree deletes a nested tree and ignores a missing path", async () => {
  const root = await mkdtemp(join(tmpdir(), "quotix-removetree-"));
  const bundle = await appBundle(root);
  await removeTree(bundle);
  assert.equal(existsSync(bundle), false);
  await removeTree(bundle);
});

test("removeTree deletes an app bundle that Electron's asar fs cannot", async (t) => {
  let electronPath;
  try {
    electronPath = require("electron");
  } catch {
    t.skip("electron is not installed");
    return;
  }
  if (typeof electronPath !== "string" || !existsSync(electronPath)) {
    t.skip("electron binary is unavailable");
    return;
  }

  // A truncated or unsigned Electron download cannot launch at all. That is an
  // install problem the packaging job already catches, not a removeTree regression.
  try {
    await execFileAsync(electronPath, ["-e", "process.stdout.write('ok')"], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      encoding: "utf8",
    });
  } catch (error) {
    t.skip(`electron binary cannot run: ${error.stderr || error.message}`);
    return;
  }

  const root = await mkdtemp(join(tmpdir(), "quotix-removetree-asar-"));
  const bundle = await appBundle(root);
  const modulePath = resolve(dirname(new URL(import.meta.url).pathname), "../out/src/update/removeTree.js");
  const probePath = join(root, "probe.js");
  await writeFile(probePath, `
    const { rm } = require("node:fs/promises");
    const { existsSync } = require("node:fs");
    const { removeTree } = require(${JSON.stringify(modulePath)});
    const bundle = ${JSON.stringify(bundle)};
    const archive = ${JSON.stringify(join(bundle, "Contents", "Resources", "app.asar"))};
    (async () => {
      const result = {};
      try {
        await rm(bundle, { recursive: true, force: true });
        result.patchedRemove = "removed";
      } catch (error) {
        result.patchedRemove = error.code;
      }
      result.strandedArchive = existsSync(archive);
      await removeTree(bundle);
      result.bundleGone = !existsSync(bundle);
      console.log("RESULT" + JSON.stringify(result));
    })();
  `);

  const { stdout } = await execFileAsync(electronPath, [probePath], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  const line = stdout.split("\n").find((entry) => entry.startsWith("RESULT"));
  assert.ok(line, `probe produced no result: ${stdout}`);
  const result = JSON.parse(line.slice("RESULT".length));

  // Guards the regression itself: Electron's patched fs descends into app.asar,
  // so the plain recursive remove strands the archive it should have unlinked.
  assert.equal(result.patchedRemove, "ENOTEMPTY");
  assert.equal(result.strandedArchive, true);
  assert.equal(result.bundleGone, true);
});
