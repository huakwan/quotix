import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("Codex icon is canonical black", () => {
  const svg = readFileSync(join(root, "assets/openai.svg"), "utf8");
  assert.match(svg, /fill="(?:#000000|#000|black)"/i);
  assert.doesNotMatch(svg, /#10A37F/i);
});

test("popover adapts only the Codex icon to the active appearance", () => {
  const renderer = readFileSync(join(root, "src/ui/popoverRenderer.ts"), "utf8");
  const html = readFileSync(join(root, "src/ui/popover.html"), "utf8");
  assert.match(renderer, /provider === "codex" \? "logo codex-logo" : "logo"/);
  assert.match(html, /\.codex-logo\s*\{[^}]*filter:\s*invert\(1\)/s);
  assert.match(html, /prefers-color-scheme:\s*light[\s\S]*\.codex-logo\s*\{[^}]*filter:\s*none/s);
});

test("tray inverts only the Codex icon in dark appearance", () => {
  const tray = readFileSync(join(root, "src/ui/trayCapture.ts"), "utf8");
  assert.match(tray, /provider === 'codex' && dark \? 'invert\(1\)' : 'none'/);
});
