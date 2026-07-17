# Dynamic Codex Quota Windows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Classify Codex quota windows by reported duration and render only the normalized windows that are actually available.

**Architecture:** Keep the shared `Quota` shape unchanged. Normalize Codex `primary` and `secondary` windows into session/weekly slots using `windowDurationMins`, with legacy positional fallback, then expose pure UI selection helpers that both renderers consume.

**Tech Stack:** TypeScript 6, Electron 43, Node built-in test runner, pnpm.

## Global Constraints

- A Codex window with `windowDurationMins >= 10,080` maps to `weekly`; a shorter positive duration maps to `session`.
- Payloads without duration metadata keep the legacy primary/session and secondary/weekly mapping.
- The first valid window assigned to a slot wins.
- Claude normalization, polling, cache format, preferences, colors, and reset formatting remain unchanged.
- Do not log or persist raw app-server payloads.

---

### Task 1: Duration-aware Codex normalization

**Files:**
- Modify: `tests/codexProvider.test.mjs`
- Modify: `src/quota/model.ts`

**Interfaces:**
- Consumes: raw result from `account/rateLimits/read`.
- Produces: existing `quotaFromCodexRateLimits(response: unknown, updatedAt: number): Quota` with duration-aware slot assignment.

- [ ] **Step 1: Write failing normalization tests**

Add tests proving the current single-window payload maps to weekly and that a shorter window maps to session:

```js
test("classifies Codex windows by reported duration", () => {
  const weeklyOnly = quotaFromCodexRateLimits({
    rateLimitsByLimitId: { codex: {
      primary: { usedPercent: 31, resetsAt: 900, windowDurationMins: 10_080 },
    } },
  }, 100);
  assert.equal(weeklyOnly.session, null);
  assert.deepEqual(weeklyOnly.weekly, { usedPct: 31, resetsAt: 900 });

  const dual = quotaFromCodexRateLimits({
    rateLimitsByLimitId: { codex: {
      primary: { usedPercent: 12, resetsAt: 200, windowDurationMins: 300 },
      secondary: { usedPercent: 34, resetsAt: 800, windowDurationMins: 10_080 },
    } },
  }, 100);
  assert.equal(dual.session.usedPct, 12);
  assert.equal(dual.weekly.usedPct, 34);
});
```

Keep the existing duration-less named-bucket test as legacy fallback coverage.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm exec tsc --outDir out && node --test tests/codexProvider.test.mjs`

Expected: FAIL because the single 10,080-minute primary window is still mapped to `session`.

- [ ] **Step 3: Implement minimal duration-aware assignment**

In `src/quota/model.ts`, retain `toCodexWindow()` and add duration extraction and ordered slot assignment:

```ts
const WEEKLY_WINDOW_MINS = 7 * 24 * 60;

function codexWindowDuration(value: unknown): number | null {
  if (!value || typeof value !== "object") { return null; }
  const duration = (value as Record<string, unknown>).windowDurationMins;
  return typeof duration === "number" && duration > 0 ? duration : null;
}

function assignCodexWindow(
  slots: { session: QuotaWindow | null; weekly: QuotaWindow | null },
  value: unknown,
  legacySlot: "session" | "weekly",
): void {
  const window = toCodexWindow(value);
  if (!window) { return; }
  const duration = codexWindowDuration(value);
  const slot = duration === null
    ? legacySlot
    : duration >= WEEKLY_WINDOW_MINS ? "weekly" : "session";
  if (slots[slot] === null) { slots[slot] = window; }
}
```

Replace positional conversion in `quotaFromCodexRateLimits()` with:

```ts
const slots = { session: null, weekly: null } as {
  session: QuotaWindow | null;
  weekly: QuotaWindow | null;
};
assignCodexWindow(slots, snapshot.primary, "session");
assignCodexWindow(slots, snapshot.secondary, "weekly");
return {
  updatedAt,
  ...slots,
  planDetected: slots.session !== null || slots.weekly !== null,
};
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `pnpm exec tsc --outDir out && node --test tests/codexProvider.test.mjs`

Expected: all Codex provider tests PASS.

- [ ] **Step 5: Commit normalization**

```bash
git add src/quota/model.ts tests/codexProvider.test.mjs
git commit -m "fix: classify Codex quota windows by duration"
```

### Task 2: Availability-driven UI rows

**Files:**
- Modify: `src/ui/popoverState.ts`
- Modify: `src/ui/popoverRenderer.ts`
- Modify: `src/ui/trayState.ts`
- Modify: `src/ui/trayCapture.ts`
- Modify: `tests/popoverState.test.mjs`
- Modify: `tests/trayState.test.mjs`

**Interfaces:**
- Consumes: normalized `Quota` and `TrayDisplayState` values whose absent windows are `null`.
- Produces: `availableQuotaRows(quota: Quota): QuotaRow[]` and `trayWindowVisibility(display: TrayDisplayState): { session: boolean; weekly: boolean }`.

- [ ] **Step 1: Write failing pure presentation tests**

