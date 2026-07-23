import assert from "node:assert/strict";
import test from "node:test";

import {
  compareVersions,
  parseAppVersion,
  parseReleaseTag,
} from "../out/src/update/version.js";

test("update version parses strict app versions and release tags", () => {
  assert.deepEqual(parseAppVersion("1.2.3"), {
    major: 1n,
    minor: 2n,
    patch: 3n,
    value: "1.2.3",
  });
  assert.deepEqual(parseReleaseTag("v1.2.3"), {
    major: 1n,
    minor: 2n,
    patch: 3n,
    value: "1.2.3",
  });
  assert.equal(parseAppVersion("v1.2.3"), null);
  assert.equal(parseReleaseTag("1.2.3"), null);
});

test("update version rejects ambiguous or non-stable versions", () => {
  for (const value of [
    "",
    "1.2",
    "1.2.3.4",
    "01.2.3",
    "1.02.3",
    "1.2.03",
    "1.2.3-beta.1",
    "1.2.3+build",
    "-1.2.3",
    " 1.2.3",
    "1.2.3 ",
  ]) {
    assert.equal(parseAppVersion(value), null, value);
  }
});

test("update version compares numeric components without precision loss", () => {
  const huge = parseAppVersion("900719925474099300000.0.0");
  const smaller = parseAppVersion("900719925474099299999.999.999");
  const equal = parseAppVersion("900719925474099300000.0.0");
  assert.ok(huge && smaller && equal);
  assert.equal(compareVersions(huge, smaller), 1);
  assert.equal(compareVersions(smaller, huge), -1);
  assert.equal(compareVersions(huge, equal), 0);
});
