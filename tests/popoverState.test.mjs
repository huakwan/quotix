import assert from "node:assert/strict";
import test from "node:test";

import { availableQuotaRows, sectionsForPayload, showMenuBarSetting } from "../out/src/ui/popoverState.js";

const missing = { enabled: false, loading: false, result: { ok: false, reason: "missing" }, lastGood: null };
const quota = { updatedAt: 100, session: null, weekly: null, planDetected: false };

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
  assert.equal(sections[1].name, "Codex");
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

test("quota rows include only available normalized windows", () => {
  const weeklyOnly = {
    updatedAt: 100,
    session: null,
    weekly: { usedPct: 31, resetsAt: 900 },
    planDetected: true,
  };
  assert.deepEqual(availableQuotaRows(weeklyOnly).map((row) => row.label), ["7D"]);
  const both = { ...weeklyOnly, session: { usedPct: 12, resetsAt: 200 } };
  assert.deepEqual(availableQuotaRows(both).map((row) => row.label), ["5H", "7D"]);
});
