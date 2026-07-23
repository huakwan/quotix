import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { downloadAsset } from "../out/src/update/downloader.js";

const body = Buffer.from("verified update bytes");
const sha256 = createHash("sha256").update(body).digest("hex");

test("update downloader streams, verifies, reports progress, and atomically finishes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "quotix-download-"));
  const progress = [];
  const output = await downloadAsset({
    url: "https://github.com/huakwan/quotix/releases/download/v1.0.7/Quotix.zip",
    size: body.length,
    sha256,
    directory: dir,
    filename: "Quotix.zip",
    fetchImpl: async () => new Response(body, {
      status: 200,
      headers: { "content-length": String(body.length) },
    }),
    onProgress: (value) => progress.push(value),
  });
  assert.deepEqual(await readFile(output), body);
  assert.equal(progress.at(-1), 100);
});

test("update downloader follows only bounded trusted redirects", async () => {
  const dir = await mkdtemp(join(tmpdir(), "quotix-download-"));
  let calls = 0;
  await downloadAsset({
    url: "https://github.com/huakwan/quotix/releases/download/v1.0.7/Quotix.zip",
    size: body.length,
    sha256,
    directory: dir,
    filename: "Quotix.zip",
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://release-assets.githubusercontent.com/asset.zip" },
        });
      }
      return new Response(body, { status: 200 });
    },
  });
  assert.equal(calls, 2);
});

test("update downloader rejects untrusted redirects, mismatches, overflow, and cancellation", async () => {
  const cases = [
    {
      fetchImpl: async () => new Response(null, {
        status: 302,
        headers: { location: "https://evil.example/update.zip" },
      }),
      code: "download_url_untrusted",
    },
    {
      fetchImpl: async () => new Response(body, {
        status: 200,
        headers: { "content-length": String(body.length + 1) },
      }),
      code: "download_size_mismatch",
    },
    {
      fetchImpl: async () => new Response(Buffer.concat([body, Buffer.from("x")]), { status: 200 }),
      code: "download_too_large",
    },
    {
      fetchImpl: async () => new Response(body, { status: 200 }),
      sha256: "0".repeat(64),
      code: "download_checksum_mismatch",
    },
  ];
  for (const [index, item] of cases.entries()) {
    const dir = await mkdtemp(join(tmpdir(), `quotix-download-${index}-`));
    await assert.rejects(() => downloadAsset({
      url: "https://github.com/huakwan/quotix/releases/download/v1.0.7/Quotix.zip",
      size: body.length,
      sha256: item.sha256 ?? sha256,
      directory: dir,
      filename: "Quotix.zip",
      fetchImpl: item.fetchImpl,
    }), { code: item.code });
    await assert.rejects(() => stat(join(dir, "Quotix.zip.partial")));
  }

  const controller = new AbortController();
  controller.abort();
  const dir = await mkdtemp(join(tmpdir(), "quotix-download-abort-"));
  await assert.rejects(() => downloadAsset({
    url: "https://github.com/huakwan/quotix/releases/download/v1.0.7/Quotix.zip",
    size: body.length,
    sha256,
    directory: dir,
    filename: "Quotix.zip",
    fetchImpl: async () => new Response(body),
    signal: controller.signal,
  }), { code: "download_cancelled" });
});
