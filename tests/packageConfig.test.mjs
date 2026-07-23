import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
      filter: ["anthropic.svg", "openai.svg", "about-poster.png", "promptpay.png"],
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

test("Makefile exposes separate Intel, arm64, and Universal macOS builds", () => {
  const x64 = execFileSync("make", ["-n", "dist-mac-x64"], {
    cwd: root,
    encoding: "utf8",
  });
  const arm64 = execFileSync("make", ["-n", "dist-mac-arm64"], {
    cwd: root,
    encoding: "utf8",
  });
  const universal = execFileSync("make", ["-n", "dist-mac-universal"], {
    cwd: root,
    encoding: "utf8",
  });
  const legacy = execFileSync("make", ["-n", "dist-mac"], {
    cwd: root,
    encoding: "utf8",
  });

  assert.equal(
    x64,
    "pnpm run compile\npnpm exec electron-builder --mac --x64 --dir --config.mac.defaultArch=arm64\n",
  );
  assert.equal(
    arm64,
    "pnpm run compile\npnpm exec electron-builder --mac --arm64 --dir\n",
  );
  assert.equal(universal, "pnpm run dist:mac\n");
  assert.equal(legacy, arm64);
});

test("Makefile cleans every packaged artifact from the release directory", () => {
  const clean = execFileSync("make", ["-n", "clean-packages"], {
    cwd: root,
    encoding: "utf8",
  });

  assert.equal(clean, "rm -rf -- release\n");
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
