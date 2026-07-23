import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { inspectArchive, validateArchiveEntries } from "../out/src/update/archive.js";

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

test("archive preflight rejects expanded bombs and special filesystem entries", () => {
  assert.throws(() => validateArchiveEntries([
    { name: "Quotix.app/", kind: "directory" },
    {
      name: "Quotix.app/Contents/huge",
      kind: "file",
      uncompressedSize: 1024 * 1024 * 1024 + 1,
    },
  ]), { code: "archive_unsafe" });
  assert.throws(() => validateArchiveEntries([
    { name: "Quotix.app/", kind: "directory" },
    { name: "Quotix.app/Contents/device", kind: "special" },
  ]), { code: "archive_unsafe" });
});

test("archive preflight accepts the exact ditto format produced by the release workflow", async () => {
  const root = await mkdtemp(join(tmpdir(), "quotix-release-archive-"));
  const appPath = join(root, "Quotix.app");
  const executable = join(appPath, "Contents", "MacOS", "Quotix");
  await mkdir(join(appPath, "Contents", "MacOS"), { recursive: true });
  await writeFile(executable, "fake executable", { mode: 0o755 });
  await writeFile(join(appPath, "Contents", "Info.plist"), "<plist/>");
  const archive = join(root, "Quotix.zip");
  execFileSync("/usr/bin/ditto", ["-c", "-k", "--keepParent", appPath, archive]);

  const entries = await inspectArchive(archive);
  assert.ok(entries.some((entry) => entry.name === "Quotix.app/Contents/MacOS/Quotix"));
  assert.equal(entries.some((entry) => entry.name.startsWith("__MACOSX/")), false);
});