In `tests/popoverState.test.mjs`, import `availableQuotaRows` and add:

```js
test("quota rows include only available normalized windows", () => {
  const weeklyOnly = { updatedAt: 100, session: null, weekly: { usedPct: 31, resetsAt: 900 }, planDetected: true };
  assert.deepEqual(availableQuotaRows(weeklyOnly).map((row) => row.label), ["7D"]);
  const both = { ...weeklyOnly, session: { usedPct: 12, resetsAt: 200 } };
  assert.deepEqual(availableQuotaRows(both).map((row) => row.label), ["5H", "7D"]);
});
```

In `tests/trayState.test.mjs`, import `trayWindowVisibility` and add:

```js
test("tray visibility follows available normalized windows", () => {
  assert.deepEqual(trayWindowVisibility({
    provider: "codex", session: null, weekly: 31, loading: false, unavailable: false,
  }), { session: false, weekly: true });
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm exec tsc --outDir out && node --test tests/popoverState.test.mjs tests/trayState.test.mjs`

Expected: TypeScript compilation FAILS because the two helper exports do not exist.

- [ ] **Step 3: Add pure availability helpers**

In `src/ui/popoverState.ts`, import `Quota` and `QuotaWindow`, then add:

```ts
export interface QuotaRow {
  label: "5H" | "7D";
  window: QuotaWindow;
}

export function availableQuotaRows(quota: Quota): QuotaRow[] {
  const rows: QuotaRow[] = [];
  if (quota.session) { rows.push({ label: "5H", window: quota.session }); }
  if (quota.weekly) { rows.push({ label: "7D", window: quota.weekly }); }
  return rows;
}
```

In `src/ui/trayState.ts`, add:

```ts
export function trayWindowVisibility(display: TrayDisplayState): {
  session: boolean;
  weekly: boolean;
} {
  return { session: display.session !== null, weekly: display.weekly !== null };
}
```

- [ ] **Step 4: Make both renderers consume availability**

In `src/ui/popoverRenderer.ts`, import `availableQuotaRows` and replace the two unconditional `rowHtml()` calls with:

```ts
const body = quota
  ? availableQuotaRows(quota)
      .map((row) => rowHtml(row.label, row.window, payload.nowSec, payload.preferences.resetMode))
      .join("")
    + `<div class="updated">${updatedAgo(quota.updatedAt, payload.nowSec)}</div>`
  : `<div class="unavailable">${unavailableMessage(provider, state)}</div>`;
```

In `src/ui/trayCapture.ts`, import `trayWindowVisibility`, pass its booleans to `window.__render`, and show each group only when its boolean is true:

```js
window.__render = function(provider, s, w, showSession, showWeekly, dark, loading, unavailable) {
  // existing setup and state reset
  if (unavailable) {
    una.style.display = 'inline-flex';
  } else if (loading) {
    ld.style.display = 'inline-flex';
  } else {
    if (showSession) { grp5.style.display = 'inline-flex'; seg('fs', 'ps', s); }
    if (showWeekly) { grp7.style.display = 'inline-flex'; seg('fw', 'pw', w); }
  }
  return Math.ceil(row.getBoundingClientRect().width);
};
```

Compute `const visibility = trayWindowVisibility(display)` in `renderTray()` and include both booleans in the `executeJavaScript()` argument list.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `pnpm exec tsc --outDir out && node --test tests/popoverState.test.mjs tests/trayState.test.mjs`

Expected: all popover and tray state tests PASS.

- [ ] **Step 6: Commit presentation changes**

```bash
git add src/ui/popoverState.ts src/ui/popoverRenderer.ts src/ui/trayState.ts src/ui/trayCapture.ts tests/popoverState.test.mjs tests/trayState.test.mjs
git commit -m "fix: render only available quota windows"
```

### Task 3: Documentation and full verification

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: completed normalization and presentation behavior.
- Produces: accurate user-facing feature documentation and verification evidence.

- [ ] **Step 1: Update feature wording**

Replace the first feature bullet with:

```md
- Claude 5-hour/session and 7-day/weekly quota bars, plus the quota windows
  currently reported by Codex
```

- [ ] **Step 2: Run complete verification**

Run: `pnpm test`

Expected: all unit tests PASS with zero failures.

Run: `pnpm run typecheck`

Expected: exit 0 with no TypeScript errors.

Run: `pnpm run compile`

Expected: exit 0 with no bundle errors.

Run: `git diff --check`

Expected: exit 0 with no whitespace errors.

- [ ] **Step 3: Review requirements and diff**

Run: `git diff -- README.md src/quota/model.ts src/ui/popoverState.ts src/ui/popoverRenderer.ts src/ui/trayState.ts src/ui/trayCapture.ts tests/codexProvider.test.mjs tests/popoverState.test.mjs tests/trayState.test.mjs`

Confirm the diff implements every global constraint and contains no polling, cache, preference, color, or reset-format change.

- [ ] **Step 4: Commit documentation**

```bash
git add README.md
git commit -m "docs: describe dynamic Codex quota windows"
```
