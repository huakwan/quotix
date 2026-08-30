import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PREFERENCES,
  effectiveMenuBarSource,
  loadPreferences,
  savePreferences,
} from "../out/src/preferences.js";

test("preferences default to every source with Claude in the menu bar", () => {
  assert.deepEqual(loadPreferences("/data", { readFile: () => { throw new Error("missing"); } }), {
    sources: ["claude", "codex", "opencode"],
    menuBarSource: "claude",
    resetMode: "countdown",
    showPaceLine: true,
    openAtLogin: false,
  });
});

test("a multi-source selection survives a reload in presentation order", () => {
  const stored = JSON.stringify({ sources: ["opencode", "claude"], menuBarSource: "opencode" });
  const prefs = loadPreferences("/data", { readFile: () => stored });
  assert.deepEqual(prefs.sources, ["claude", "opencode"]);
  assert.equal(prefs.menuBarSource, "opencode");
  assert.equal(effectiveMenuBarSource(prefs), "opencode");
});

test("a legacy single source migrates to a one-entry list", () => {
  const prefs = loadPreferences("/data", {
    readFile: () => JSON.stringify({ source: "opencode", menuBarSource: "opencode" }),
  });
  assert.deepEqual(prefs.sources, ["opencode"]);
});

test("the legacy both value migrates to every source", () => {
  const prefs = loadPreferences("/data", { readFile: () => JSON.stringify({ source: "both" }) });
  assert.deepEqual(prefs.sources, ["claude", "codex", "opencode"]);
});

test("invalid preference fields fall back independently", () => {
  const prefs = loadPreferences("/data", {
    readFile: () => JSON.stringify({ sources: ["gemini"], menuBarSource: "codex", resetMode: "clock" }),
  });
  assert.deepEqual(prefs, {
    sources: ["claude", "codex", "opencode"],
    menuBarSource: "codex",
    resetMode: "clock",
    showPaceLine: true,
    openAtLogin: false,
  });
});

test("pace line honors a stored boolean and falls back on bad input", () => {
  assert.equal(loadPreferences("/data", {
    readFile: () => JSON.stringify({ showPaceLine: false }),
  }).showPaceLine, false);
  assert.equal(loadPreferences("/data", {
    readFile: () => JSON.stringify({ showPaceLine: "yes" }),
  }).showPaceLine, true);
});

test("open at login honors a stored boolean and falls back on bad input", () => {
  assert.equal(loadPreferences("/data", {
    readFile: () => JSON.stringify({ openAtLogin: true }),
  }).openAtLogin, true);
  assert.equal(loadPreferences("/data", {
    readFile: () => JSON.stringify({ openAtLogin: "yes" }),
  }).openAtLogin, false);
});

test("a disabled menu-bar source falls back to the first enabled one", () => {
  assert.equal(effectiveMenuBarSource({ ...DEFAULT_PREFERENCES, sources: ["codex"] }), "codex");
  assert.equal(
    effectiveMenuBarSource({ ...DEFAULT_PREFERENCES, sources: ["claude", "opencode"], menuBarSource: "codex" }),
    "claude",
  );
  assert.equal(
    effectiveMenuBarSource({ ...DEFAULT_PREFERENCES, sources: ["claude", "codex"], menuBarSource: "codex" }),
    "codex",
  );
});

test("preferences save to the user-data directory", () => {
  let writtenPath = "";
  let written = "";
  savePreferences("/data", { ...DEFAULT_PREFERENCES, resetMode: "clock" }, {
    writeFile: (path, value) => { writtenPath = path; written = value; },
  });
  assert.equal(writtenPath, "/data/quotix-preferences.json");
  assert.equal(JSON.parse(written).resetMode, "clock");
});
