import assert from "node:assert/strict";
import test from "node:test";

import { asDisplaySource, asMenuBarSource, asResetMode, asShowPaceLine } from "../out/src/preferenceInput.js";

test("display source accepts only Claude, Codex, or Both", () => {
  assert.equal(asDisplaySource("claude"), "claude");
  assert.equal(asDisplaySource("codex"), "codex");
  assert.equal(asDisplaySource("both"), "both");
  assert.equal(asDisplaySource("all"), null);
  assert.equal(asDisplaySource(1), null);
});

test("menu-bar source accepts only a single provider", () => {
  assert.equal(asMenuBarSource("claude"), "claude");
  assert.equal(asMenuBarSource("codex"), "codex");
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
