# Unsigned Assisted Update Design

**Date:** 2026-07-23

**Status:** Approved for planning

**Scope:** macOS `arm64` and `x64` GitHub Releases

## Summary

Quotix will detect newer public GitHub Releases and offer an assisted update flow without Apple Developer ID code signing and without Electron's built-in auto-updater. The app will never download or install an update without an explicit user action. Before installation it will verify a release manifest signature, the archive checksum, the application identity, version, and CPU architecture.

After a second explicit consent, Quotix will remove the quarantine attribute only from the verified staged application, close itself, and start a detached helper that replaces the installed application and relaunches it. The helper will preserve the previous application until the new version confirms a successful launch, and will roll back on failure.

This design does not make an unsigned app equivalent to an Apple-signed and notarized app. It provides a controlled update path for users who already chose to run Quotix.

## Goals

- Detect a newer stable Quotix release at startup, every six hours while running, and on manual request.
- Select the correct release archive for Apple Silicon or Intel.
- Require explicit actions to download and to install.
- Authenticate update metadata with an Ed25519 signature and verify archive integrity with SHA-256.
- Remove `com.apple.quarantine` only after validation and explicit consent.
- Replace a writable installed copy without `sudo` or an administrator password.
- Roll back automatically if the new copy cannot report a successful launch.
- Fall back to a Finder-assisted manual installation when automatic replacement is not safe or possible.
- Keep quota polling and all existing app behavior functional when update checks fail.

## Non-goals

- Apple Developer ID signing or notarization.
- Electron `autoUpdater` or `electron-updater` compatibility.
- Silent background download or silent installation.
- Prerelease, beta, staged rollout, or downgrade support.
- Updating an app directly from a read-only disk image.
- Privilege escalation, `sudo`, authorization helpers, or automatic quarantine removal from arbitrary files.
- Protection from a compromised local machine or a locally modified Quotix executable. The manifest signature protects release authenticity only while the embedded public key and running app remain trusted.

## User Experience

The popover will contain a compact update row near its footer:

- `Up to date — v1.0.6` when the latest check succeeds and no update exists.
- `Version 1.0.7 is available` with a **Download** button when a newer version exists.
- Download progress while the archive is being transferred and verified.
- `Version 1.0.7 is ready` with an **Install and Restart** button after validation.
- A short, actionable error and a **Retry** button for recoverable failures.
- **Show in Finder** when automatic replacement is unavailable.

The existing tray context menu will gain **Check for Updates…**. Automatic checks remain quiet unless a newer release is found. Manual checks show their result in the popover and bring it into view.

Selecting **Install and Restart** opens a native confirmation dialog that states:

1. the exact current and target versions;
2. that Quotix is not Apple-signed;
3. that Quotix will remove quarantine only from the verified downloaded copy; and
4. that the app will restart and restore the old copy if startup fails.

No remembered or global consent is stored. Every installed update requires confirmation.

## Architecture

### `ReleaseChecker`

`ReleaseChecker` calls the public GitHub `releases/latest` endpoint for `huakwan/quotix`, ignores drafts and prereleases, parses strict semantic versions, and compares the latest version to `app.getVersion()`. It accepts only the expected update manifest and signature asset names from the expected repository.

Checks run 30 seconds after app readiness, every six hours, and when requested by the user. Only one check may run at a time. Network errors are recorded in update state and never affect quota polling.

### `UpdateManifestVerifier`

Each release contains these additional assets:

- `quotix-update.json`
- `quotix-update.json.sig`

The detached signature file contains one trimmed base64-encoded Ed25519 signature over the exact UTF-8 bytes of `quotix-update.json`. The workflow emits compact JSON with LF line endings and one trailing newline. The corresponding SPKI public key is embedded in Quotix. Verification happens before the manifest is parsed or any archive URL is trusted.

The manifest has this logical shape:

