import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadUpdatedAgo() {
  const renderer = readFileSync(join(root, "src/ui/popoverRenderer.ts"), "utf8");
  const source = renderer.match(/function updatedAgo[\s\S]*?\n}/)?.[0];
  assert.ok(source, "updatedAgo function should exist");
  const javascript = source.replaceAll(": number", "").replace(": string", "");
  return runInNewContext(`(${javascript})`);
}

function loadColorClass() {
  const renderer = readFileSync(join(root, "src/ui/popoverRenderer.ts"), "utf8");
  const source = renderer.match(/function colorClass[\s\S]*?\n}/)?.[0];
  assert.ok(source, "colorClass function should exist");
  const javascript = source
    .replace(/\(pct: number\)/, "(pct)")
    .replace(/:\s*"green"\s*\|\s*"amber"\s*\|\s*"red"/, "");
  return runInNewContext(`(${javascript})`);
}

test("popover quota bar turns amber at 75 percent", () => {
  const colorClass = loadColorClass();

  assert.equal(colorClass(74), "green");
  assert.equal(colorClass(75), "amber");
  assert.equal(colorClass(90), "amber");
  assert.equal(colorClass(91), "red");
});

test("updated age uses seconds only after ten seconds and before one minute", () => {
  const updatedAgo = loadUpdatedAgo();

  assert.equal(updatedAgo(100, 95), "updated just now");
  assert.equal(updatedAgo(100, 110), "updated just now");
  assert.equal(updatedAgo(100, 111), "updated 11 sec ago");
  assert.equal(updatedAgo(100, 159), "updated 59 sec ago");
  assert.equal(updatedAgo(100, 160), "updated 1 min ago");
});
