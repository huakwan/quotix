import assert from "node:assert/strict";
import test from "node:test";

import { validateBundleMetadata } from "../out/src/update/bundleValidator.js";

const info = {
  CFBundleIdentifier: "com.huakwan.quotix",
  CFBundleName: "Quotix",
  CFBundleShortVersionString: "1.0.7",
  CFBundleExecutable: "Quotix",
};

test("bundle validator accepts exact identity, version, and CPU", () => {
  assert.deepEqual(validateBundleMetadata(info, ["arm64"], [], {
    version: "1.0.7",
    arch: "arm64",
  }), { executable: "Quotix" });
});

test("bundle validator rejects identity, version, nested apps, and architecture mismatch", () => {
  const cases = [
    [{ ...info, CFBundleIdentifier: "evil.app" }, ["arm64"], []],
    [{ ...info, CFBundleName: "Other" }, ["arm64"], []],
    [{ ...info, CFBundleShortVersionString: "1.0.8" }, ["arm64"], []],
    [{ ...info, CFBundleExecutable: "" }, ["arm64"], []],
    [info, ["x86_64"], []],
    [info, ["arm64", "x86_64"], []],
    [info, ["arm64"], ["Nested.app"]],
  ];
  for (const [candidate, archs, nested] of cases) {
    assert.throws(() => validateBundleMetadata(candidate, archs, nested, {
      version: "1.0.7",
      arch: "arm64",
    }), { code: "bundle_invalid" });
  }
});
