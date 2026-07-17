# Updated Ago Seconds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display exact elapsed seconds from 6 through 59 seconds while keeping `Updated just now` through 5 seconds.

**Architecture:** Keep the behavior inside the existing `updatedAgo(updatedAt, nowSec)` formatter in `src/ui/popoverRenderer.ts`. Add a focused source-level behavior test that extracts and evaluates that formatter without loading the renderer's browser-only startup code.

**Tech Stack:** TypeScript 6, Node.js test runner, Node.js `vm`

## Global Constraints

- Ages from 0 through 5 seconds display `Updated just now`.
- Ages from 6 through 59 seconds display `Updated x sec ago`.
- Ages of 60 seconds or more retain the existing formatting.
- Future timestamps remain clamped to 0 seconds.
- Preserve unrelated working-tree edits in `src/ui/popoverRenderer.ts`.

---

### Task 1: Recent Updated-Age Formatting

**Files:**
- Create: `tests/popoverRenderer.test.mjs`
- Modify: `src/ui/popoverRenderer.ts:57-62`

**Interfaces:**
- Consumes: `updatedAgo(updatedAt: number, nowSec: number): string`
- Produces: Display strings for recent timestamps; no new exported interface

- [ ] **Step 1: Write the failing boundary test**

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadUpdatedAgo() {
  const renderer = readFileSync(join(root, "src/ui/popoverRenderer.ts"), "utf8");
  const source = renderer.match(/function updatedAgo[\s\S]*?\n}/)?.[0];
  assert.ok(source, "updatedAgo function should exist");
  const javascript = source.replaceAll(": number", "").replace(": string", "");
  return runInNewContext(`(${javascript})`);
}

test("updated age uses seconds only after five seconds and before one minute", () => {
  const updatedAgo = loadUpdatedAgo();

  assert.equal(updatedAgo(100, 95), "Updated just now");
  assert.equal(updatedAgo(100, 105), "Updated just now");
  assert.equal(updatedAgo(100, 106), "Updated 6 sec ago");
  assert.equal(updatedAgo(100, 159), "Updated 59 sec ago");
  assert.equal(updatedAgo(100, 160), "Updated 1 min ago");
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/popoverRenderer.test.mjs`

Expected: FAIL at the 6-second assertion because the current result is `Updated just now`.

- [ ] **Step 3: Add the minimal seconds branches**

Change the beginning of `updatedAgo` to:

```ts
function updatedAgo(updatedAt: number, nowSec: number): string {
  const seconds = Math.max(0, nowSec - updatedAt);
  if (seconds <= 5) { return "Updated just now"; }
  if (seconds < 60) { return `Updated ${seconds} sec ago`; }
  const minutes = Math.floor(seconds / 60);
```

Keep all minute, hour, and day branches unchanged.

- [ ] **Step 4: Verify focused and full test suites GREEN**

Run: `node --test tests/popoverRenderer.test.mjs`

Expected: PASS with 1 passing test and 0 failures.

Run: `pnpm test`

Expected: TypeScript compilation succeeds and all Node.js tests pass with 0 failures.

- [ ] **Step 5: Review and commit only task-owned changes**

Run: `git diff --check`

Expected: no output.

Stage `tests/popoverRenderer.test.mjs`. Interactively stage only the `updatedAgo` hunk from `src/ui/popoverRenderer.ts`; decline the pre-existing import-order and reset-date formatting hunks.

```bash
git add tests/popoverRenderer.test.mjs
git add -p src/ui/popoverRenderer.ts
git commit -m "feat: show seconds in recent update age"
```
