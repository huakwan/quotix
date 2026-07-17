# Provider-Specific Quota Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore Claude's permanent `5H`/`7D` presentation while keeping Codex quota-window visibility dynamic.

**Architecture:** Put provider-specific display policy in the existing pure UI state helpers. Renderers continue consuming helper output, so popover and menu-bar behavior stay aligned without provider conditionals duplicated in rendering code.

**Tech Stack:** TypeScript 6, Electron 43, Node built-in test runner, pnpm.

## Global Constraints

- Claude always selects both `5H` and `7D`; missing values use the existing placeholder rendering.
- Codex selects only non-null normalized windows.
- Do not change quota normalization, polling, caching, preferences, colors, labels, or reset formatting.

---

### Task 1: Provider-aware quota visibility

**Files:**
- Modify: `tests/popoverState.test.mjs`
- Modify: `tests/trayState.test.mjs`
- Modify: `src/ui/popoverState.ts`
- Modify: `src/ui/popoverRenderer.ts`
- Modify: `src/ui/trayState.ts`

**Interfaces:**
- Consumes: `ProviderId`, normalized `Quota`, and existing `TrayDisplayState.provider`.
- Produces: `quotaRowsForProvider(provider: ProviderId, quota: Quota): QuotaRow[]`; retains `trayWindowVisibility(display: TrayDisplayState)` with provider-aware behavior.

- [ ] **Step 1: Write failing provider-separation tests**

Replace the provider-agnostic popover row test with:

```js
test("quota rows keep both Claude windows but filter missing Codex windows", () => {
  const weeklyOnly = {
    updatedAt: 100,
    session: null,
    weekly: { usedPct: 31, resetsAt: 900 },
    planDetected: true,
  };
  assert.deepEqual(
    quotaRowsForProvider("claude", weeklyOnly).map((row) => row.label),
    ["5H", "7D"],
  );
  assert.deepEqual(
    quotaRowsForProvider("codex", weeklyOnly).map((row) => row.label),
    ["7D"],
  );
});
```

Replace the tray visibility test with:

```js
test("tray visibility keeps both Claude windows but filters missing Codex windows", () => {
  const weeklyOnly = {
    provider: "codex", session: null, weekly: 31, loading: false, unavailable: false,
  };
  assert.deepEqual(trayWindowVisibility({ ...weeklyOnly, provider: "claude" }), {
    session: true, weekly: true,
  });
  assert.deepEqual(trayWindowVisibility(weeklyOnly), {
    session: false, weekly: true,
  });
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm exec tsc --outDir out && node --test tests/popoverState.test.mjs tests/trayState.test.mjs`

Expected: FAIL because `quotaRowsForProvider` does not exist and current tray visibility hides Claude session.

- [ ] **Step 3: Implement provider-aware pure helpers**

In `src/ui/popoverState.ts`, allow nullable row windows and replace `availableQuotaRows`:

```ts
export interface QuotaRow {
  label: "5H" | "7D";
  window: QuotaWindow | null;
}

export function quotaRowsForProvider(provider: ProviderId, quota: Quota): QuotaRow[] {
  if (provider === "claude") {
    return [
      { label: "5H", window: quota.session },
      { label: "7D", window: quota.weekly },
    ];
  }
  const rows: QuotaRow[] = [];
  if (quota.session) { rows.push({ label: "5H", window: quota.session }); }
  if (quota.weekly) { rows.push({ label: "7D", window: quota.weekly }); }
  return rows;
}
```

In `src/ui/trayState.ts`, update visibility:

```ts
export function trayWindowVisibility(display: TrayDisplayState): {
  session: boolean;
  weekly: boolean;
} {
  if (display.provider === "claude") {
    return { session: true, weekly: true };
  }
  return { session: display.session !== null, weekly: display.weekly !== null };
}
```

- [ ] **Step 4: Update the popover consumer**

In `src/ui/popoverRenderer.ts`, replace the helper import and call:

```ts
import { quotaRowsForProvider, sectionsForPayload, showMenuBarSetting, type PopoverPayload } from "./popoverState";
```

```ts
quotaRowsForProvider(provider, quota)
  .map((row) => rowHtml(row.label, row.window, payload.nowSec, payload.preferences.resetMode))
```

No tray renderer change is needed because it already consumes
`trayWindowVisibility(display)`.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `pnpm exec tsc --outDir out && node --test tests/popoverState.test.mjs tests/trayState.test.mjs`

Expected: all focused tests PASS.

- [ ] **Step 6: Run complete verification**

Run: `pnpm test`

Expected: all unit tests PASS with zero failures.

Run: `pnpm run typecheck`

Expected: exit 0 with no TypeScript errors.

Run: `pnpm run compile`

Expected: exit 0 with no bundle errors.

Run: `git diff --check`

Expected: exit 0 with no whitespace errors.

- [ ] **Step 7: Commit the fix**

```bash
git add src/ui/popoverState.ts src/ui/popoverRenderer.ts src/ui/trayState.ts tests/popoverState.test.mjs tests/trayState.test.mjs
git commit -m "fix: separate Claude and Codex quota visibility"
```
