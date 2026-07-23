import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadUpdatedAgo() {
  const renderer = readFileSync(join(root, "src/ui/popover/popoverRenderer.ts"), "utf8");
  const source = renderer.match(/function updatedAgo[\s\S]*?\n}/)?.[0];
  assert.ok(source, "updatedAgo function should exist");
  const javascript = source.replaceAll(": number", "").replace(": string", "");
  return runInNewContext(`(${javascript})`);
}

function loadColorClass() {
  const renderer = readFileSync(join(root, "src/ui/popover/popoverRenderer.ts"), "utf8");
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

test("popover wires only named assisted-update actions", () => {
  const renderer = readFileSync(join(root, "src/ui/popover/popoverRenderer.ts"), "utf8");
  const preload = readFileSync(join(root, "src/ui/popover/preload.ts"), "utf8");

  for (const method of [
    "checkForUpdates",
    "downloadUpdate",
    "cancelUpdate",
    "installUpdate",
    "revealUpdate",
  ]) {
    assert.match(renderer, new RegExp(`window\\.quotix\\.${method}\\(`));
  }
  assert.match(preload, /ipcRenderer\.send\("update:check"\)/);
  assert.match(preload, /ipcRenderer\.send\("update:download"\)/);
  assert.doesNotMatch(preload, /send:\s*ipcRenderer\.send/);
  assert.doesNotMatch(renderer, /stagingRoot|appPath|browser_download_url/);
  assert.match(renderer, /updateLabel\.textContent = update\.label/);
});

test("download update is mouse-only and never retains focus", () => {
  const renderer = readFileSync(join(root, "src/ui/popover/popoverRenderer.ts"), "utf8");

  assert.match(renderer, /updateButton\.tabIndex = update\.action === "download" \? -1 : 0/);
  assert.match(renderer, /update\.action === "download" && document\.activeElement === updateButton/);
  assert.match(
    renderer,
    /addEventListener\("mousedown", \(event\) => \{\s*if \(currentUpdateAction === "download"\) \{ event\.preventDefault\(\); \}/,
  );
  assert.match(renderer, /canActivateUpdateAction\(currentUpdateAction, event\.detail\)/);
  assert.match(renderer, /case "download": window\.quotix\.downloadUpdate\(\)/);
});

test("popover exposes a fixed open-at-login preference action", () => {
  const renderer = readFileSync(join(root, "src/ui/popover/popoverRenderer.ts"), "utf8");
  const preload = readFileSync(join(root, "src/ui/popover/preload.ts"), "utf8");
  const html = readFileSync(join(root, "src/ui/popover/popover.html"), "utf8");
  const main = readFileSync(join(root, "src/main.ts"), "utf8");

  assert.match(html, /id="login-mode"/);
  assert.match(renderer, /window\.quotix\.setOpenAtLogin\(value === "on"\)/);
  assert.match(preload, /ipcRenderer\.send\("preferences:setOpenAtLogin", value\)/);
  assert.match(main, /function render\(\)[\s\S]*?refreshOpenAtLoginPreference\(\)/);
});

test("about action sits beside refresh and uses a narrow preload API", () => {
  const renderer = readFileSync(join(root, "src/ui/popover/popoverRenderer.ts"), "utf8");
  const preload = readFileSync(join(root, "src/ui/popover/preload.ts"), "utf8");
  const aboutPreload = readFileSync(join(root, "src/ui/about/aboutPreload.ts"), "utf8");
  const html = readFileSync(join(root, "src/ui/popover/popover.html"), "utf8");
  const main = readFileSync(join(root, "src/main.ts"), "utf8");

  assert.match(html, /id="about"[\s\S]*?id="refresh"/);
  assert.match(html, /#about svg\s*\{[\s\S]*?width: 18px;[\s\S]*?height: 18px;/);
  assert.match(renderer, /window\.quotix\.openAbout\(\)/);
  assert.match(preload, /ipcRenderer\.send\("about:open"\)/);
  assert.doesNotMatch(preload, /ipcRenderer\.send\("about:close"\)/);
  assert.match(aboutPreload, /ipcRenderer\.send\("about:close"\)/);
  assert.match(main, /event\.sender === popover\.webContents/);
  assert.match(main, /event\.sender === aboutWindow\.webContents/);
});

test("about donation card keeps the QR anonymous on screen and transparent", () => {
  const html = readFileSync(join(root, "src/ui/about/about.html"), "utf8");
  const renderer = readFileSync(join(root, "src/ui/about/aboutRenderer.ts"), "utf8");

  assert.match(html, /<h2>Buy me a coffee<\/h2>/);
  assert.match(html, /Scan with mobile banking app and choose any amount\./);
  assert.match(html, /090-xxx-1123/);
  assert.doesNotMatch(html, /0902811123|090-281-1123/);
  assert.match(html, /src="\.\.\/assets\/promptpay\.png"/);
  assert.match(renderer, /dark: "#ffffff"/);
  assert.match(renderer, /light: "#00000000"/);
});
