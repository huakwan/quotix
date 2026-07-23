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
  const renderer = readFileSync(join(root, "src/ui/popover/popoverRenderer.ts"), "utf8");
  const html = readFileSync(join(root, "src/ui/popover/popover.html"), "utf8");
  assert.match(renderer, /provider === "codex" \? "logo codex-logo" : "logo"/);
  assert.match(html, /\.codex-logo\s*\{[^}]*filter:\s*invert\(1\)/s);
  assert.match(html, /prefers-color-scheme:\s*light[\s\S]*\.codex-logo\s*\{[^}]*filter:\s*none/s);
});

test("tray follows the active macOS appearance", () => {
  const main = readFileSync(join(root, "src/main.ts"), "utf8");
  const tray = readFileSync(join(root, "src/ui/tray/trayCapture.html"), "utf8");

  assert.match(
    main,
    /renderTray\([\s\S]*preferences\.showPaceLine,[\s\S]*nativeTheme\.shouldUseDarkColors,[\s\S]*\)/,
  );
  assert.match(tray, /document\.documentElement\.style\.color = dark \? "#f2f2f2" : "#1c1c1e"/);
  assert.match(tray, /provider === "codex" && dark \? "invert\(1\)" : "none"/);
});

test("tray provides explicit 1x and 2x canvas image representations", () => {
  const source = readFileSync(join(root, "src/ui/tray/trayCapture.ts"), "utf8");

  assert.match(source, /window\.__renderCanvas/);
  assert.match(source, /addRepresentation\(\{\s*scaleFactor:\s*1/);
  assert.match(source, /addRepresentation\(\{\s*scaleFactor:\s*2/);
  assert.doesNotMatch(source, /screen\.getPrimaryDisplay\(\)\.scaleFactor/);
});

test("tray forces a single 1x image on macOS 12 and serializes canvas rendering", () => {
  const source = readFileSync(join(root, "src/ui/tray/trayCapture.ts"), "utf8");

  assert.match(
    source,
    /process\.getSystemVersion\(\)\.startsWith\("12\."\)[\s\S]*createFromDataURL\(rendered\.oneX\)/,
  );
  assert.match(source, /renderQueue\.then\(\(\) => drawTray/);
  assert.match(source, /renderQueue = drawing\.then/);
});

test("tray renders through canvas instead of capturing a hidden GPU surface", () => {
  const source = readFileSync(join(root, "src/ui/tray/trayCapture.ts"), "utf8");
  const html = readFileSync(join(root, "src/ui/tray/trayCapture.html"), "utf8");

  assert.match(html, /canvas\.toDataURL\("image\/png"\)/);
  assert.match(html, /oneX:\s*paint\(1\),\s*twoX:\s*paint\(2\)/);
  assert.doesNotMatch(source, /capturePage\(/);
});
