import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function popoverHtml() {
  return readFileSync(join(root, "src/ui/popover.html"), "utf8");
}

function rootBlock(source) {
  const match = source.match(/:root\s*\{([\s\S]*?)\}/);
  assert.ok(match, "dark :root token block should exist");
  return match[1];
}

function lightBlock(source) {
  const match = source.match(/@media\s*\(prefers-color-scheme:\s*light\)\s*\{\s*:root\s*\{([\s\S]*?)\}/);
  assert.ok(match, "light appearance token block should exist");
  return match[1];
}

const semanticTokens = [
  "fg",
  "muted",
  "track",
  "separator",
  "control",
  "control-hover",
  "selected-control",
  "selected-border",
  "selected-shadow",
];

test("popover window uses the native active popover material", () => {
  const source = readFileSync(join(root, "src/ui/popoverWindow.ts"), "utf8");

  assert.match(source, /vibrancy:\s*"popover"/);
  assert.match(source, /visualEffectState:\s*"active"/);
  assert.doesNotMatch(source, /vibrancy:\s*"menu"/);
});

test("popover defines every semantic token for dark and light appearances", () => {
  const source = popoverHtml();
  const dark = rootBlock(source);
  const light = lightBlock(source);

  for (const token of semanticTokens) {
    assert.match(dark, new RegExp(`--${token}\\s*:`), `dark --${token}`);
    assert.match(light, new RegExp(`--${token}\\s*:`), `light --${token}`);
  }
});

test("popover leaves the document and panel transparent for native vibrancy", () => {
  const source = popoverHtml();

  assert.match(source, /html,\s*\n\s*body\s*\{\s*background:\s*transparent;/);
  assert.match(source, /\.panel\s*\{\s*background:\s*transparent;/);
});