```json
{
  "schemaVersion": 1,
  "version": "1.0.7",
  "assets": {
    "arm64": {
      "filename": "Quotix-v1.0.7-macos-arm64.zip",
      "size": 12345678,
      "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    },
    "x64": {
      "filename": "Quotix-v1.0.7-macos-x64.zip",
      "size": 12345678,
      "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    }
  }
}
```

The manifest contains filenames rather than URLs. The downloader resolves the matching filename only from assets returned for the already validated GitHub Release. The manifest version, GitHub tag, package version, and requested target version must all match exactly.

### `UpdateDownloader`

`UpdateDownloader` selects `arm64` for `process.arch === "arm64"` and `x64` for `process.arch === "x64"`; other architectures are unsupported. It downloads into a newly created private directory under Quotix's user-data update area and enforces:

- GitHub and GitHub release-asset HTTPS hosts only;
- at most five redirects;
- the declared content length when available;
- a maximum archive size of 250 MiB;
- streamed SHA-256 verification; and
- cancellation and cleanup of incomplete files.

Before extraction, every archive entry is validated to reject absolute paths, parent traversal, symlinks that escape the staging directory, and files outside the single expected `Quotix.app` root. Extraction is performed without invoking a shell.

The extracted bundle must have:

- bundle identifier `com.huakwan.quotix`;
- product name `Quotix`;
- the target release version;
- exactly the selected CPU architecture for its main executable; and
- no unexpected second application bundle.

Only one downloaded, verified update is retained. Abandoned and incomplete staging directories are cleaned on the next launch.

### `UpdateInstaller`

`UpdateInstaller` derives the running `.app` bundle path from `process.execPath`. It refuses automatic installation when the path is not a local `.app`, is under `/Volumes`, resolves through an unsafe symbolic link, or cannot be replaced without elevated privileges.

After the native consent dialog, the main process calls `/usr/bin/xattr` through an argument-array process API, not a shell, to remove `com.apple.quarantine` recursively from the exact verified staged `Quotix.app`. The path must still resolve inside the active private staging directory immediately before the command runs. Failure stops the installation.

The app then copies the separately bundled `installerHelper` JavaScript and its immutable inputs to the private staging directory. It starts the helper detached with the current Electron executable in Node mode (`ELECTRON_RUN_AS_NODE=1`) and then quits. The build must preserve that Electron fuse capability. Renderer processes never receive filesystem paths and never execute commands.

The helper:

1. waits for the original Quotix process to exit;
2. creates a uniquely named sibling backup of the installed app;
3. moves the verified staged app into the original path;
4. launches the new executable with a one-time validation token;
5. waits up to 30 seconds for the new app to write a matching success marker after the coordinator, popover, tray, IPC handlers, timers, and first render are initialized (the initial network quota poll need not finish); and
6. removes the backup only after receiving that marker.

If replacement, launch, or validation fails, the helper terminates the failed new process when applicable, restores the backup, relaunches the old version, and writes a diagnostic result for the app to show on its next launch. Paths and tokens are passed as discrete arguments; no user-controlled value is interpolated into shell source.

### `UpdateCoordinator`

`UpdateCoordinator` is the main-process state owner. It exposes a small serializable view to the renderer through the preload bridge and accepts named IPC actions for check, download, cancel, install, and reveal-in-Finder. It rejects actions that are invalid for the current state.

The primary states are:

```text
idle -> checking -> up-to-date
                 -> available -> downloading -> verifying -> ready
                 -> error
ready -> awaiting-consent -> installing
any non-installing state -> checking (manual retry)
```

An update check never mutates preferences or quota state. Closing the popover does not cancel an active download.

## Permission and Finder Fallback

The updater never invokes `sudo`, requests an administrator password, changes parent-directory permissions, or installs a privileged helper.

If the current bundle cannot be replaced safely, Quotix keeps the verified staged application, removes quarantine only after the same explicit consent, reveals it in Finder, and shows instructions to quit Quotix and drag the new copy over the old one. If even quarantine removal is denied, the app leaves the attribute intact and explains the standard Finder/Open flow; it does not attempt another bypass.

## Release Workflow

