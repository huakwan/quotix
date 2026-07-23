import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  extractArchive,
  inspectArchive,
  validateArchiveEntries,
} from "../out/src/update/archive.js";

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

test("archive extraction compares links against the canonical staging root", async () => {
  const root = await mkdtemp(join(tmpdir(), "quotix-archive-links-"));
  const aliasRoot = `${root}-alias`;
  await symlink(root, aliasRoot, "dir");
  const appPath = join(root, "source", "Quotix.app");
  const versions = join(appPath, "Contents", "Frameworks", "Safe.framework", "Versions");
  await mkdir(join(versions, "A"), { recursive: true });
  await symlink("A", join(versions, "Current"));
  const archive = join(root, "contained.zip");
  execFileSync("/usr/bin/ditto", ["-c", "-k", "--keepParent", appPath, archive]);

  await mkdir(join(root, "extracted"));
  assert.equal(
    await extractArchive(archive, join(aliasRoot, "extracted")),
    join(aliasRoot, "extracted", "Quotix.app"),
  );
});

test("archive extraction rejects a link that resolves outside the app", async () => {
  const root = await mkdtemp(join(tmpdir(), "quotix-archive-escape-"));
  const appPath = join(root, "source", "Quotix.app");
  await mkdir(join(appPath, "Contents"), { recursive: true });
  await symlink("../../outside", join(appPath, "Contents", "escape"));
  const archive = join(root, "escape.zip");
  execFileSync("/usr/bin/ditto", ["-c", "-k", "--keepParent", appPath, archive]);
  await mkdir(join(root, "extracted"));

  await assert.rejects(
    extractArchive(archive, join(root, "extracted")),
    { code: "archive_unsafe" },
  );
});
