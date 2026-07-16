# Popover UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a click-to-open popover panel that renders both quota windows as two styled rows, and make the tray title show one toggleable window.

**Architecture:** Keep the existing one-directional data flow in `src/main.ts` (`poll()` → `lastResult` → render). Add a frameless transparent `BrowserWindow` as a second render target fed the same `lastResult` over IPC. Tray title gains a `primary` selector; the popover has a toggle that changes it and persists the choice.

**Tech Stack:** Electron 43, TypeScript, esbuild (bundler, no typecheck), pnpm.

## Global Constraints

- macOS-only; app runs as `LSUIElement` (no dock icon), no existing windows.
- No test suite, no lint, no typecheck step — verification is `pnpm run compile` (must succeed) plus manual `pnpm start` checks.
- `Tray.setTitle()` is single-line plain text only — rich UI lives in the BrowserWindow.
- Keep the sync-seed/async-refresh token provider and 401/429 handling untouched (`oauthCredentials.ts`, `oauthSource.ts`).
- Popover security: `contextIsolation: true`, `nodeIntegration: false`, preload via `contextBridge`, local files only.
- Commit messages: no AI attribution, no Co-Authored-By, no trailing lines.
- Color thresholds (dot + bar): green `< 70`, amber `70–90`, red `> 90` (percent used).

---

## File Structure

- Create `src/prefs.ts` — load/save primary-window preference JSON in userData.
- Modify `src/render.ts` — `trayTitle()` gains `primary` param.
- Create `src/popoverWindow.ts` — create/position/toggle the BrowserWindow.
- Create `src/preload.ts` — contextBridge API for the renderer.
- Create `src/popover.html` — panel markup + inline CSS.
- Create `src/popoverRenderer.ts` — draw rows, wire buttons, live countdown tick.
- Modify `src/main.ts` — wire popover, IPC handlers, click bindings, push updates.
- Modify `esbuild.js` — add preload + renderer entry points, copy html.

---

### Task 1: Primary-window preference (`src/prefs.ts`)

**Files:**
- Create: `src/prefs.ts`

**Interfaces:**
- Produces: `type Primary = "session" | "weekly"`, `loadPrimary(): Primary`, `savePrimary(p: Primary): void`

- [ ] **Step 1: Write `src/prefs.ts`**

```typescript
import { app } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Primary = "session" | "weekly";

function prefsPath(): string {
  return join(app.getPath("userData"), "quotix-prefs.json");
}

export function loadPrimary(): Primary {
  try {
    const raw = readFileSync(prefsPath(), "utf8");
    const parsed = JSON.parse(raw) as { primary?: unknown };
    return parsed.primary === "weekly" ? "weekly" : "session";
  } catch {
    return "session";
  }
}

export function savePrimary(p: Primary): void {
  try {
    writeFileSync(prefsPath(), JSON.stringify({ primary: p }), "utf8");
  } catch {
    /* best-effort: never crash the app on a read-only home */
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm run compile`
Expected: build succeeds, `dist/main.js` written (prefs.ts is pulled in once main.ts imports it in Task 6; compiling now just checks syntax via the bundler — if not yet imported, this task's file is validated in Task 6's build. Proceed.)

- [ ] **Step 3: Commit**

```bash
git add src/prefs.ts
git commit -m "feat: add primary-window preference storage"
```

---

### Task 2: Tray title primary selector (`src/render.ts`)

**Files:**
- Modify: `src/render.ts:26-30`

**Interfaces:**
- Consumes: `Primary` from `./prefs`.
- Produces: `trayTitle(result: ReadResult, primary: Primary, width: number, nowSec: number): string`

- [ ] **Step 1: Update `trayTitle` in `src/render.ts`**

Replace the current `trayTitle` (lines 26-30) with:

```typescript
import { QuotaWindow, ReadResult } from "./model";
import { Primary } from "./prefs";

// ... bar(), countdown(), segment() unchanged ...

// Plain text for Tray.setTitle() — no codicons/theme colors, those are VSCode-only.
export function trayTitle(result: ReadResult, primary: Primary, width: number, nowSec: number): string {
  if (!result.ok) { return "Quota: --"; }
  if (primary === "weekly") {
    return segment("W", result.quota.weekly, width, nowSec);
  }
  return segment("S", result.quota.session, width, nowSec);
}
```

