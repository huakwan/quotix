# Native Popover Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Quotix follow macOS light and dark appearances with a native popover surface whose dark neutral gray matches Docker Desktop more closely.

**Architecture:** Keep appearance selection entirely system-driven. Electron supplies the window background through the macOS `popover` vibrancy material, while semantic CSS variables control content contrast in dark mode and receive complete light-mode overrides through `prefers-color-scheme`.

**Tech Stack:** Electron 43 BrowserWindow, HTML/CSS, TypeScript, Node.js built-in test runner

## Global Constraints

- macOS remains the only supported platform.
- Follow the system appearance automatically; do not add or persist a manual theme setting.
- Keep the renderer panel transparent so native vibrancy remains visible.
- Do not change layout, dimensions, copy, quota behavior, IPC, placement, or show/hide behavior.
- Keep the existing macOS green, amber, and red progress colors.
- Do not add dependencies.

---

## File Structure

- `src/ui/popoverWindow.ts` owns the Electron BrowserWindow material and visual-effect state.
- `src/ui/popover.html` owns semantic appearance tokens and component styling.
- `tests/popoverTheme.test.mjs` verifies the native material and both CSS token sets from source because Node cannot render macOS vibrancy.

### Task 1: Use Native Popover Material

**Files:**
- Create: `tests/popoverTheme.test.mjs`
- Modify: `src/ui/popoverWindow.ts:12-32`

**Interfaces:**
- Consumes: Electron's `BrowserWindowConstructorOptions.vibrancy` property.
- Produces: A window configured with `vibrancy: "popover"` and `visualEffectState: "active"`.

- [ ] **Step 1: Write the failing material test**

Create `tests/popoverTheme.test.mjs`:

```js
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
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/popoverTheme.test.mjs`

Expected: FAIL at `assert.match` because the source still contains `vibrancy: "menu"`.

- [ ] **Step 3: Make the minimal material change**

In `createPopover()` in `src/ui/popoverWindow.ts`, change only the material:

```ts
vibrancy: "popover",
visualEffectState: "active",
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test tests/popoverTheme.test.mjs`

Expected: PASS, 1 test passed and 0 failed.

- [ ] **Step 5: Commit the material change**

```bash
git add tests/popoverTheme.test.mjs src/ui/popoverWindow.ts
git commit -m "style: use native popover material"
```

### Task 2: Complete Dark and Light Semantic Tokens

**Files:**
- Modify: `tests/popoverTheme.test.mjs`
- Modify: `src/ui/popover.html:10-196`

**Interfaces:**
- Consumes: Chromium's `prefers-color-scheme: light` media query.
- Produces: `--fg`, `--muted`, `--track`, `--separator`, `--control`, `--control-hover`, `--selected-control`, `--selected-border`, and `--selected-shadow` tokens in both appearances.

- [ ] **Step 1: Add failing CSS appearance tests**

Append to `tests/popoverTheme.test.mjs`:

```js
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
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/popoverTheme.test.mjs`

Expected: material and transparency tests PASS; semantic-token test FAILS first on missing dark `--separator`.

- [ ] **Step 3: Define complete dark and light token sets**

Replace the current theme variables at the top of `src/ui/popover.html` with:

```css
:root {
  --fg: rgba(255, 255, 255, 0.94);
  --muted: rgba(255, 255, 255, 0.52);
  --track: rgba(255, 255, 255, 0.18);
  --separator: rgba(255, 255, 255, 0.16);
  --control: rgba(255, 255, 255, 0.12);
  --control-hover: rgba(255, 255, 255, 0.18);
  --selected-control: rgba(255, 255, 255, 0.28);
  --selected-border: rgba(0, 0, 0, 0.32);
  --selected-shadow: rgba(0, 0, 0, 0.28);
  --green: #35c759;
  --amber: #ffcc00;
  --red: #ff453a;
}

@media (prefers-color-scheme: light) {
  :root {
    --fg: #1c1c1e;
    --muted: rgba(60, 60, 67, 0.60);
    --track: rgba(60, 60, 67, 0.18);
    --separator: rgba(60, 60, 67, 0.20);
    --control: rgba(118, 118, 128, 0.12);
    --control-hover: rgba(118, 118, 128, 0.18);
    --selected-control: rgba(255, 255, 255, 0.72);
    --selected-border: rgba(0, 0, 0, 0.12);
    --selected-shadow: rgba(0, 0, 0, 0.18);
  }
}
```

Keep `.codex-logo { filter: invert(1); }` as the dark default and its
`filter: none` light override inside a separate light media query.

- [ ] **Step 4: Route component styles through semantic tokens**

In `src/ui/popover.html`, use the tokens as follows:

```css
.source-section + .source-section {
  border-top: 1px solid var(--separator);
}

.divider,
.divider2 {
  background: var(--separator);
}

.segmented {
  background: var(--control);
}

.seg-btn:hover:not(.active) {
  background: var(--control-hover);
  color: var(--fg);
}

.seg-btn.active {
  background: var(--selected-control);
  color: var(--fg);
  box-shadow:
    0 1px 2px var(--selected-shadow),
    0 0 0 0.5px var(--selected-border);
}

.icon-btn:hover,
.icon-btn:active {
  background: var(--control-hover);
}
```

Keep `.track { background: var(--track); }`. Remove the obsolete `--chip`
variable and all uses of generic `var(--track)` as a separator or button
surface.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run: `node --test tests/popoverTheme.test.mjs`

Expected: PASS, 3 tests passed and 0 failed.

- [ ] **Step 6: Run typecheck and the complete unit suite**

Run: `pnpm run typecheck && pnpm test`

Expected: both commands exit 0; all unit tests pass with 0 failures.

- [ ] **Step 7: Commit the theme-token change**

```bash
git add tests/popoverTheme.test.mjs src/ui/popover.html
git commit -m "style: align popover theme with macOS"
```

### Task 3: Compile and Visually Verify Both Appearances

**Files:**
- Verify only; no production files should change.

**Interfaces:**
- Consumes: the completed BrowserWindow material and CSS token changes.
- Produces: verification evidence for packaged renderer assets and native macOS appearance.

- [ ] **Step 1: Build production assets**

Run: `pnpm run compile`

Expected: exit 0 and regenerated popover assets under `dist/` without build errors.

- [ ] **Step 2: Launch Quotix for manual dark-mode verification**

Run: `pnpm start`

Expected on a white desktop area: the dark popover surface is a neutral gray
close to Docker Desktop, darker than the previous Quotix surface, while the
wallpaper remains subtly visible through the vibrancy.

- [ ] **Step 3: Verify content hierarchy in dark mode**

Confirm primary text is brightest, secondary labels/reset/version text are
muted but readable, separators are quieter than progress tracks, and the active
segment has a native raised-control appearance.

- [ ] **Step 4: Switch macOS to light appearance while Quotix remains open**

Expected: the open popover updates without an application restart; text,
separators, tracks, controls, and Codex logo all switch to their light
treatments while the panel remains translucent.

- [ ] **Step 5: Re-run the final automated verification**

Run: `pnpm run typecheck && pnpm test && pnpm run compile`

Expected: all three commands exit 0 with 0 test failures and no TypeScript or
build errors.

