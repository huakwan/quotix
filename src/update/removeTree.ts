import { rm } from "node:fs/promises";

// Electron patches `fs` so an `.asar` file reports as a directory. A recursive
// remove then descends into the archive instead of unlinking it, and the parent
// rmdir fails with ENOTEMPTY, stranding the app bundle it was told to delete.
// `original-fs` is Electron's unpatched filesystem, so it deletes the archive as
// the file it is. Toggling `process.noAsar` would work too, but it is global and
// would race the app's own reads out of app.asar. Plain Node runs (tests, and the
// helper when it is not launched through Electron) fall back to `node:fs`.
function resolveRemove(): (path: string) => Promise<void> {
  try {
    const originalFs = require("original-fs") as typeof import("node:fs");
    return (path) => originalFs.promises.rm(path, { recursive: true, force: true });
  } catch {
    return (path) => rm(path, { recursive: true, force: true });
  }
}

const remove = resolveRemove();

export function removeTree(path: string): Promise<void> {
  return remove(path);
}
