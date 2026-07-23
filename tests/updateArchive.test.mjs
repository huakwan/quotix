import assert from "node:assert/strict";
import test from "node:test";

import { validateArchiveEntries } from "../out/src/update/archive.js";

test("archive preflight accepts one contained Quotix app", () => {
  assert.doesNotThrow(() => validateArchiveEntries([
    { name: "Quotix.app/" },
    { name: "Quotix.app/Contents/" },
    { name: "Quotix.app/Contents/MacOS/Quotix" },
    { name: "Quotix.app/Contents/Frameworks/Current", symlinkTarget: "Versions/A" },
  ]));
});

test("archive preflight rejects traversal, absolute, sibling, and escaping links", () => {
  for (const entries of [
    [{ name: "/Quotix.app/Contents/MacOS/Quotix" }],
    [{ name: "Quotix.app/../evil" }],
    [{ name: "Other.app/Contents/MacOS/Other" }],
    [{ name: "Quotix.app/a" }, { name: "Second.app/b" }],
    [{ name: "Quotix.app/link", symlinkTarget: "/tmp/evil" }],
    [{ name: "Quotix.app/Contents/link", symlinkTarget: "../../../evil" }],
    [{ name: "Quotix.app/link", symlinkTarget: "Quotix.app/loop" }],
  ]) {
    assert.throws(() => validateArchiveEntries(entries), { code: "archive_unsafe" });
  }
});
