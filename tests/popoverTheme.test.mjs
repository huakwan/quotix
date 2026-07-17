import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("popover window uses the native active popover material", () => {
  const source = readFileSync(join(root, "src/ui/popoverWindow.ts"), "utf8");

  assert.match(source, /vibrancy:\s*"popover"/);
  assert.match(source, /visualEffectState:\s*"active"/);
  assert.doesNotMatch(source, /vibrancy:\s*"menu"/);
});
