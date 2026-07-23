import { execFile } from "node:child_process";
import { lstat, readdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, posix, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import yauzl, { type Entry, type ZipFile } from "yauzl";
import { UpdateError } from "./model";

const execFileAsync = promisify(execFile);

export interface ArchiveEntryInfo {
  name: string;
  symlinkTarget?: string;
}

function contained(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

export function validateArchiveEntries(entries: ArchiveEntryInfo[]): void {
  if (entries.length === 0) { throw new UpdateError("archive_unsafe"); }
  for (const entry of entries) {
    const name = entry.name;
    if (
      !name
      || name.includes("\\")
      || name.includes("\0")
      || name.startsWith("/")
      || posix.normalize(name) !== name.replace(/\/$/, "") + (name.endsWith("/") ? "/" : "")
      || !(name === "Quotix.app/" || name.startsWith("Quotix.app/"))
      || name.split("/").includes("..")
    ) {
      throw new UpdateError("archive_unsafe");
    }
    if (entry.symlinkTarget !== undefined) {
      const target = entry.symlinkTarget;
      if (
        !target
        || target.includes("\0")
        || target.includes("\\")
        || posix.isAbsolute(target)
        || target.split("/").includes("Quotix.app")
      ) {
        throw new UpdateError("archive_unsafe");
      }
      const resolved = posix.normalize(posix.join(posix.dirname(name), target));
      if (!(resolved === "Quotix.app" || resolved.startsWith("Quotix.app/"))) {
        throw new UpdateError("archive_unsafe");
      }
    }
  }
}

function openZip(path: string): Promise<ZipFile> {
  return new Promise((resolvePromise, reject) => {
    yauzl.open(path, { lazyEntries: true, decodeStrings: true }, (error, zip) => {
      if (error || !zip) { reject(new UpdateError("archive_invalid")); return; }
      resolvePromise(zip);
    });
  });
}

function entryStream(zip: ZipFile, entry: Entry): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) { reject(new UpdateError("archive_invalid")); return; }
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 4096) { stream.destroy(new Error("symlink too large")); return; }
        chunks.push(chunk);
      });
      stream.on("error", () => reject(new UpdateError("archive_invalid")));
      stream.on("end", () => resolvePromise(Buffer.concat(chunks)));
    });
  });
}

export async function inspectArchive(zipPath: string): Promise<ArchiveEntryInfo[]> {
  const zip = await openZip(zipPath);
  const entries: ArchiveEntryInfo[] = [];
  return new Promise((resolvePromise, reject) => {
    zip.on("error", () => reject(new UpdateError("archive_invalid")));
    zip.on("end", () => {
      try {
        validateArchiveEntries(entries);
        resolvePromise(entries);
      } catch (error) {
        reject(error);
      } finally {
        zip.close();
      }
    });
    zip.on("entry", async (entry: Entry) => {
      try {
        const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
        const isSymlink = (mode & 0o170000) === 0o120000;
        entries.push({
          name: entry.fileName,
          ...(isSymlink ? { symlinkTarget: (await entryStream(zip, entry)).toString("utf8") } : {}),
        });
        zip.readEntry();
      } catch (error) {
        zip.close();
        reject(error);
      }
    });
    zip.readEntry();
  });
}

async function verifyExtractedLinks(root: string, current = root): Promise<void> {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = resolve(current, entry.name);
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) {
      let target: string;
      try {
        target = await realpath(path);
      } catch {
        throw new UpdateError("archive_unsafe");
      }
      if (!contained(root, target)) { throw new UpdateError("archive_unsafe"); }
    } else if (stats.isDirectory()) {
      await verifyExtractedLinks(root, path);
    }
  }
}

export async function extractArchive(zipPath: string, stagingDir: string): Promise<string> {
  await inspectArchive(zipPath);
  try {
    await execFileAsync("/usr/bin/ditto", ["-x", "-k", zipPath, stagingDir], {
      maxBuffer: 1024 * 1024,
    });
    const appPath = resolve(stagingDir, "Quotix.app");
    if (!contained(resolve(stagingDir), appPath)) { throw new UpdateError("archive_unsafe"); }
    await verifyExtractedLinks(appPath);
    return appPath;
  } catch (error) {
    if (error instanceof UpdateError) { throw error; }
    throw new UpdateError("archive_extract_failed");
  }
}