Add the `import { Primary } from "./prefs";` line at the top (after the existing model import). Leave `trayTooltip`, `bar`, `countdown`, `segment` unchanged.

- [ ] **Step 2: Verify it compiles**

Run: `pnpm run compile`
Expected: build fails only in `main.ts` (it still calls the old `trayTitle` signature) — that is fixed in Task 6. If `render.ts` itself has a syntax/type error the bundler will report it against `render.ts`; there should be none.

Note: esbuild does not typecheck, so a signature mismatch in main.ts will NOT fail the build. It compiles clean. Proceed.

- [ ] **Step 3: Commit**

```bash
git add src/render.ts
git commit -m "feat: tray title selects session or weekly window"
```

---

### Task 3: Preload bridge (`src/preload.ts`)

**Files:**
- Create: `src/preload.ts`

**Interfaces:**
- Produces (on `window.quotix`): `onUpdate(cb: (payload: UpdatePayload) => void): void`, `setPrimary(p: "session" | "weekly"): void`, `refresh(): void`, `quit(): void`
- `UpdatePayload = { result: ReadResult; primary: "session" | "weekly"; nowSec: number }`

- [ ] **Step 1: Write `src/preload.ts`**

```typescript
import { contextBridge, ipcRenderer } from "electron";
import type { ReadResult } from "./model";

export interface UpdatePayload {
  result: ReadResult;
  primary: "session" | "weekly";
  nowSec: number;
}

contextBridge.exposeInMainWorld("quotix", {
  onUpdate: (cb: (payload: UpdatePayload) => void): void => {
    ipcRenderer.on("quota:update", (_e, payload: UpdatePayload) => cb(payload));
  },
  setPrimary: (p: "session" | "weekly"): void => { ipcRenderer.send("quota:setPrimary", p); },
  refresh: (): void => { ipcRenderer.send("quota:refresh"); },
  quit: (): void => { ipcRenderer.send("quota:quit"); },
});
```

- [ ] **Step 2: Commit** (build verified in Task 7 once esbuild has the entry point)

```bash
git add src/preload.ts
git commit -m "feat: add popover preload bridge"
```

---

### Task 4: Popover markup + styles (`src/popover.html`)

**Files:**
- Create: `src/popover.html`

- [ ] **Step 1: Write `src/popover.html`**

```html
<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  :root {
    --bg: rgba(30, 30, 32, 0.92);
    --fg: #f2f2f2;
    --muted: #9a9a9e;
    --track: rgba(255, 255, 255, 0.14);
    --green: #35c759;
    --amber: #ffcc00;
    --red: #ff453a;
    --chip: rgba(255, 255, 255, 0.10);
    --chip-on: rgba(255, 255, 255, 0.28);
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg: rgba(250, 250, 250, 0.96);
      --fg: #1c1c1e; --muted: #6b6b70;
      --track: rgba(0, 0, 0, 0.12);
      --chip: rgba(0, 0, 0, 0.08); --chip-on: rgba(0, 0, 0, 0.22);
    }
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: transparent; }
  body {
    font: 12px -apple-system, system-ui, sans-serif;
    color: var(--fg);
    -webkit-user-select: none; user-select: none;
  }
  .panel {
    background: var(--bg);
    border-radius: 12px;
    padding: 12px 14px;
    margin: 6px;
    -webkit-backdrop-filter: blur(20px);
  }
  .header { display: flex; align-items: center; gap: 6px; font-weight: 600; margin-bottom: 10px; }
  .header .logo { color: var(--amber); }
  .row { display: grid; grid-template-columns: 22px 10px 1fr auto auto; align-items: center; gap: 8px; margin: 6px 0; }
  .row .label { color: var(--muted); font-weight: 600; }
  .dot { width: 8px; height: 8px; border-radius: 50%; }
  .track { height: 6px; border-radius: 3px; background: var(--track); overflow: hidden; }
  .fill { height: 100%; border-radius: 3px; width: 0%; }
  .pct { font-variant-numeric: tabular-nums; min-width: 30px; text-align: right; }
  .reset { color: var(--muted); font-variant-numeric: tabular-nums; min-width: 44px; text-align: right; }
  .footer { display: flex; align-items: center; gap: 6px; margin-top: 10px; }
  .chip { background: var(--chip); border: 0; color: var(--fg); border-radius: 6px; padding: 3px 10px; font: inherit; font-weight: 600; cursor: pointer; }
  .chip.on { background: var(--chip-on); }
  .spacer { flex: 1; }
  .icon-btn { background: none; border: 0; color: var(--muted); font-size: 14px; cursor: pointer; padding: 2px 6px; }
  .icon-btn:hover { color: var(--fg); }
  .unavailable { color: var(--muted); padding: 8px 0; }
  .green { background: var(--green); } .amber { background: var(--amber); } .red { background: var(--red); }
</style>
</head>
<body>
  <div class="panel">
    <div class="header"><span class="logo">✳</span><span>Claude</span></div>
    <div id="rows"></div>
    <div class="footer">
      <button class="chip" id="chip-session" data-primary="session">5h</button>
      <button class="chip" id="chip-weekly" data-primary="weekly">7d</button>
      <span class="spacer"></span>
      <button class="icon-btn" id="refresh" title="Refresh now">↻</button>
      <button class="icon-btn" id="quit" title="Quit">⏻</button>
    </div>
  </div>
  <script src="popoverRenderer.js"></script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add src/popover.html
git commit -m "feat: add popover panel markup and styles"
```

