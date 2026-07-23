import { constants } from "node:fs";
import { access, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export interface InstallPathDeps {
  realpath(path: string): Promise<string>;
  access(path: string, mode?: number): Promise<void>;
}

export type InstallPathResult =
  | { eligible: true; bundlePath: string }
  | { eligible: false; reason: string };

const defaultDeps: InstallPathDeps = { realpath, access };

export function isContainedPath(root: string, candidate: string): boolean {
  const normalizedRoot = resolve(root);
  const normalizedCandidate = resolve(candidate);
  const rel = relative(normalizedRoot, normalizedCandidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

export async function resolveInstalledBundle(
  execPath: string,
  deps: InstallPathDeps = defaultDeps,
): Promise<InstallPathResult> {
  const match = /^(.*\/Quotix\.app)\/Contents\/MacOS\/[^/]+$/.exec(execPath);
  if (!match) { return { eligible: false, reason: "not_installed_app" }; }
  const bundlePath = resolve(match[1]);
  if (bundlePath === "/Volumes" || bundlePath.startsWith("/Volumes/")) {
    return { eligible: false, reason: "read_only_volume" };
  }
  try {
    const [canonicalBundle, canonicalParent] = await Promise.all([
      deps.realpath(bundlePath),
      deps.realpath(dirname(bundlePath)),
    ]);
    if (canonicalBundle !== bundlePath || canonicalParent !== dirname(bundlePath)) {
      return { eligible: false, reason: "symlinked_installation" };
    }
    await deps.access(canonicalParent, constants.W_OK);
    return { eligible: true, bundlePath };
  } catch {
    return { eligible: false, reason: "permission_denied" };
  }
}
