import assert from "node:assert/strict";
import test from "node:test";

import {
  asSources,
  asMenuBarSource,
  asOpenAtLogin,
  asResetMode,
  asShowPaceLine,
  asTrayIconColor,
} from "../out/src/preferenceInput.js";

test("sources accept a non-empty list of known providers in presentation order", () => {
  assert.deepEqual(asSources(["claude"]), ["claude"]);
  assert.deepEqual(asSources(["opencode", "claude"]), ["claude", "opencode"]);
  assert.deepEqual(asSources(["codex", "codex"]), ["codex"]);
  assert.deepEqual(asSources(["gemini", "codex"]), ["codex"]);
  assert.equal(asSources([]), null);
  assert.equal(asSources(["gemini"]), null);
  assert.equal(asSources("claude"), null);
  assert.equal(asSources("both"), null);
});

test("menu-bar source accepts only a single provider", () => {
  assert.equal(asMenuBarSource("claude"), "claude");
  assert.equal(asMenuBarSource("codex"), "codex");
  assert.equal(asMenuBarSource("opencode"), "opencode");
  assert.equal(asMenuBarSource("both"), null);
});

test("reset mode accepts only countdown or clock", () => {
  assert.equal(asResetMode("countdown"), "countdown");
  assert.equal(asResetMode("clock"), "clock");
  assert.equal(asResetMode("date"), null);
});

test("pace line accepts only booleans", () => {
  assert.equal(asShowPaceLine(true), true);
  assert.equal(asShowPaceLine(false), false);
  assert.equal(asShowPaceLine("on"), null);
  assert.equal(asShowPaceLine(1), null);
});

test("tray icon color accepts only auto, light, or dark", () => {
  assert.equal(asTrayIconColor("auto"), "auto");
  assert.equal(asTrayIconColor("light"), "light");
  assert.equal(asTrayIconColor("dark"), "dark");
  assert.equal(asTrayIconColor("system"), null);
  assert.equal(asTrayIconColor(true), null);
});

test("open at login accepts only booleans", () => {
  assert.equal(asOpenAtLogin(true), true);
  assert.equal(asOpenAtLogin(false), false);
  assert.equal(asOpenAtLogin("on"), null);
  assert.equal(asOpenAtLogin(1), null);
});
