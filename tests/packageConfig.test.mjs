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
