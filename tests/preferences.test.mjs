import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PREFERENCES,
  effectiveMenuBarSource,
  loadPreferences,
  savePreferences,
} from "../out/src/preferences.js";

test("preferences default to both with Claude in the menu bar", () => {
  assert.deepEqual(loadPreferences("/data", { readFile: () => { throw new Error("missing"); } }), {
    source: "both",
    menuBarSource: "claude",
    resetMode: "countdown",
    showPaceLine: true,
    openAtLogin: false,
  });
});

test("invalid preference fields fall back independently", () => {
  const prefs = loadPreferences("/data", {
    readFile: () => JSON.stringify({ source: "bad", menuBarSource: "codex", resetMode: "clock" }),
  });
  assert.deepEqual(prefs, {
    source: "both",
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

test("single source overrides the persisted menu-bar source", () => {
  assert.equal(effectiveMenuBarSource({ ...DEFAULT_PREFERENCES, source: "codex" }), "codex");
  assert.equal(effectiveMenuBarSource({ ...DEFAULT_PREFERENCES, source: "claude", menuBarSource: "codex" }), "claude");
  assert.equal(effectiveMenuBarSource({ ...DEFAULT_PREFERENCES, source: "both", menuBarSource: "codex" }), "codex");
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
