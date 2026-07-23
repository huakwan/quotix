import assert from "node:assert/strict";
import test from "node:test";

import {
  canActivateUpdateAction,
  quotaRowsForProvider,
  sectionsForPayload,
  showMenuBarSetting,
  updatePresentation,
} from "../out/src/ui/popoverState.js";

const missing = { enabled: false, loading: false, result: { ok: false, reason: "missing" }, lastGood: null };
const quota = { updatedAt: 100, session: null, weekly: null, planDetected: false };

test("download accepts only mouse clicks while other update actions allow keyboard activation", () => {
  assert.equal(canActivateUpdateAction("download", 0), false);
  assert.equal(canActivateUpdateAction("download", 1), true);
  assert.equal(canActivateUpdateAction("install", 0), true);
  assert.equal(canActivateUpdateAction("cancel", 0), true);
  assert.equal(canActivateUpdateAction("retry", 0), true);
});

function payload(source) {
  return {
    preferences: { source, menuBarSource: "claude", resetMode: "countdown" },
    snapshot: {
      claude: { enabled: true, loading: false, result: { ok: true, quota }, lastGood: quota },
      codex: { ...missing, enabled: source !== "claude", result: { ok: false, reason: "missing", error: "no cli" } },
    },
    nowSec: 120,
  };
}

test("both returns stable Claude then Codex sections", () => {
  const sections = sectionsForPayload(payload("both"));
  assert.deepEqual(sections.map((section) => section.provider), ["claude", "codex"]);
  assert.equal(sections[0].name, "Claude Code");
  assert.equal(sections[1].name, "Codex OpenAI");
  assert.equal(sections[1].state.result.error, "no cli");
});

test("single source returns only its section", () => {
  assert.deepEqual(sectionsForPayload(payload("claude")).map((s) => s.provider), ["claude"]);
  assert.deepEqual(sectionsForPayload(payload("codex")).map((s) => s.provider), ["codex"]);
});

test("menu-bar setting is visible only for both", () => {
  assert.equal(showMenuBarSetting(payload("both").preferences), true);
  assert.equal(showMenuBarSetting(payload("claude").preferences), false);
  assert.equal(showMenuBarSetting(payload("codex").preferences), false);
});

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

test("active per-model weekly quotas append extra rows", () => {
  const withFable = {
    updatedAt: 100,
    session: { usedPct: 12, resetsAt: 200 },
    weekly: { usedPct: 34, resetsAt: 400 },
    weeklyModels: [{ model: "Fable", window: { usedPct: 5, resetsAt: 400 } }],
    planDetected: true,
  };
  const rows = quotaRowsForProvider("claude", withFable);
  assert.deepEqual(rows.map((row) => row.label), ["5H", "7D", "FA"]);
  assert.deepEqual(rows[2].window, { usedPct: 5, resetsAt: 400 });
  assert.equal(rows[2].periodSeconds, 7 * 24 * 3600);
});

test("inactive per-model weekly quota still appends a row with a null window", () => {
  const inactive = {
    updatedAt: 100,
    session: { usedPct: 12, resetsAt: 200 },
    weekly: { usedPct: 34, resetsAt: 400 },
    weeklyModels: [{ model: "Fable", window: null }],
    planDetected: true,
  };
  const rows = quotaRowsForProvider("claude", inactive);
  assert.deepEqual(rows.map((row) => row.label), ["5H", "7D", "FA"]);
  assert.equal(rows[2].window, null);
});

test("update presentation maps state to fixed safe actions", () => {
  assert.deepEqual(updatePresentation({ status: "idle" }), {
    visible: false, label: "", action: null, actionLabel: "", progress: null,
  });
  assert.deepEqual(updatePresentation({ status: "checking" }), {
    visible: false, label: "", action: null, actionLabel: "", progress: null,
  });
  assert.deepEqual(updatePresentation({ status: "up-to-date", version: "1.0.6" }), {
    visible: false, label: "", action: null, actionLabel: "", progress: null,
  });
  assert.deepEqual(updatePresentation({ status: "available", version: "1.0.7" }), {
    visible: true,
    label: "Version 1.0.7 is available",
    action: "download",
    actionLabel: "Update",
    progress: null,
  });
  assert.equal(updatePresentation({ status: "downloading", version: "1.0.7", progress: 150 }).progress, 100);
  assert.equal(updatePresentation({ status: "ready", version: "1.0.7" }).action, "install");
  assert.equal(updatePresentation({ status: "fallback", version: "1.0.7" }).action, "reveal");
  assert.equal(updatePresentation({ status: "error", error: "Unable to update." }).action, "retry");
});
