import type { Version } from "./model";

const CORE = "(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)";
const APP_VERSION = new RegExp(`^${CORE}$`);
const RELEASE_TAG = new RegExp(`^v${CORE}$`);

function parse(value: string, expression: RegExp): Version | null {
  const match = expression.exec(value);
  if (!match) { return null; }
  const normalized = `${match[1]}.${match[2]}.${match[3]}`;
  return {
    major: BigInt(match[1]),
    minor: BigInt(match[2]),
    patch: BigInt(match[3]),
    value: normalized,
  };
}

export function parseAppVersion(value: string): Version | null {
  return parse(value, APP_VERSION);
}

export function parseReleaseTag(value: string): Version | null {
  return parse(value, RELEASE_TAG);
}

export function compareVersions(left: Version, right: Version): -1 | 0 | 1 {
  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] < right[key]) { return -1; }
    if (left[key] > right[key]) { return 1; }
  }
  return 0;
}
