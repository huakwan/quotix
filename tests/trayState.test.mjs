import assert from "node:assert/strict";
import test from "node:test";

import { trayDisplayState, trayWindowPresentation, trayWindowVisibility } from "../out/src/ui/trayState.js";

const quota = {
  updatedAt: 100,
  session: { usedPct: 12, resetsAt: 200 },
  weekly: { usedPct: 34, resetsAt: 400 },
  planDetected: true,
};

test("tray selector carries provider identity and good percentages", () => {
  assert.deepEqual(trayDisplayState("codex", {
    enabled: true, loading: false, result: { ok: true, quota }, lastGood: quota,
  }), {
    provider: "codex", session: 12, weekly: 34, loading: false, unavailable: false,
  });
});

test("tray selector keeps last-good data through a diagnostic", () => {
  const state = trayDisplayState("claude", {
    enabled: true, loading: false,
    result: { ok: true, quota, diagnostic: "offline" }, lastGood: quota,
  });
  assert.equal(state.session, 12);
  assert.equal(state.unavailable, false);
});

test("tray selector distinguishes loading and unavailable", () => {
  const loading = trayDisplayState("codex", {
    enabled: true, loading: true, result: { ok: false, reason: "missing" }, lastGood: null,
  });
  assert.equal(loading.loading, true);
  assert.equal(loading.unavailable, false);
  const missing = trayDisplayState("codex", {
    enabled: true, loading: false, result: { ok: false, reason: "missing" }, lastGood: null,
  });
  assert.equal(missing.unavailable, true);
});

test("tray visibility keeps both Claude windows but filters missing Codex windows", () => {
  const weeklyOnly = {
    provider: "codex",
    session: null,
    weekly: 31,
    loading: false,
    unavailable: false,
  };
  assert.deepEqual(trayWindowVisibility({ ...weeklyOnly, provider: "claude" }), {
    session: true,
    weekly: true,
  });
  assert.deepEqual(trayWindowVisibility(weeklyOnly), {
    session: false,
    weekly: true,
  });
});

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
