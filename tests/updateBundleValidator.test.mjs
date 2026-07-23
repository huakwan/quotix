import assert from "node:assert/strict";
import test from "node:test";

import {
  validateBundleMetadata,
  validateHelperBundleMetadata,
} from "../out/src/update/bundleValidator.js";

const info = {
  CFBundleIdentifier: "com.huakwan.quotix",
  CFBundleName: "Quotix",
  CFBundleShortVersionString: "1.0.7",
  CFBundleExecutable: "Quotix",
};

const helpers = [
  "Contents/Frameworks/Quotix Helper.app",
  "Contents/Frameworks/Quotix Helper (Renderer).app",
  "Contents/Frameworks/Quotix Helper (GPU).app",
  "Contents/Frameworks/Quotix Helper (Plugin).app",
];

const helperMetadata = [
  ["Quotix Helper", "com.huakwan.quotix.helper"],
  ["Quotix Helper (Renderer)", "com.huakwan.quotix.helper.Renderer"],
  ["Quotix Helper (GPU)", "com.huakwan.quotix.helper.GPU"],
  ["Quotix Helper (Plugin)", "com.huakwan.quotix.helper.Plugin"],
];

test("bundle validator accepts exact identity, version, and CPU", () => {
  assert.deepEqual(validateBundleMetadata(info, ["arm64"], helpers, {
    version: "1.0.7",
    arch: "arm64",
  }), { executable: "Quotix" });
});

test("bundle validator rejects identity, version, unexpected apps, and architecture mismatch", () => {
  const cases = [
    [{ ...info, CFBundleIdentifier: "evil.app" }, ["arm64"], helpers],
    [{ ...info, CFBundleName: "Other" }, ["arm64"], helpers],
    [{ ...info, CFBundleShortVersionString: "1.0.8" }, ["arm64"], helpers],
    [{ ...info, CFBundleExecutable: "" }, ["arm64"], helpers],
    [info, ["x86_64"], helpers],
    [info, ["arm64", "x86_64"], helpers],
    [info, ["arm64"], []],
    [info, ["arm64"], [...helpers, "Contents/Frameworks/Nested.app"]],
  ];
  for (const [candidate, archs, nested] of cases) {
    assert.throws(() => validateBundleMetadata(candidate, archs, nested, {
      version: "1.0.7",
      arch: "arm64",
    }), { code: "bundle_invalid" });
  }
});

test("bundle validator accepts only exact Electron helper identity, version, and CPU", () => {
  for (let index = 0; index < helpers.length; index += 1) {
    const [executable, identifier] = helperMetadata[index];
    assert.deepEqual(validateHelperBundleMetadata(
      helpers[index],
      {
        CFBundleIdentifier: identifier,
        CFBundleVersion: "1.0.7",
        CFBundleExecutable: executable,
      },
      ["arm64"],
      { version: "1.0.7", arch: "arm64" },
    ), { executable });
  }

  const helperInfo = {
    CFBundleIdentifier: "com.huakwan.quotix.helper.Renderer",
    CFBundleVersion: "1.0.7",
    CFBundleExecutable: "Quotix Helper (Renderer)",
  };
  for (const candidate of [
    { ...helperInfo, CFBundleIdentifier: "evil.helper" },
    { ...helperInfo, CFBundleVersion: "1.0.8" },
    { ...helperInfo, CFBundleExecutable: "Other" },
  ]) {
    assert.throws(() => validateHelperBundleMetadata(
      "Contents/Frameworks/Quotix Helper (Renderer).app",
      candidate,
      ["arm64"],
      { version: "1.0.7", arch: "arm64" },
    ), { code: "bundle_invalid" });
  }
  for (const architectures of [[], ["x86_64"], ["arm64", "x86_64"]]) {
    assert.throws(() => validateHelperBundleMetadata(
      "Contents/Frameworks/Quotix Helper (Renderer).app",
      helperInfo,
      architectures,
      { version: "1.0.7", arch: "arm64" },
    ), { code: "bundle_invalid" });
  }
});
