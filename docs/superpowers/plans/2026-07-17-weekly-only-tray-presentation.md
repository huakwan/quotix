# Weekly-Only Tray Presentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide the `7D` label and widen its tray progress bar from 60px to 90px only when weekly is the sole visible quota window.

**Architecture:** Derive a testable `compactWeekly` flag from the existing provider-aware tray visibility helper. Pass that flag into the hidden BrowserWindow renderer, where one scoped CSS class changes only the weekly label and track width.

**Tech Stack:** TypeScript 6, Electron 43, embedded HTML/CSS/JavaScript, Node built-in test runner, pnpm.

## Global Constraints

- Compact mode triggers only for `{ session: false, weekly: true }` visibility.
- Compact mode hides `7D` and changes the weekly track from exactly 60px to exactly 90px.
- Session-only, dual-window, loading, unavailable, popover, colors, icons, percentages, spacing, and menu-bar height remain unchanged.

---

### Task 1: Weekly-only compact tray presentation

**Files:**
- Modify: `tests/trayState.test.mjs`
- Modify: `src/ui/trayState.ts`
- Modify: `src/ui/trayCapture.ts`

**Interfaces:**
- Consumes: existing `trayWindowVisibility(display: TrayDisplayState)`.
- Produces: `trayWindowPresentation(display: TrayDisplayState): { session: boolean; weekly: boolean; compactWeekly: boolean }`.

- [ ] **Step 1: Write failing presentation tests**

Import `trayWindowPresentation` in `tests/trayState.test.mjs` and add:

```js
test("tray presentation compacts only weekly-only visibility", () => {
  const base = { loading: false, unavailable: false };
  assert.deepEqual(trayWindowPresentation({
    ...base, provider: "codex", session: null, weekly: 31,
  }), { session: false, weekly: true, compactWeekly: true });

  assert.deepEqual(trayWindowPresentation({
    ...base, provider: "claude", session: null, weekly: 31,
  }), { session: true, weekly: true, compactWeekly: false });

  assert.equal(trayWindowPresentation({
    ...base, provider: "codex", session: 12, weekly: 31,
  }).compactWeekly, false);
  assert.equal(trayWindowPresentation({
    ...base, provider: "codex", session: 12, weekly: null,
  }).compactWeekly, false);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm exec tsc --outDir out && node --test tests/trayState.test.mjs`

Expected: FAIL because `trayWindowPresentation` does not exist.

- [ ] **Step 3: Implement the pure presentation selector**

Add to `src/ui/trayState.ts`:

```ts
export interface TrayWindowPresentation {
  session: boolean;
  weekly: boolean;
  compactWeekly: boolean;
}

export function trayWindowPresentation(display: TrayDisplayState): TrayWindowPresentation {
  const visibility = trayWindowVisibility(display);
  return {
    ...visibility,
    compactWeekly: !visibility.session && visibility.weekly,
  };
}
```

- [ ] **Step 4: Apply compact mode in the tray renderer**

In `src/ui/trayCapture.ts`, import `trayWindowPresentation` instead of
`trayWindowVisibility`.

Add scoped CSS after the base `.track` rule:

```css
  .grp.compact-weekly .label { display: none; }
  .grp.compact-weekly .track { width: 90px; }
```

Add `compactWeekly` to the `window.__render` arguments and toggle the class on
the weekly group every render so BrowserWindow reuse cannot retain stale state:

```js
window.__render = function(provider, s, w, showSession, showWeekly, compactWeekly, dark, loading, unavailable) {
  // existing setup
  grp7.classList.toggle('compact-weekly', compactWeekly);
  // existing state rendering
};
```

In `renderTray()`, replace the visibility selector with:

```ts
const presentation = trayWindowPresentation(display);
```

Pass `presentation.session`, `presentation.weekly`, and
`presentation.compactWeekly` to `window.__render`. Leave all other arguments and
rendering branches unchanged.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `pnpm exec tsc --outDir out && node --test tests/trayState.test.mjs`

Expected: all tray-state tests PASS.

- [ ] **Step 6: Run complete verification**

Run: `pnpm test`

Expected: all unit tests PASS with zero failures.

Run: `pnpm run typecheck`

Expected: exit 0 with no TypeScript errors.

Run: `pnpm run compile`

Expected: exit 0 with no bundle errors.

Run: `git diff --check`

Expected: exit 0 with no whitespace errors.

- [ ] **Step 7: Commit the implementation**

```bash
git add src/ui/trayState.ts src/ui/trayCapture.ts tests/trayState.test.mjs
git commit -m "style: compact weekly-only tray quota"
```
