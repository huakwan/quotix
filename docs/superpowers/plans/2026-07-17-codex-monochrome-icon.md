# Codex Adaptive Monochrome Icon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the Codex mark black in light appearance and white in dark appearance on both the popover and menu bar.

**Architecture:** Keep one canonical black SVG asset. Apply theme-aware CSS inversion only to Codex icons, using `prefers-color-scheme` in the popover and the tray renderer's existing `dark` input in the capture page.

**Tech Stack:** SVG, TypeScript, Electron tray capture HTML/CSS, popover HTML/CSS, Node test runner, esbuild.

## Global Constraints

- Do not change the icon shape, view box, dimensions, layout, or quota behavior.
- Claude keeps its current colored icon in both appearances.
- Codex is black in light appearance and white in dark appearance.
- Use no additional runtime dependency or duplicate white icon asset.

---

### Task 1: Adaptive Codex Icon

**Files:**
- Modify: `assets/openai.svg`
- Modify: `src/ui/popoverRenderer.ts`
- Modify: `src/ui/popover.html`
- Modify: `src/ui/trayCapture.ts`
- Create: `tests/codexIcon.test.mjs`

**Interfaces:**
- Consumes: `renderTray(display: TrayDisplayState, dark: boolean)` and popover source-section rendering.
- Produces: one black canonical Codex SVG with surface-specific dark-mode inversion.

- [ ] **Step 1: Write the failing asset and source tests**

```js
test("Codex icon is canonical black", () => {
  const svg = readFileSync(join(root, "assets/openai.svg"), "utf8");
  assert.match(svg, /fill="(?:#000000|#000|black)"/i);
  assert.doesNotMatch(svg, /#10A37F/i);
});

test("popover and tray invert only the Codex icon in dark mode", () => {
  const renderer = readFileSync(join(root, "src/ui/popoverRenderer.ts"), "utf8");
  const html = readFileSync(join(root, "src/ui/popover.html"), "utf8");
  const tray = readFileSync(join(root, "src/ui/trayCapture.ts"), "utf8");
  assert.match(renderer, /codex-logo/);
  assert.match(html, /prefers-color-scheme: dark[\s\S]*\.codex-logo[\s\S]*invert\(1\)/);
  assert.match(tray, /provider === 'codex' && dark[\s\S]*invert\(1\)/);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/codexIcon.test.mjs`

Expected: FAIL because the SVG is green and no adaptive monochrome rules exist.

- [ ] **Step 3: Implement the minimal adaptive styling**

Change the SVG path to `fill="#000000"`. Add `codex-logo` only to the Codex
popover image and this rule inside the existing dark media query:

```css
.codex-logo { filter: invert(1); }
```

In the tray capture renderer, set:

```js
logo.style.filter = provider === 'codex' && dark ? 'invert(1)' : 'none';
```

- [ ] **Step 4: Verify focused and full checks**

Run: `node --test tests/codexIcon.test.mjs && pnpm run typecheck && pnpm test && pnpm run compile && git diff --check`

Expected: the focused test and all existing tests pass; TypeScript and esbuild exit 0.

- [ ] **Step 5: Commit**

```bash
git add assets/openai.svg src/ui/popoverRenderer.ts src/ui/popover.html src/ui/trayCapture.ts tests/codexIcon.test.mjs
git commit -m "style: make Codex icon adaptive monochrome"
```
