import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { extractArchive } from "./archive";
import { validateBundle } from "./bundleValidator";
import { downloadAsset } from "./downloader";
import type { StageHooks } from "./coordinator";
import type { AvailableRelease, UpdateArch, VerifiedUpdate } from "./model";

export async function stageUpdate(
  release: AvailableRelease,
  updatesRoot: string,
  arch: UpdateArch,
  hooks: StageHooks,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<VerifiedUpdate> {
  await mkdir(updatesRoot, { recursive: true, mode: 0o700 });
  const stagingRoot = await mkdtemp(join(updatesRoot, "update-"));
  try {
    const archivePath = await downloadAsset({
      ...release.asset,
      directory: stagingRoot,
      fetchImpl,
      signal,
      onProgress: hooks.progress,
    });
    hooks.verifying();
    const extractRoot = join(stagingRoot, "extracted");
    await mkdir(extractRoot, { mode: 0o700 });
    const appPath = await extractArchive(archivePath, extractRoot);
    await validateBundle(appPath, { version: release.version, arch });
    return { version: release.version, stagingRoot, appPath };
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}
