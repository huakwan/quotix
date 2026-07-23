import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";

import { ReleaseChecker } from "../out/src/update/releaseChecker.js";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicPem = publicKey.export({ type: "spki", format: "pem" });

function fixture(version = "1.0.7") {
  const manifest = Buffer.from(`${JSON.stringify({
    schemaVersion: 1,
    version,
    assets: {
      arm64: {
        filename: `Quotix-v${version}-macos-arm64.zip`,
        size: 10,
        sha256: "a".repeat(64),
      },
      x64: {
        filename: `Quotix-v${version}-macos-x64.zip`,
        size: 11,
        sha256: "b".repeat(64),
      },
    },
  })}\n`);
  const signature = sign(null, manifest, privateKey).toString("base64");
  const assets = [
    ["quotix-update.json", "https://github.com/huakwan/quotix/releases/download/v1.0.7/quotix-update.json"],
    ["quotix-update.json.sig", "https://github.com/huakwan/quotix/releases/download/v1.0.7/quotix-update.json.sig"],
    [`Quotix-v${version}-macos-arm64.zip`, `https://github.com/huakwan/quotix/releases/download/v1.0.7/Quotix-v${version}-macos-arm64.zip`],
    [`Quotix-v${version}-macos-x64.zip`, `https://github.com/huakwan/quotix/releases/download/v1.0.7/Quotix-v${version}-macos-x64.zip`],
  ].map(([name, browser_download_url]) => ({ name, browser_download_url }));
  return {
    release: { tag_name: `v${version}`, draft: false, prerelease: false, assets },
    manifest,
    signature,
  };
}

function fetchFor(data, calls) {
  return async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/releases/latest")) {
      return new Response(JSON.stringify(data.release), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.endsWith("quotix-update.json")) {
      return new Response(data.manifest, { status: 200 });
    }
    if (url.endsWith("quotix-update.json.sig")) {
      return new Response(data.signature, { status: 200 });
    }
    throw new Error(`unexpected URL: ${url}`);
  };
}

test("release checker returns the matching newer CPU asset", async () => {
  const data = fixture();
  const calls = [];
  const checker = new ReleaseChecker({
    fetchImpl: fetchFor(data, calls),
    publicKey: publicPem,
    appVersion: "1.0.6",
    arch: "arm64",
  });
  const result = await checker.check();
  assert.equal(result.status, "available");
  assert.equal(result.release.version, "1.0.7");
  assert.equal(result.release.asset.filename, "Quotix-v1.0.7-macos-arm64.zip");
  assert.equal(calls[0].url, "https://api.github.com/repos/huakwan/quotix/releases/latest");
  assert.match(calls[0].init.headers["User-Agent"], /^Quotix\/1\.0\.6$/);
});

test("release checker reports equal or older stable versions as up to date", async () => {
  for (const version of ["1.0.6", "1.0.5"]) {
    const data = fixture(version);
    const checker = new ReleaseChecker({
      fetchImpl: fetchFor(data, []),
      publicKey: publicPem,
      appVersion: "1.0.6",
      arch: "x64",
    });
    assert.deepEqual(await checker.check(), { status: "up-to-date" });
  }
});

test("release checker rejects draft, prerelease, duplicate, mismatched, and untrusted assets", async () => {
  const mutations = [
    (data) => { data.release.draft = true; },
    (data) => { data.release.prerelease = true; },
    (data) => { data.release.assets.push(data.release.assets[0]); },
    (data) => { data.release.tag_name = "v1.0.8"; },
    (data) => { data.release.assets[0].browser_download_url = "https://evil.example/manifest"; },
    (data) => { data.release.assets = data.release.assets.filter((asset) => !asset.name.includes("arm64")); },
  ];
  for (const mutate of mutations) {
    const data = fixture();
    mutate(data);
    const checker = new ReleaseChecker({
      fetchImpl: fetchFor(data, []),
      publicKey: publicPem,
      appVersion: "1.0.6",
      arch: "arm64",
    });
    await assert.rejects(() => checker.check());
  }
});

test("release checker surfaces a sanitized GitHub rate-limit code", async () => {
  const checker = new ReleaseChecker({
    fetchImpl: async () => new Response("secret response", { status: 403 }),
    publicKey: publicPem,
    appVersion: "1.0.6",
    arch: "arm64",
  });
  await assert.rejects(() => checker.check(), {
    code: "release_rate_limited",
    message: "release_rate_limited",
  });
});

test("release checker follows only trusted metadata redirects", async () => {
  const data = fixture();
  let redirectedManifest = false;
  const checker = new ReleaseChecker({
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.endsWith("/releases/latest")) {
        return new Response(JSON.stringify(data.release), { status: 200 });
      }
      if (url.endsWith("quotix-update.json") && !redirectedManifest) {
        redirectedManifest = true;
        return new Response(null, {
          status: 302,
          headers: { location: "https://release-assets.githubusercontent.com/manifest" },
        });
      }
      if (url === "https://release-assets.githubusercontent.com/manifest") {
        return new Response(data.manifest, { status: 200 });
      }
      if (url.endsWith("quotix-update.json.sig")) {
        return new Response(data.signature, { status: 200 });
      }
      throw new Error(`unexpected URL: ${url}`);
    },
    publicKey: publicPem,
    appVersion: "1.0.6",
    arch: "arm64",
  });
  assert.equal((await checker.check()).status, "available");

  data.release.assets[0].browser_download_url =
    "https://github.com/huakwan/quotix/releases/download/v1.0.7/quotix-update.json";
  const untrusted = new ReleaseChecker({
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.endsWith("/releases/latest")) {
        return new Response(JSON.stringify(data.release), { status: 200 });
      }
      return new Response(null, {
        status: 302,
        headers: { location: "https://evil.example/manifest" },
      });
    },
    publicKey: publicPem,
    appVersion: "1.0.6",
    arch: "arm64",
  });
  await assert.rejects(() => untrusted.check(), { code: "manifest_fetch_failed" });
});
