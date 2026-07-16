# Quotix Popover UI — Design

Date: 2026-07-16

## Goal

Replace the single-line tray-title-only UI with two surfaces:

1. **Tray title** (menu bar text) shows **one** window at a time — either the
   5-hour session or the 7-day weekly quota. Which one is shown is toggleable.
2. **Popover panel** (opened by clicking the tray icon) renders **both** windows
   as two rows with logo, colored progress bars, status dots, percentages, and
   reset countdowns.

The popover visual reference is a two-row layout (session on top, weekly below),
each row a labeled progress bar with a status dot and countdown.

## Constraints

- macOS-only Electron menu bar app; `LSUIElement` (no dock icon).
- `Tray.setTitle()` is OS-native plain text — a single line, no images/colors.
  The rich two-row layout therefore lives in a real `BrowserWindow`, not the
  tray title.
- The `/oauth/usage` API does **not** return a model name, so no model label is
  shown (the reference image's "Opus 4.8" is dropped).
- Keep the existing one-directional data flow: `poll()` → `lastResult` →
  render. The popover is a new render target fed the same `lastResult`.
- Keep the existing sync-seed/async-refresh token provider and the distinct
  401/429 handling in `oauthCredentials.ts` / `oauthSource.ts` untouched.

## Architecture

`src/main.ts` remains the wiring hub. New pieces:

- **Popover window** — a frameless, transparent, always-on-top `BrowserWindow`
  positioned just below the tray icon. Shown on tray left-click, hidden on
  blur. Left-click currently opens the context menu (because
  `setContextMenu` is set); that binding moves to **right-click** so left-click
  is free for the popover.
- **Renderer** — `popover.html` + bundled `popoverRenderer.js` draw the two
  rows. Receives data over IPC; sends toggle/refresh back over IPC.
- **Preferences** — the chosen primary window (`"session"` | `"weekly"`) is
  persisted to a small JSON file in `app.getPath("userData")` so it survives
  restarts.

Data flow (one direction, as today):

```
poll() → lastResult ──┬─→ tray.setTitle(trayTitle(lastResult, primary, ...))
                      └─→ popover.webContents.send("quota:update", {...})
```

## Components

### `src/prefs.ts`
- `type Primary = "session" | "weekly"`
- `loadPrimary(): Primary` — read JSON from userData, default `"session"`.
- `savePrimary(p: Primary): void` — write JSON, best-effort (ignore write
  errors so the app never crashes on a read-only home).

### `src/render.ts` (modified)
- `trayTitle(result, primary, width, nowSec)` gains a `primary` parameter that
  selects which window (`session` or `weekly`) is rendered in the single-line
  tray title. Existing `bar()`, `countdown()`, `segment()`, `trayTooltip()`
  stay as-is.

### `src/popoverWindow.ts`
- `createPopover(): BrowserWindow` — frameless, transparent, `resizable:false`,
  `skipTaskbar:true`, `show:false`, with a preload script and
  `contextIsolation:true`, `nodeIntegration:false`.
- `togglePopover(win, trayBounds)` — position below the tray icon (center the
  window under `trayBounds`), `show()` + `focus()`; if already visible, `hide()`.
- Hide on `blur`.

### `src/preload.ts`
- Via `contextBridge.exposeInMainWorld("quotix", {...})`:
  - `onUpdate(cb)` — subscribe to `quota:update`.
  - `setPrimary(p)` — send `quota:setPrimary`.
  - `refresh()` — send `quota:refresh`.
  - `quit()` — send `quota:quit`.

### `src/popover.html` + `src/popoverRenderer.ts`
- Static markup + inline CSS. Panel ~260×120px, rounded corners, dark
  background with a light-mode variant via `prefers-color-scheme`.
- Layout:
  ```
  ✳  Claude
  5h  ●  ▓▓▓▓▓░░░░░  4%  · 3h57m
  Wk  ●  ▓▓░░░░░░░░  1%  · 5d2h
  [ 5h ] [ 7d ]              ↻  ⏻
  ```
- Each row: label, status dot, progress bar, percent, countdown.
- **Color thresholds** (dot + bar fill): green `< 70%`, amber `70–90%`,
  red `> 90%`.
- `[5h]/[7d]` toggle highlights the current primary; clicking sends
  `setPrimary`.
- `↻` calls `refresh()`; `⏻` (or equivalent) calls `quit()`.
- When `result.ok === false`, show an "unavailable (reason)" state instead of
  the rows.
- The renderer recomputes countdowns on its own tick so they stay live between
  pushes (mirrors the existing `RENDER_TICK_SECONDS` behavior).

### `src/main.ts` (modified)
- Create the popover at startup.
- `tray.on("click", ...)` → `togglePopover`. `tray.on("right-click", ...)` →
  the existing Refresh/Quit context menu (`tray.popUpContextMenu(menu)`).
- Load `primary` from prefs at startup; pass it to `trayTitle`.
- In `render()`, also `send("quota:update", { result, primary, nowSec })` to
  the popover.
- IPC handlers: `quota:setPrimary` (update `primary`, save prefs, re-render),
  `quota:refresh` (call `poll()`), `quota:quit` (`app.quit()`).

## Build (`esbuild.js`, modified)

- Add entry points: `src/preload.ts` → `dist/preload.js`,
  `src/popoverRenderer.ts` → `dist/popoverRenderer.js`.
  - `preload.ts` bundles as `platform:node`, `external:["electron"]`.
  - `popoverRenderer.ts` bundles as `platform:browser` (no electron import;
    uses only `window.quotix`).
- Copy `src/popover.html` → `dist/popover.html` on each build (and on rebuild
  in watch mode).
- Popover loads `dist/popover.html`, which references `popoverRenderer.js`.
- `package.json` `build.files` already globs `dist/**/*`, so no packaging change
  needed.

## Error handling

- Popover `quota:update` with `result.ok === false` → renderer shows the
  unavailable state; tray title falls back to `"Quota: --"` (unchanged).
- `prefs.ts` swallows read/write errors and falls back to `"session"`.
- Popover creation/positioning must not throw into the poll loop; wrap the
  send in a guard (`if (popover && !popover.isDestroyed())`).

## Testing

No automated test suite exists in this repo. Manual verification via
`pnpm start`:

1. Tray shows the session window by default.
2. Click tray → popover appears below the icon with two rows; colors match the
   thresholds; countdowns tick.
3. Click `[7d]` → tray title switches to weekly; restart → still weekly.
4. Click `↻` → immediate refresh. Right-click tray → Refresh/Quit menu.
5. Blur (click elsewhere) → popover hides.

## Out of scope (YAGNI)

- Model name label.
- Configurable colors, sizes, or refresh interval UI.
- Non-macOS support.
