import assert from "node:assert/strict";
import { createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("main process checks for updates every three hours", () => {
  const main = readFileSync(join(root, "src", "main.ts"), "utf8");

  assert.match(main, /const UPDATE_CHECK_INTERVAL_MS = 3 \* 60 \* 60 \* 1000;/);
  assert.match(
    main,
    /setInterval\(\(\) => checkForUpdates\(false\), UPDATE_CHECK_INTERVAL_MS\)/,
  );
});

test("manual quota refresh also checks for app updates", () => {
  const main = readFileSync(join(root, "src", "main.ts"), "utf8");

  assert.match(
    main,
    /ipcMain\.handle\("quota:refresh", async \(\) => \{\s*const refresh = poll\(true\);\s*checkForUpdates\(true\);\s*await refresh;\s*\}\)/,
  );
});

test("build emits a separate Node-only installer helper", () => {
  const build = readFileSync(join(root, "esbuild.js"), "utf8");
  assert.match(build, /entryPoints: \["src\/update\/installerHelper\.ts"\]/);
  assert.match(build, /outfile: "dist\/installerHelper\.js"/);
  assert.match(build, /platform: "node"/);
  assert.doesNotMatch(
    build.match(/entryPoints: \["src\/update\/installerHelper\.ts"\][\s\S]*?\}\),/)?.[0] ?? "",
    /platform:\s*"browser"/,
  );
});

test("production private update keys are absent from package inputs", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const files = JSON.stringify(pkg.build.files);
  assert.match(files, /dist/);
  assert.doesNotMatch(files, /private.*(?:pem|key)/i);
  const publicKey = createPublicKey(
    readFileSync(join(root, "src", "update", "key", "quotix-update-public.pem"), "utf8"),
  );
  assert.equal(publicKey.asymmetricKeyType, "ed25519");
});
