import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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
  assert.equal(
    readFileSync(join(root, "src", "update", "update-public-key.pem"), "utf8").trim(),
    "UNCONFIGURED",
    "release readiness test must be changed when the owner supplies the public key",
  );
});
