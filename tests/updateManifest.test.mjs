import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";

import { UpdateError } from "../out/src/update/model.js";
import { verifyManifest } from "../out/src/update/manifest.js";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicPem = publicKey.export({ type: "spki", format: "pem" });

function rawManifest(overrides = {}) {
  return Buffer.from(`${JSON.stringify({
    schemaVersion: 1,
    version: "1.0.7",
    assets: {
      arm64: {
        filename: "Quotix-v1.0.7-macos-arm64.zip",
        size: 12_345,
        sha256: "a".repeat(64),
      },
      x64: {
        filename: "Quotix-v1.0.7-macos-x64.zip",
        size: 23_456,
        sha256: "b".repeat(64),
      },
    },
    ...overrides,
  })}\n`);
}

function signed(raw) {
  return sign(null, raw, privateKey).toString("base64");
}

test("update manifest verifies exact bytes before returning strict data", () => {
  const raw = rawManifest();
  assert.deepEqual(verifyManifest(raw, signed(raw), publicPem), {
    schemaVersion: 1,
    version: "1.0.7",
    assets: {
      arm64: {
        filename: "Quotix-v1.0.7-macos-arm64.zip",
        size: 12_345,
        sha256: "a".repeat(64),
      },
      x64: {
        filename: "Quotix-v1.0.7-macos-x64.zip",
        size: 23_456,
        sha256: "b".repeat(64),
      },
    },
  });
});

test("update manifest rejects signature and encoding failures", () => {
  const raw = rawManifest();
  const changed = Buffer.from(raw);
  changed[changed.length - 2] ^= 1;
  assert.throws(() => verifyManifest(changed, signed(raw), publicPem), {
    code: "manifest_signature_invalid",
  });
  assert.throws(() => verifyManifest(raw, "not base64!", publicPem), {
    code: "manifest_signature_invalid",
  });
  const other = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" });
  assert.throws(() => verifyManifest(raw, signed(raw), other), {
    code: "manifest_signature_invalid",
  });
});

test("update manifest rejects unknown, missing, and unsafe fields", () => {
  const cases = [
    rawManifest({ schemaVersion: 2 }),
    rawManifest({ extra: true }),
    rawManifest({ version: "v1.0.7" }),
    rawManifest({ assets: { arm64: {
      filename: "../Quotix.zip", size: 1, sha256: "a".repeat(64),
    } } }),
    rawManifest({ assets: {
      arm64: {
        filename: "Quotix-v1.0.7-macos-arm64.zip",
        size: 250 * 1024 * 1024 + 1,
        sha256: "a".repeat(64),
      },
      x64: {
        filename: "Quotix-v1.0.7-macos-x64.zip",
        size: 2,
        sha256: "xyz",
      },
    } }),
  ];
  for (const raw of cases) {
    assert.throws(
      () => verifyManifest(raw, signed(raw), publicPem),
      (error) => error instanceof UpdateError && error.code === "manifest_invalid",
    );
  }
});
