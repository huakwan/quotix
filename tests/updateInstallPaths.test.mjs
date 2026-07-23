import assert from "node:assert/strict";
import test from "node:test";

import { isContainedPath, resolveInstalledBundle } from "../out/src/update/installPaths.js";

test("install path accepts only canonical writable local Quotix app", async () => {
  const result = await resolveInstalledBundle(
    "/Applications/Quotix.app/Contents/MacOS/Quotix",
    {
      realpath: async (path) => path,
      access: async () => undefined,
    },
  );
  assert.deepEqual(result, { eligible: true, bundlePath: "/Applications/Quotix.app" });
});

test("install path rejects volumes, non-apps, symlinks, and unwritable parents", async () => {
  const cases = [
    ["/Volumes/Quotix/Quotix.app/Contents/MacOS/Quotix", {
      realpath: async (path) => path, access: async () => undefined,
    }],
    ["/Applications/Other.app/Contents/MacOS/Other", {
      realpath: async (path) => path, access: async () => undefined,
    }],
    ["/tmp/Quotix", {
      realpath: async (path) => path, access: async () => undefined,
    }],
    ["/Applications/Quotix.app/Contents/MacOS/Quotix", {
      realpath: async (path) => path.replace("/Applications", "/private/Applications"),
      access: async () => undefined,
    }],
    ["/Applications/Quotix.app/Contents/MacOS/Quotix", {
      realpath: async (path) => path,
      access: async () => { throw new Error("denied"); },
    }],
  ];
  for (const [execPath, deps] of cases) {
    assert.equal((await resolveInstalledBundle(execPath, deps)).eligible, false);
  }
});

test("contained paths enforce separator boundaries", () => {
  assert.equal(isContainedPath("/tmp/update-1", "/tmp/update-1/Quotix.app"), true);
  assert.equal(isContainedPath("/tmp/update-1", "/tmp/update-1-evil/Quotix.app"), false);
  assert.equal(isContainedPath("/tmp/update-1", "/tmp/update-1/../evil"), false);
});
