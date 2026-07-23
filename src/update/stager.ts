import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { extractArchive } from "./archive";
import { validateBundle } from "./bundleValidator";
import { downloadAsset } from "./downloader";
import type { StageHooks } from "./coordinator";
import type { AvailableRelease, UpdateArch, VerifiedUpdate } from "./model";
import { UpdateError } from "./model";

function assertNotCancelled(signal: AbortSignal): void {
  if (signal.aborted) { throw new UpdateError("download_cancelled"); }
}

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
    assertNotCancelled(signal);
    const archivePath = await downloadAsset({
      ...release.asset,
      directory: stagingRoot,
      fetchImpl,
      signal,
      onProgress: hooks.progress,
    });
    assertNotCancelled(signal);
    hooks.verifying();
    const extractRoot = join(stagingRoot, "extracted");
    await mkdir(extractRoot, { mode: 0o700 });
    const appPath = await extractArchive(archivePath, extractRoot);
    assertNotCancelled(signal);
    await validateBundle(appPath, { version: release.version, arch });
    assertNotCancelled(signal);
    await rm(archivePath, { force: true });
    return { version: release.version, stagingRoot, appPath };
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}
