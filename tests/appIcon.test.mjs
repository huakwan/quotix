import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("ships editable and packaged macOS icon assets", () => {
  assert.equal(existsSync(join(root, "assets/icon.svg")), true);
  assert.equal(existsSync(join(root, "assets/icon.icns")), true);
  assert.match(readFileSync(join(root, "assets/icon.svg"), "utf8"), /viewBox="0 0 1024 1024"/);
});

test("icns contains every standard macOS icon representation", () => {
  const output = mkdtempSync(join(tmpdir(), "quotix-iconset-"));
  const iconset = join(output, "icon.iconset");
  try {
    execFileSync("/usr/bin/iconutil", ["-c", "iconset", join(root, "assets/icon.icns"), "-o", iconset]);
    for (const name of [
      "icon_16x16.png", "icon_16x16@2x.png", "icon_32x32.png", "icon_32x32@2x.png",
      "icon_128x128.png", "icon_128x128@2x.png", "icon_256x256.png", "icon_256x256@2x.png",
      "icon_512x512.png", "icon_512x512@2x.png",
    ]) assert.equal(existsSync(join(iconset, name)), true, `missing ${name}`);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});

test("electron-builder uses the custom macOS icon", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(pkg.build.mac.icon, "assets/icon.icns");
});
