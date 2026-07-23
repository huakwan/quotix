export type UpdateArch = "arm64" | "x64";

export interface Version {
  major: bigint;
  minor: bigint;
  patch: bigint;
  value: string;
}

export interface UpdateAsset {
  filename: string;
  size: number;
  sha256: string;
}

export interface UpdateManifest {
  schemaVersion: 1;
  version: string;
  assets: Record<UpdateArch, UpdateAsset>;
}

export interface AvailableRelease {
  version: string;
  tag: string;
  asset: UpdateAsset & { url: string };
}

export type ReleaseCheckResult =
  | { status: "up-to-date" }
  | { status: "available"; release: AvailableRelease };

export interface VerifiedUpdate {
  version: string;
  stagingRoot: string;
  appPath: string;
}

export type UpdateViewState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "up-to-date"; version: string }
  | { status: "available"; version: string }
  | { status: "downloading"; version: string; progress: number }
  | { status: "verifying"; version: string }
  | { status: "ready"; version: string }
  | { status: "installing"; version: string }
  | { status: "fallback"; version: string }
  | { status: "error"; error: string };

export class UpdateError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "UpdateError";
  }
}
