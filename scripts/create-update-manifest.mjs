import {
  createPrivateKey,
  createPublicKey,
  createHash,
  sign,
  verify,
} from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

const MAX_BYTES = 250 * 1024 * 1024;

function fail(message) {
  throw new Error(`update manifest: ${message}`);
}

function parseTag(tag) {
  const match = /^v((0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*))$/.exec(tag);
  if (!match) { fail("invalid tag"); }
  return match[1];
}

async function assetInfo(assetsDir, version, arch) {
  const binaryArch = arch === "arm64" ? "arm64" : "x86_64";
  const filename = `Quotix-v${version}-macos-${arch}.zip`;
  const path = join(assetsDir, filename);
  const buildInfoPath = join(assetsDir, `build-info-${arch}.json`);
  let info;
  try {
    info = JSON.parse(await readFile(buildInfoPath, "utf8"));
  } catch {
    fail(`missing build info for ${arch}`);
  }
  if (
    info.version !== version
    || info.arch !== arch
    || info.binaryArch !== binaryArch
    || Object.keys(info).sort().join(",") !== "arch,binaryArch,version"
  ) {
    fail(`build info mismatch for ${arch}`);
  }
  const stats = await stat(path);
  if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_BYTES) {
    fail(`invalid archive for ${arch}`);
  }
  const sha256 = createHash("sha256").update(await readFile(path)).digest("hex");
  return { filename, size: stats.size, sha256 };
}

function samePublicKey(left, right) {
  const leftDer = left.export({ type: "spki", format: "der" });
  const rightDer = createPublicKey(right).export({ type: "spki", format: "der" });
  return leftDer.equals(rightDer);
}

export async function createUpdateManifest(options) {
  const version = parseTag(options.tag);
  if (!options.privateKeyPem) { fail("private key is required"); }
  const privateKey = createPrivateKey(options.privateKeyPem);
  if (privateKey.asymmetricKeyType !== "ed25519") { fail("private key must be Ed25519"); }
  const committedPublicKey = await readFile(options.publicKeyPath, "utf8");
  if (committedPublicKey.trim() === "UNCONFIGURED") { fail("public key is unconfigured"); }
  if (!samePublicKey(createPublicKey(privateKey), committedPublicKey)) {
    fail("private/public key mismatch");
  }
  const manifest = {
    schemaVersion: 1,
    version,
    assets: {
      arm64: await assetInfo(options.assetsDir, version, "arm64"),
      x64: await assetInfo(options.assetsDir, version, "x64"),
    },
  };
  const raw = Buffer.from(`${JSON.stringify(manifest)}\n`);
  const signature = sign(null, raw, privateKey);
  if (!verify(null, raw, committedPublicKey, signature)) { fail("self-verification failed"); }

  const manifestPath = join(options.outputDir, "quotix-update.json");
  const signaturePath = join(options.outputDir, "quotix-update.json.sig");
  await writeFile(manifestPath, raw, { mode: 0o644 });
  await writeFile(signaturePath, `${signature.toString("base64")}\n`, { mode: 0o644 });
  return { manifestPath, signaturePath };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const assetsDir = argument("--assets-dir");
  const outputDir = argument("--output-dir");
  const tag = argument("--tag");
  const publicKeyPath = argument("--public-key");
  if (!assetsDir || !outputDir || !tag || !publicKeyPath) { fail("missing arguments"); }
  await createUpdateManifest({
    assetsDir,
    outputDir,
    tag,
    publicKeyPath,
    privateKeyPem: process.env.UPDATE_SIGNING_PRIVATE_KEY ?? "",
  });
  process.stdout.write(
    `Created ${basename(join(outputDir, "quotix-update.json"))} and signature\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "update manifest failed"}\n`);
    process.exitCode = 1;
  });
}