---

### Task 5: Popover renderer (`src/popoverRenderer.ts`)

**Files:**
- Create: `src/popoverRenderer.ts`

**Interfaces:**
- Consumes: `window.quotix` from Task 3.
- Renders into `#rows` and wires `#chip-session`, `#chip-weekly`, `#refresh`, `#quit` from Task 4.

- [ ] **Step 1: Write `src/popoverRenderer.ts`**

```typescript
import type { ReadResult, QuotaWindow } from "./model";
import type { UpdatePayload } from "./preload";

declare global {
  interface Window {
    quotix: {
      onUpdate(cb: (p: UpdatePayload) => void): void;
      setPrimary(p: "session" | "weekly"): void;
      refresh(): void;
      quit(): void;
    };
  }
}

let last: UpdatePayload | null = null;

function colorClass(pct: number): "green" | "amber" | "red" {
  if (pct > 90) { return "red"; }
  if (pct >= 70) { return "amber"; }
  return "green";
}

function countdown(resetsAt: number | null, nowSec: number): string {
  if (resetsAt === null) { return "--"; }
  let s = Math.max(0, Math.floor(resetsAt - nowSec));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60);
  if (d > 0) { return `${d}d${h}h`; }
  if (h > 0) { return `${h}h${m}m`; }
  return `${m}m`;
}

function rowHtml(label: string, w: QuotaWindow | null, nowSec: number): string {
  if (!w) {
    return `<div class="row"><span class="label">${label}</span><span class="dot"></span>` +
      `<div class="track"></div><span class="pct">--%</span><span class="reset">--</span></div>`;
  }
  const pct = Math.round(w.usedPct);
  const cls = colorClass(w.usedPct);
  const width = Math.max(0, Math.min(100, w.usedPct));
  return `<div class="row">` +
    `<span class="label">${label}</span>` +
    `<span class="dot ${cls}"></span>` +
    `<div class="track"><div class="fill ${cls}" style="width:${width}%"></div></div>` +
    `<span class="pct">${pct}%</span>` +
    `<span class="reset">${countdown(w.resetsAt, nowSec)}</span>` +
    `</div>`;
}

function draw(): void {
  if (!last) { return; }
  const rows = document.getElementById("rows")!;
  const nowSec = Math.floor(last.nowSec + 0); // base; live tick advances below
  if (!last.result.ok) {
    rows.innerHTML = `<div class="unavailable">Quota unavailable (${last.result.reason})</div>`;
  } else {
    rows.innerHTML =
      rowHtml("5h", last.result.quota.session, nowSec) +
      rowHtml("Wk", last.result.quota.weekly, nowSec);
  }
  document.getElementById("chip-session")!.classList.toggle("on", last.primary === "session");
  document.getElementById("chip-weekly")!.classList.toggle("on", last.primary === "weekly");
}

window.quotix.onUpdate((p) => { last = p; draw(); });

document.getElementById("chip-session")!.addEventListener("click", () => window.quotix.setPrimary("session"));
document.getElementById("chip-weekly")!.addEventListener("click", () => window.quotix.setPrimary("weekly"));
document.getElementById("refresh")!.addEventListener("click", () => window.quotix.refresh());
document.getElementById("quit")!.addEventListener("click", () => window.quotix.quit());

// Live countdown between pushes: advance nowSec locally each second.
setInterval(() => {
  if (last) { last = { ...last, nowSec: last.nowSec + 1 }; draw(); }
}, 1000);
```

