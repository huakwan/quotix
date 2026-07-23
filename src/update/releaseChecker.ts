import {
  UpdateError,
  type ReleaseCheckResult,
  type UpdateArch,
} from "./model";
import { verifyManifest } from "./manifest";
import { compareVersions, parseAppVersion, parseReleaseTag } from "./version";

const API_URL = "https://api.github.com/repos/huakwan/quotix/releases/latest";
const MAX_METADATA_BYTES = 1024 * 1024;

interface ReleaseAssetJson {
  name: string;
  browser_download_url: string;
}

interface ReleaseJson {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  assets: ReleaseAssetJson[];
}

export interface ReleaseCheckerOptions {
  fetchImpl: typeof fetch;
  publicKey: string | Buffer;
  appVersion: string;
  arch: UpdateArch;
}

async function boundedBytes(response: Response, errorCode: string): Promise<Buffer> {
  if (!response.ok) {
    if (response.status === 403 || response.status === 429) {
      throw new UpdateError("release_rate_limited");
    }
    throw new UpdateError(errorCode);
  }
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_METADATA_BYTES) {
    throw new UpdateError(errorCode);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_METADATA_BYTES) { throw new UpdateError(errorCode); }
  return bytes;
}

function parseRelease(value: unknown): ReleaseJson {
  if (typeof value !== "object" || value === null) { throw new UpdateError("release_invalid"); }
  const release = value as Partial<ReleaseJson>;
  if (
    typeof release.tag_name !== "string"
    || typeof release.draft !== "boolean"
    || typeof release.prerelease !== "boolean"
    || !Array.isArray(release.assets)
  ) {
    throw new UpdateError("release_invalid");
  }
  const assets = release.assets.map((asset) => {
    if (
      typeof asset !== "object"
      || asset === null
      || typeof (asset as ReleaseAssetJson).name !== "string"
      || typeof (asset as ReleaseAssetJson).browser_download_url !== "string"
    ) {
      throw new UpdateError("release_invalid");
    }
    return {
      name: (asset as ReleaseAssetJson).name,
      browser_download_url: (asset as ReleaseAssetJson).browser_download_url,
    };
  });
  return {
    tag_name: release.tag_name,
    draft: release.draft,
    prerelease: release.prerelease,
    assets,
  };
}

function exactAsset(release: ReleaseJson, name: string): ReleaseAssetJson {
  const matches = release.assets.filter((asset) => asset.name === name);
  if (matches.length !== 1) { throw new UpdateError("release_invalid"); }
  const asset = matches[0];
  let url: URL;
  try {
    url = new URL(asset.browser_download_url);
  } catch {
    throw new UpdateError("release_invalid");
  }
  const expectedPath = `/huakwan/quotix/releases/download/${release.tag_name}/${name}`;
  if (
    url.protocol !== "https:"
    || url.hostname !== "github.com"
    || url.pathname !== expectedPath
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new UpdateError("release_invalid");
  }
  return asset;
}

export class ReleaseChecker {
  constructor(private readonly options: ReleaseCheckerOptions) {}

  async check(): Promise<ReleaseCheckResult> {
    const current = parseAppVersion(this.options.appVersion);
    if (!current) { throw new UpdateError("current_version_invalid"); }
    if (this.options.arch !== "arm64" && this.options.arch !== "x64") {
      throw new UpdateError("architecture_unsupported");
    }
    const apiResponse = await this.options.fetchImpl(API_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `Quotix/${this.options.appVersion}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      redirect: "error",
    });
    const release = parseRelease(JSON.parse(
      (await boundedBytes(apiResponse, "release_fetch_failed")).toString("utf8"),
    ));
    const latest = parseReleaseTag(release.tag_name);
    if (!latest || release.draft || release.prerelease) {
      throw new UpdateError("release_invalid");
    }
    if (compareVersions(latest, current) <= 0) {
      return { status: "up-to-date" };
    }

    const manifestAsset = exactAsset(release, "quotix-update.json");
    const signatureAsset = exactAsset(release, "quotix-update.json.sig");
    const [manifestResponse, signatureResponse] = await Promise.all([
      this.options.fetchImpl(manifestAsset.browser_download_url, { redirect: "error" }),
      this.options.fetchImpl(signatureAsset.browser_download_url, { redirect: "error" }),
    ]);
    const [rawManifest, rawSignature] = await Promise.all([
      boundedBytes(manifestResponse, "manifest_fetch_failed"),
      boundedBytes(signatureResponse, "manifest_fetch_failed"),
    ]);
    const manifest = verifyManifest(rawManifest, rawSignature.toString("utf8"), this.options.publicKey);
    if (manifest.version !== latest.value) {
      throw new UpdateError("release_version_mismatch");
    }
    const selected = manifest.assets[this.options.arch];
    const archive = exactAsset(release, selected.filename);
    return {
      status: "available",
      release: {
        version: latest.value,
        tag: release.tag_name,
        asset: { ...selected, url: archive.browser_download_url },
      },
    };
  }
}
