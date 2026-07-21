import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("electron-builder keeps packaged output outside compiled app files", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

  assert.equal(pkg.build.directories.output, "release");
  assert.deepEqual(pkg.build.files, [
    {
      from: ".",
      to: ".",
      filter: ["package.json"],
    },
    {
      from: "dist",
      to: "dist",
      filter: ["**/*", "!**/*.map", "!mac-*/**"],
    },
    {
      from: "assets",
      to: "assets",
      filter: ["anthropic.svg", "openai.svg"],
    },
  ]);
  assert.deepEqual(pkg.build.electronLanguages, ["en", "th"]);
});

test("git ignores packaged output", () => {
  const gitignore = readFileSync(join(root, ".gitignore"), "utf8");

  assert.match(gitignore, /^release\/$/m);
});

test("macOS build targets Intel and Apple Silicon from one command", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

  assert.match(pkg.scripts["dist:mac"], /electron-builder --mac --universal --dir$/);
  assert.equal(pkg.build.mac.minimumSystemVersion, "12.0");
});

test("macOS local build uses Electron-compatible ad-hoc signing", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const entitlementPath = join(root, "build", "entitlements.mac.plist");
  const entitlements = readFileSync(entitlementPath, "utf8");

  assert.equal(pkg.build.mac.identity, "-");
  assert.equal(pkg.build.mac.entitlements, "build/entitlements.mac.plist");
  assert.equal(pkg.build.mac.entitlementsInherit, "build/entitlements.mac.plist");
  assert.match(entitlements, /<key>com\.apple\.security\.cs\.allow-jit<\/key>\s*<true\/>/);
  assert.match(
    entitlements,
    /<key>com\.apple\.security\.cs\.disable-library-validation<\/key>\s*<true\/>/,
  );
});