- [ ] **Step 2: Commit**

```bash
git add src/popoverRenderer.ts
git commit -m "feat: add popover renderer with live countdown"
```

---

### Task 6: Popover window (`src/popoverWindow.ts`)

**Files:**
- Create: `src/popoverWindow.ts`

**Interfaces:**
- Produces: `createPopover(): BrowserWindow`, `togglePopover(win: BrowserWindow, trayBounds: Electron.Rectangle): void`

- [ ] **Step 1: Write `src/popoverWindow.ts`**

```typescript
import { BrowserWindow, screen } from "electron";
import { join } from "node:path";

const WIDTH = 272;
const HEIGHT = 150;

export function createPopover(): BrowserWindow {
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(join(__dirname, "popover.html"));
  win.on("blur", () => { if (!win.isDestroyed()) { win.hide(); } });
  return win;
}

export function togglePopover(win: BrowserWindow, trayBounds: Electron.Rectangle): void {
  if (win.isVisible()) { win.hide(); return; }
  const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
  let x = Math.round(trayBounds.x + trayBounds.width / 2 - WIDTH / 2);
  const y = Math.round(trayBounds.y + trayBounds.height + 2);
  const maxX = display.workArea.x + display.workArea.width - WIDTH - 4;
  x = Math.max(display.workArea.x + 4, Math.min(x, maxX));
  win.setPosition(x, y, false);
  win.show();
  win.focus();
}
```

- [ ] **Step 2: Commit**

```bash
git add src/popoverWindow.ts
git commit -m "feat: add popover window creation and positioning"
```

---

### Task 7: Wire everything in main + build (`src/main.ts`, `esbuild.js`)

**Files:**
- Modify: `esbuild.js`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: all prior tasks.

- [ ] **Step 1: Update `esbuild.js` to build preload + renderer and copy html**

Replace the file with:

```javascript
const esbuild = require("esbuild");
const { copyFileSync } = require("node:fs");
const watch = process.argv.includes("--watch");

const copyHtml = {
  name: "copy-html",
  setup(build) {
    build.onEnd(() => { copyFileSync("src/popover.html", "dist/popover.html"); });
  },
};

async function main() {
  const node = {
    bundle: true, format: "cjs", platform: "node", target: "node20",
    external: ["electron"], sourcemap: true, logLevel: "info",
  };
  const contexts = await Promise.all([
    esbuild.context({ ...node, entryPoints: ["src/main.ts"], outfile: "dist/main.js" }),
    esbuild.context({ ...node, entryPoints: ["src/preload.ts"], outfile: "dist/preload.js" }),
    esbuild.context({
      entryPoints: ["src/popoverRenderer.ts"], outfile: "dist/popoverRenderer.js",
      bundle: true, format: "iife", platform: "browser", target: "es2020",
      sourcemap: true, logLevel: "info", plugins: [copyHtml],
    }),
  ]);
  if (watch) {
    await Promise.all(contexts.map((c) => c.watch()));
  } else {
    await Promise.all(contexts.map((c) => c.rebuild()));
    await Promise.all(contexts.map((c) => c.dispose()));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
```

Note: the `copyHtml` plugin runs on the renderer build's `onEnd`, so `dist/` must exist — it does after the main build writes `dist/main.js`. Since all three build concurrently, add a safety: the plugin ignores a missing dir by creating it. Update the plugin body:

```javascript
  setup(build) {
    const { mkdirSync } = require("node:fs");
    build.onEnd(() => {
      mkdirSync("dist", { recursive: true });
      copyFileSync("src/popover.html", "dist/popover.html");
    });
  },
```

- [ ] **Step 2: Rewrite `src/main.ts`**