The existing GitHub Actions workflow will continue to build separate `arm64` and `x64` ZIP archives. The release assembly job will additionally:

1. verify that both archives exist and match the package version;
2. compute their byte sizes and SHA-256 hashes;
3. generate the deterministic manifest bytes;
4. sign those exact bytes with an Ed25519 PKCS#8 PEM private key stored as the multiline GitHub Actions secret `UPDATE_SIGNING_PRIVATE_KEY`;
5. verify the signature with the corresponding public key before publishing; and
6. upload both archives, the manifest, and detached signature to the same non-draft GitHub Release.

Publishing fails closed if the key is absent, signing fails, an asset is missing, or self-verification fails. The private key is never written to repository files or build artifacts. Key rotation requires shipping a version that trusts both old and new public keys before releases are signed only by the new key.

## Error Handling and Recovery

- GitHub unavailable or rate-limited: retain the last UI state, show a retryable message only for a manual check, and retry at the next normal interval.
- Invalid version or release structure: treat the release as unusable and do not download.
- Manifest signature failure: reject the release and show a security-specific error.
- Size or SHA-256 mismatch: delete the archive and staging directory.
- Invalid ZIP entry or bundle metadata: delete the extracted app and reject installation.
- Quarantine removal failure: keep the verified download for Finder fallback; never continue automatic replacement.
- Insufficient permissions or read-only location: use Finder fallback.
- Helper replacement failure: restore the prior bundle if it was moved.
- New version startup timeout or crash: terminate it when possible, restore the backup, and relaunch the previous version.
- Process interruption: on the next launch, inspect the transaction record and choose the only valid bundle from the recorded original, staged, and backup paths; never guess based on arbitrary nearby files.

Update logs contain versions, state transitions, and sanitized error codes. They do not contain credentials, signed manifest bytes, arbitrary response bodies, or user home-directory paths.

## Testing Strategy

### Unit tests

- strict semantic-version parsing and comparison, including no downgrade;
- GitHub release filtering and exact asset selection;
- manifest schema validation and Ed25519 verification;
- rejection of modified manifests, hashes, versions, and filenames;
- architecture mapping;
- redirect, size, checksum, and cancellation behavior;
- ZIP traversal and escaping-symlink rejection;
- bundle identity, version, and architecture validation;
- state-machine transitions and duplicate-action rejection;
- staging-path containment and install-location safety checks; and
- renderer/preload IPC validation.

### Integration tests

- release workflow produces two archives plus a verifiable manifest and signature;
- helper completes replacement in a temporary fake application location;
- helper restores the backup after simulated copy, launch, and validation failures;
- startup transaction recovery handles each recorded interruption point;
- non-writable and `/Volumes` paths select Finder fallback; and
- quarantine removal is invoked only after consent and only for the verified staged path.

### Packaged smoke tests

Before the first updater-enabled release, manually test an installed packaged build on both Apple Silicon and Intel:

- no update available;
- successful download and restart into a newer test release;
- tampered archive rejection;
- network interruption and retry;
- Finder fallback from a read-only location; and
- forced validation timeout followed by rollback.

Tests must not alter a real `/Applications/Quotix.app` or remove quarantine from files outside a temporary test directory.

## Migration and Rollout

Version `1.0.6` has no update checker, so its users must manually install the first updater-enabled release. That release embeds the update public key and all assisted-update components. Only subsequent releases can use this flow.

The first updater-enabled release should be exercised against a temporary test release before it becomes the public latest release. Its release notes must explain that Quotix remains unsigned, what the consent dialog does, and how to recover through Finder if replacement fails.

## Success Criteria

- A supported installed build detects a newer stable GitHub Release without disrupting quota functionality.
- No archive is downloaded without a user action.
- No quarantine attribute is removed without explicit per-update consent.
- A modified manifest or archive cannot reach installation.
- A writable installed copy updates and relaunches successfully on both supported architectures.
- A failed new version restores and relaunches the previous copy.
- A non-writable or read-only installation ends in a clear Finder-assisted path without requesting elevated privileges.
