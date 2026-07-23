import assert from "node:assert/strict";
import test from "node:test";

import {
  readOpenAtLogin,
  syncOpenAtLogin,
  updateOpenAtLogin,
} from "../out/src/loginItem.js";

test("reads the operating system login-item state", () => {
  assert.equal(readOpenAtLogin({
    getLoginItemSettings: () => ({ openAtLogin: true }),
    setLoginItemSettings: () => {},
  }), true);
});

test("updates and returns the operating system login-item state", () => {
  let openAtLogin = false;
  const app = {
    getLoginItemSettings: () => ({ openAtLogin }),
    setLoginItemSettings: (settings) => { openAtLogin = settings.openAtLogin; },
  };

  assert.equal(updateOpenAtLogin(app, true), true);
  assert.equal(openAtLogin, true);
  assert.equal(updateOpenAtLogin(app, false), false);
  assert.equal(openAtLogin, false);
});

test("sync picks up a login item removed manually while the app is running", () => {
  let systemOpenAtLogin = true;
  const app = {
    getLoginItemSettings: () => ({ openAtLogin: systemOpenAtLogin }),
    setLoginItemSettings: () => {},
  };
  const current = { openAtLogin: true, source: "both" };

  assert.equal(syncOpenAtLogin(app, current), current);
  systemOpenAtLogin = false;
  assert.deepEqual(syncOpenAtLogin(app, current), {
    openAtLogin: false,
    source: "both",
  });
});

test("preserves the last known state when setting and reading both fail", () => {
  const unavailableApp = {
    getLoginItemSettings: () => { throw new Error("unavailable"); },
    setLoginItemSettings: () => { throw new Error("denied"); },
  };

  assert.equal(readOpenAtLogin(unavailableApp), false);
  assert.equal(readOpenAtLogin(unavailableApp, true), true);
  assert.equal(updateOpenAtLogin(unavailableApp, false, true), true);
});

test("preserves the last known state when verification fails after setting", () => {
  let requested;
  const unverifiableApp = {
    getLoginItemSettings: () => { throw new Error("unavailable"); },
    setLoginItemSettings: (settings) => { requested = settings.openAtLogin; },
  };

  assert.equal(updateOpenAtLogin(unverifiableApp, false, true), true);
  assert.equal(requested, false);
});
