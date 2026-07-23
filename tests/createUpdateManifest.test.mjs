import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createUpdateManifest } from "../scripts/create-update-manifest.mjs";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "quotix-manifest-"));
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });
  const publicPem = publicKey.export({ type: "spki", format: "pem" });
  await writeFile(join(directory, "update-public-key.pem"), publicPem);
  for (const [arch, binaryArch] of [["arm64", "arm64"], ["x64", "x86_64"]]) {
    await writeFile(join(directory, `Quotix-v1.0.7-macos-${arch}.zip`), `archive-${arch}`);
    await writeFile(join(directory, `build-info-${arch}.json`), JSON.stringify({
      version: "1.0.7",
      arch,
      binaryArch,
    }));
  }
  return { directory, privatePem, publicPem };
}

test("manifest generator writes deterministic exact metadata and a verifiable signature", async () => {
  const { directory, privatePem } = await fixture();
  const result = await createUpdateManifest({
    assetsDir: directory,
    outputDir: directory,
    tag: "v1.0.7",
    publicKeyPath: join(directory, "update-public-key.pem"),
    privateKeyPem: privatePem,
  });
  const raw = await readFile(result.manifestPath);
  const parsed = JSON.parse(raw);
  assert.equal(raw.at(-1), 10);
  assert.equal(parsed.version, "1.0.7");
  assert.equal(parsed.assets.arm64.filename, "Quotix-v1.0.7-macos-arm64.zip");
  assert.equal(parsed.assets.x64.size, Buffer.byteLength("archive-x64"));
  assert.match(parsed.assets.arm64.sha256, /^[a-f0-9]{64}$/);
  assert.match((await readFile(result.signaturePath, "utf8")).trim(), /^[A-Za-z0-9+/]{86}==$/);

  const second = await createUpdateManifest({
    assetsDir: directory,
    outputDir: directory,
    tag: "v1.0.7",
    publicKeyPath: join(directory, "update-public-key.pem"),
    privateKeyPem: privatePem,
  });
  assert.deepEqual(await readFile(second.manifestPath), raw);
});

test("manifest generator rejects missing secret, key mismatch, and build mismatch", async () => {
  const { directory, privatePem } = await fixture();
  const base = {
    assetsDir: directory,
    outputDir: directory,
    tag: "v1.0.7",
    publicKeyPath: join(directory, "update-public-key.pem"),
  };
  await assert.rejects(() => createUpdateManifest({ ...base, privateKeyPem: "" }));

  const other = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" });
  await assert.rejects(() => createUpdateManifest({ ...base, privateKeyPem: other }));

  await writeFile(join(directory, "build-info-x64.json"), JSON.stringify({
    version: "1.0.8", arch: "x64", binaryArch: "x86_64",
  }));
  await assert.rejects(() => createUpdateManifest({ ...base, privateKeyPem: privatePem }));
});
