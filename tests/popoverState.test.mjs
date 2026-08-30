import { canActivateUpdateAction, diagnosticText, isQuotaRefreshInProgress, monthlyPeriodSeconds, quotaRowsForProvider, sectionsForPayload, selectedMenuBarSource, showMenuBarSetting, toggledSources, updatePresentation, } from "../out/src/ui/popover/popoverState.js";
import assert from "node:assert/strict";
import test from "node:test";

const missing = { enabled: false, loading: false, result: { ok: false, reason: "missing" }, lastGood: null };
const quota = { updatedAt: 100, session: null, weekly: null, monthly: null, planDetected: false };

test("download accepts only mouse clicks while other update actions allow keyboard activation", () => {
  assert.equal(canActivateUpdateAction("download", 0), false);
  assert.equal(canActivateUpdateAction("download", 1), true);
  assert.equal(canActivateUpdateAction("install", 0), true);
  assert.equal(canActivateUpdateAction("cancel", 0), true);
  assert.equal(canActivateUpdateAction("retry", 0), true);
});

function payload(...sources) {
  const enabled = (provider) => sources.includes(provider);
  return {
    preferences: { sources, menuBarSource: "claude", resetMode: "countdown" },
    snapshot: {
      claude: { enabled: enabled("claude"), loading: false, result: { ok: true, quota }, lastGood: quota },
      codex: {
        ...missing,
        enabled: enabled("codex"),
        result: { ok: false, reason: "missing", error: "no cli" },
      },
      opencode: {
        ...missing,
        enabled: enabled("opencode"),
        result: { ok: false, reason: "missing", error: "no key" },
      },
    },
    nowSec: 120,
  };
}

test("every source returns stable Claude, Codex, then OpenCode sections", () => {
  const sections = sectionsForPayload(payload("claude", "codex", "opencode"));
  assert.deepEqual(sections.map((section) => section.provider), ["claude", "codex", "opencode"]);
  assert.deepEqual(sections.map((section) => section.name), ["Claude Code", "Codex OpenAI", "OpenCode Go"]);
  assert.equal(sections[1].state.result.error, "no cli");
  assert.equal(sections[2].state.result.error, "no key");
});

test("single source returns only its section", () => {
  assert.deepEqual(sectionsForPayload(payload("claude")).map((s) => s.provider), ["claude"]);
  assert.deepEqual(sectionsForPayload(payload("codex")).map((s) => s.provider), ["codex"]);
  assert.deepEqual(sectionsForPayload(payload("opencode")).map((s) => s.provider), ["opencode"]);
});

test("menu-bar setting is visible only with more than one source", () => {
  assert.equal(showMenuBarSetting(payload("claude", "codex", "opencode").preferences), true);
  assert.equal(showMenuBarSetting(payload("claude", "codex").preferences), true);
  assert.equal(showMenuBarSetting(payload("claude").preferences), false);
  assert.equal(showMenuBarSetting(payload("codex").preferences), false);
});

test("menu-bar selection falls back when the stored source is disabled", () => {
  assert.equal(selectedMenuBarSource(payload("claude", "codex").preferences), "claude");
  assert.equal(selectedMenuBarSource(payload("codex", "opencode").preferences), "codex");
});

test("toggling adds in presentation order, removes, and refuses to empty the list", () => {
  assert.deepEqual(toggledSources(["claude"], "codex"), ["claude", "codex"]);
  assert.deepEqual(toggledSources(["opencode"], "claude"), ["claude", "opencode"]);
  assert.deepEqual(toggledSources(["claude", "codex"], "claude"), ["codex"]);
  assert.equal(toggledSources(["codex"], "codex"), null);
});

test("refresh progress follows only enabled source sections", () => {
  const both = payload("claude", "codex", "opencode");
  both.snapshot.codex.loading = true;
  assert.equal(isQuotaRefreshInProgress(both), true);

  const claudeOnly = payload("claude");
  claudeOnly.snapshot.codex.loading = true;
  assert.equal(isQuotaRefreshInProgress(claudeOnly), false);
  claudeOnly.snapshot.claude.loading = true;
  assert.equal(isQuotaRefreshInProgress(claudeOnly), true);
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

test("OpenCode Go always shows its three billing windows", () => {
  const rows = quotaRowsForProvider("opencode", {
    updatedAt: 100,
    session: { usedPct: 5, resetsAt: 300 },
    weekly: { usedPct: 6, resetsAt: 600 },
    monthly: { usedPct: 3, resetsAt: 900 },
    planDetected: true,
  });
  assert.deepEqual(rows.map((row) => row.label), ["5H", "7D", "1M"]);
  assert.deepEqual(rows.map((row) => row.window?.resetsAt), [300, 600, 900]);
  assert.equal(rows[2].periodSeconds, monthlyPeriodSeconds(900));
});

test("monthly period spans the real calendar month, not a fixed 30 days", () => {
  const localNoon = (year, month, day) => new Date(year, month, day, 12, 0, 0).getTime() / 1000;
  const days = (seconds) => Math.round(seconds / 86400);

  // The live case: an August 30 reset followed by a September 30 reset is a
  // 31-day window (August has 31 days); a fixed 30-day period under-reads it.
  assert.equal(days(monthlyPeriodSeconds(localNoon(2026, 8, 30))), 31);
  // Calendar-anchored inter-reset duration also covers short months: a March 30
  // reset after a 28-day February is a 30-day window, and a March 29 anchor
  // clamped into February's last day yields 29 days.
  assert.equal(days(monthlyPeriodSeconds(localNoon(2025, 2, 30))), 30);
  assert.equal(days(monthlyPeriodSeconds(localNoon(2025, 2, 29))), 29);
});

test("an absent OpenCode Go monthly window still renders its row", () => {
  const rows = quotaRowsForProvider("opencode", {
    updatedAt: 100,
    session: null,
    weekly: null,
    monthly: null,
    planDetected: false,
  });
  assert.deepEqual(rows.map((row) => row.label), ["5H", "7D", "1M"]);
  assert.deepEqual(rows.map((row) => row.window), [null, null, null]);
});

test("Claude and Codex never inherit the monthly row", () => {
  const windows = {
    updatedAt: 100,
    session: null,
    weekly: null,
    monthly: { usedPct: 3, resetsAt: 900 },
    planDetected: false,
  };
  assert.deepEqual(quotaRowsForProvider("claude", windows).map((row) => row.label), ["5H", "7D"]);
  assert.deepEqual(quotaRowsForProvider("codex", windows).map((row) => row.label), []);
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

test("diagnostic text collapses whitespace and passes short messages through", () => {
  assert.equal(diagnosticText("HTTP 429"), "HTTP 429");
  assert.equal(diagnosticText("  Network   error\n(TypeError) "), "Network error (TypeError)");
});

test("diagnostic text is capped so the tooltip cannot outgrow the popover", () => {
  const long = diagnosticText("x".repeat(400));
  assert.equal(long.length, 120);
  assert.ok(long.endsWith("…"));
});

test("diagnostic text does not truncate the credential messages the provider sends", () => {
  const messages = [
    "No Claude Code credentials in the Keychain. Sign in with the Claude Code CLI",
    "The Claude Code credential could not be parsed. Sign in with the Claude Code CLI",
    "Could not read the Claude Code credential from the Keychain",
    "The Claude Code access token expired. Run Claude Code to renew it",
    "Claude Code credentials are only readable on macOS",
  ];
  for (const message of messages) {
    assert.equal(diagnosticText(message), message);
  }
});
