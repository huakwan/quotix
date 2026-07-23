import assert from "node:assert/strict";
import test from "node:test";

import { removeVerifiedQuarantine } from "../out/src/update/installer.js";

test("installer never removes quarantine without consent", async () => {
  const calls = [];
  const result = await removeVerifiedQuarantine({
    stagingRoot: "/tmp/quotix/update-1",
    appPath: "/tmp/quotix/update-1/Quotix.app",
    confirm: async () => false,
    realpath: async (path) => path,
    execFile: async (...args) => { calls.push(args); },
  });
  assert.equal(result, false);
  assert.deepEqual(calls, []);
});

test("installer removes quarantine only from the exact contained verified app", async () => {
  const calls = [];
  const result = await removeVerifiedQuarantine({
    stagingRoot: "/tmp/quotix/update-1",
    appPath: "/tmp/quotix/update-1/Quotix.app",
    confirm: async () => true,
    realpath: async (path) => path,
    execFile: async (...args) => { calls.push(args); },
  });
  assert.equal(result, true);
  assert.deepEqual(calls, [[
    "/usr/bin/xattr",
    ["-dr", "com.apple.quarantine", "/tmp/quotix/update-1/Quotix.app"],
  ]]);
});

test("installer rejects changed or prefix-confused staging paths", async () => {
  for (const appPath of [
    "/tmp/quotix/update-1-evil/Quotix.app",
    "/tmp/quotix/update-1/../evil/Quotix.app",
  ]) {
    await assert.rejects(() => removeVerifiedQuarantine({
      stagingRoot: "/tmp/quotix/update-1",
      appPath,
      confirm: async () => true,
      realpath: async (path) => path,
      execFile: async () => undefined,
    }), { code: "install_path_changed" });
  }
});
