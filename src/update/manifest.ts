import { createPublicKey, verify } from "node:crypto";
import { UpdateError, type UpdateArch, type UpdateAsset, type UpdateManifest } from "./model";
import { parseAppVersion } from "./version";

export const MAX_UPDATE_BYTES = 250 * 1024 * 1024;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function parseAsset(value: unknown): UpdateAsset {
  if (!isObject(value) || !hasExactKeys(value, ["filename", "size", "sha256"])) {
    throw new UpdateError("manifest_invalid");
  }
  const { filename, size, sha256 } = value;
  if (
    typeof filename !== "string"
    || !/^Quotix-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-macos-(arm64|x64)\.zip$/.test(filename)
    || filename.includes("/")
    || typeof size !== "number"
    || !Number.isSafeInteger(size)
    || size <= 0
    || size > MAX_UPDATE_BYTES
    || typeof sha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(sha256)
  ) {
    throw new UpdateError("manifest_invalid");
  }
  return { filename, size, sha256 };
}

function parseManifest(value: unknown): UpdateManifest {
  if (!isObject(value) || !hasExactKeys(value, ["schemaVersion", "version", "assets"])) {
    throw new UpdateError("manifest_invalid");
  }
  if (value.schemaVersion !== 1 || typeof value.version !== "string" || !parseAppVersion(value.version)) {
    throw new UpdateError("manifest_invalid");
  }
  if (!isObject(value.assets) || !hasExactKeys(value.assets, ["arm64", "x64"])) {
    throw new UpdateError("manifest_invalid");
  }
  const assetMap = value.assets;
  const assets = Object.fromEntries(
    (["arm64", "x64"] as UpdateArch[]).map((arch) => [arch, parseAsset(assetMap[arch])]),
  ) as Record<UpdateArch, UpdateAsset>;
  for (const arch of ["arm64", "x64"] as UpdateArch[]) {
    if (!assets[arch].filename.endsWith(`-macos-${arch}.zip`)) {
      throw new UpdateError("manifest_invalid");
    }
    if (!assets[arch].filename.startsWith(`Quotix-v${value.version}-`)) {
      throw new UpdateError("manifest_invalid");
    }
  }
  return { schemaVersion: 1, version: value.version, assets };
}

function decodeSignature(value: string): Buffer {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9+/]{86}==$/.test(trimmed)) {
    throw new UpdateError("manifest_signature_invalid");
  }
  const decoded = Buffer.from(trimmed, "base64");
  if (decoded.length !== 64 || decoded.toString("base64") !== trimmed) {
    throw new UpdateError("manifest_signature_invalid");
  }
  return decoded;
}

export function verifyManifest(
  rawManifest: Uint8Array,
  rawSignature: string,
  publicKey: string | Buffer,
): UpdateManifest {
  try {
    const signature = decodeSignature(rawSignature);
    const key = createPublicKey(publicKey);
    if (!verify(null, rawManifest, key, signature)) {
      throw new UpdateError("manifest_signature_invalid");
    }
  } catch (error) {
    if (error instanceof UpdateError) { throw error; }
    throw new UpdateError("manifest_signature_invalid");
  }
  try {
    return parseManifest(JSON.parse(Buffer.from(rawManifest).toString("utf8")));
  } catch (error) {
    if (error instanceof UpdateError) { throw error; }
    throw new UpdateError("manifest_invalid");
  }
}
