import { createHash } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { UpdateError } from "./model";
import { MAX_UPDATE_BYTES } from "./manifest";

const TRUSTED_HOSTS = new Set([
  "github.com",
  "release-assets.githubusercontent.com",
  "objects.githubusercontent.com",
]);

export interface DownloadOptions {
  url: string;
  size: number;
  sha256: string;
  directory: string;
  filename: string;
  fetchImpl: typeof fetch;
  signal?: AbortSignal;
  onProgress?: (percentage: number) => void;
}

function trustedUrl(value: string | URL): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UpdateError("download_url_untrusted");
  }
  if (
    url.protocol !== "https:"
    || !TRUSTED_HOSTS.has(url.hostname)
    || url.username
    || url.password
  ) {
    throw new UpdateError("download_url_untrusted");
  }
  return url;
}

async function responseWithRedirects(options: DownloadOptions): Promise<Response> {
  let url = trustedUrl(options.url);
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    if (options.signal?.aborted) { throw new UpdateError("download_cancelled"); }
    let response: Response;
    try {
      response = await options.fetchImpl(url, {
        redirect: "manual",
        signal: options.signal,
        headers: { "User-Agent": "Quotix updater" },
      });
    } catch {
      if (options.signal?.aborted) { throw new UpdateError("download_cancelled"); }
      throw new UpdateError("download_failed");
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirects === 5) { throw new UpdateError("download_redirect_limit"); }
      const location = response.headers.get("location");
      if (!location) { throw new UpdateError("download_failed"); }
      url = trustedUrl(new URL(location, url));
      continue;
    }
    if (!response.ok || !response.body) { throw new UpdateError("download_failed"); }
    return response;
  }
  throw new UpdateError("download_redirect_limit");
}

export async function downloadAsset(options: DownloadOptions): Promise<string> {
  if (
    !Number.isSafeInteger(options.size)
    || options.size <= 0
    || options.size > MAX_UPDATE_BYTES
    || !/^[a-f0-9]{64}$/.test(options.sha256)
    || !/^[A-Za-z0-9._-]+\.zip$/.test(options.filename)
  ) {
    throw new UpdateError("download_invalid");
  }
  await mkdir(options.directory, { recursive: true, mode: 0o700 });
  const partialPath = join(options.directory, `${options.filename}.partial`);
  const finalPath = join(options.directory, options.filename);
  await rm(partialPath, { force: true });
  let handle;
  try {
    if (options.signal?.aborted) { throw new UpdateError("download_cancelled"); }
    const response = await responseWithRedirects(options);
    const declaredText = response.headers.get("content-length");
    if (declaredText !== null) {
      const declared = Number(declaredText);
      if (!Number.isSafeInteger(declared) || declared !== options.size) {
        throw new UpdateError("download_size_mismatch");
      }
    }
    handle = await open(partialPath, "wx", 0o600);
    const reader = response.body!.getReader();
    const hash = createHash("sha256");
    let received = 0;
    for (;;) {
      if (options.signal?.aborted) {
        await reader.cancel();
        throw new UpdateError("download_cancelled");
      }
      const { done, value } = await reader.read();
      if (done) { break; }
      received += value.byteLength;
      if (received > options.size) { throw new UpdateError("download_too_large"); }
      hash.update(value);
      let offset = 0;
      while (offset < value.byteLength) {
        const { bytesWritten } = await handle.write(
          value,
          offset,
          value.byteLength - offset,
          null,
        );
        if (bytesWritten <= 0) { throw new UpdateError("download_failed"); }
        offset += bytesWritten;
      }
      options.onProgress?.(Math.min(100, (received / options.size) * 100));
    }
    if (received !== options.size) { throw new UpdateError("download_size_mismatch"); }
    if (hash.digest("hex") !== options.sha256) {
      throw new UpdateError("download_checksum_mismatch");
    }
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(partialPath, finalPath);
    options.onProgress?.(100);
    return finalPath;
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(partialPath, { force: true }).catch(() => undefined);
    if (error instanceof UpdateError) { throw error; }
    if (options.signal?.aborted) { throw new UpdateError("download_cancelled"); }
    throw new UpdateError("download_failed");
  }
}