```typescript
import { app, Tray, Menu, nativeImage, ipcMain, BrowserWindow } from "electron";
import { createCachedTokenProvider } from "./oauthCredentials";
import { fetchOAuthQuota } from "./oauthSource";
import { trayTitle, trayTooltip } from "./render";
import { ReadResult } from "./model";
import { loadPrimary, savePrimary, Primary } from "./prefs";
import { createPopover, togglePopover } from "./popoverWindow";

const REFRESH_INTERVAL_SECONDS = 60;
const RENDER_TICK_SECONDS = 10;
const BAR_WIDTH = 10;

let tray: Tray | undefined;
let popover: BrowserWindow | undefined;
let lastResult: ReadResult = { ok: false, reason: "missing" };
let pollTimer: NodeJS.Timeout | undefined;
let primary: Primary = "session";

const tokenProvider = createCachedTokenProvider();

function render(): void {
  if (!tray) { return; }
  const nowSec = Math.floor(Date.now() / 1000);
  tray.setTitle(trayTitle(lastResult, primary, BAR_WIDTH, nowSec));
  tray.setToolTip(trayTooltip(lastResult, nowSec));
  if (popover && !popover.isDestroyed()) {
    popover.webContents.send("quota:update", { result: lastResult, primary, nowSec });
  }
}

async function poll(): Promise<void> {
  const token = tokenProvider.get();
  if (!token.ok) {
    lastResult = { ok: false, reason: "missing" };
    render();
    schedule(REFRESH_INTERVAL_SECONDS);
    return;
  }

  const result = await fetchOAuthQuota(token.token, fetch);
  if (result.tokenInvalid) { tokenProvider.invalidate(); }
  lastResult = result;
  render();
  schedule(result.retryAfterSeconds ?? REFRESH_INTERVAL_SECONDS);
}

function schedule(delaySeconds: number): void {
  if (pollTimer) { clearTimeout(pollTimer); }
  pollTimer = setTimeout(() => { void poll(); }, delaySeconds * 1000);
}

const contextMenu = Menu.buildFromTemplate([
  { label: "Refresh now", click: () => void poll() },
  { type: "separator" },
  { label: "Quit", role: "quit" },
]);

app.whenReady().then(() => {
  app.dock?.hide();
  primary = loadPrimary();

  popover = createPopover();

  tray = new Tray(nativeImage.createEmpty());
  tray.on("click", () => { if (popover && tray) { togglePopover(popover, tray.getBounds()); } });
  tray.on("right-click", () => { tray?.popUpContextMenu(contextMenu); });

  ipcMain.on("quota:setPrimary", (_e, p: Primary) => {
    primary = p === "weekly" ? "weekly" : "session";
    savePrimary(primary);
    render();
  });
  ipcMain.on("quota:refresh", () => void poll());
  ipcMain.on("quota:quit", () => app.quit());

  render();
  void poll();
  setInterval(render, RENDER_TICK_SECONDS * 1000);
});

app.on("window-all-closed", () => { /* menu bar app has no windows to keep it alive */ });
```

- [ ] **Step 3: Build**

Run: `pnpm run compile`
Expected: three outputs written — `dist/main.js`, `dist/preload.js`, `dist/popoverRenderer.js`, plus `dist/popover.html` copied. Build succeeds with no errors.

- [ ] **Step 4: Manual verify**

Run: `pnpm start`
Expected:
1. Menu bar shows session bar (e.g. `S ██░░░░░░░░ 4% · 3h57m`).
2. Click the tray text → popover appears below it with two rows (5h, Wk), colored dots/bars, live countdown.
3. Click `7d` chip → chip highlights, menu bar switches to weekly (`W ...`).
4. Quit and `pnpm start` again → menu bar still shows weekly (pref persisted).
5. Click `↻` → refresh happens. Click `⏻` → app quits.
6. Right-click tray → Refresh/Quit menu still works.
7. Click elsewhere → popover hides.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts esbuild.js
git commit -m "feat: wire popover into tray with click toggle and IPC"
```

---

## Self-Review

- **Spec coverage:** popover render target ✓ (T4–T6), tray title toggle ✓ (T2), primary persistence ✓ (T1), IPC channels ✓ (T3,T7), color thresholds ✓ (T5), build changes ✓ (T7), right-click menu preserved ✓ (T7), no model name ✓, error/unavailable state ✓ (T5). All spec sections mapped.
- **Type consistency:** `Primary` defined in T1, imported in T2/T7; `UpdatePayload` defined in T3, imported in T5; `quota:update`/`quota:setPrimary`/`quota:refresh`/`quota:quit` channel names match across T3/T5/T7; `createPopover`/`togglePopover` signatures match T6→T7.
- **Placeholder scan:** none — all steps carry full code.

## Notes on TDD

This repo has no test runner, lint, or typecheck. Per-task verification is `pnpm run compile` (syntax/bundle) with a single end-to-end manual `pnpm start` pass in Task 7. Do not add a test framework — out of scope.
