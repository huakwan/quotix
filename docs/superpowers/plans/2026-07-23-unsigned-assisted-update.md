# Unsigned Assisted Update Implementation Plan

**Goal:** Add a consent-based, cryptographically verified macOS update flow that downloads the correct GitHub Release archive, removes quarantine only from the verified staged app, replaces a writable installed copy without elevated privileges, and rolls back when the new app cannot start.

**Architecture:** Keep all network, filesystem, process, and consent operations in the Electron main process. Build small update-domain modules behind injected interfaces, expose only serializable state and named actions through preload IPC, and run replacement in a detached Electron-as-Node helper after the main app exits. GitHub Actions will sign an exact release manifest with Ed25519; Quotix will embed only the public key.

**Tech stack:** Electron 43, TypeScript 6, Node.js built-ins (`crypto`, `fs`, `child_process`), `yauzl` for ZIP preflight inspection, esbuild, electron-builder, GitHub Actions, Node test runner.

**Source design:** `docs/superpowers/specs/2026-07-23-unsigned-assisted-update-design.md`

## Global Constraints

- macOS `arm64` and `x64` only; reject all other platforms and architectures.
- Do not use Electron `autoUpdater`, `electron-updater`, `sudo`, AppleScript privilege prompts, or a privileged helper.
- Never download without the user pressing **Download**.
- Never remove quarantine without per-update native-dialog consent.
- Never pass a command string to a shell. Use Node APIs or `execFile`/`spawn` with argument arrays and absolute executable paths.
- Never expose release URLs, staging paths, transaction paths, or process execution through the renderer bridge.
- Fail closed on signature, checksum, archive, identity, version, architecture, path-containment, or permission errors.
- Keep quota refresh and provider state independent from update errors.
- Use tests first for each task and commit only after the focused and relevant regression tests pass.

## Required Security Checkpoint

Implementation can begin with generated test keys, but it cannot be declared release-ready until the owner completes this checkpoint:

1. Generate an Ed25519 key pair on a trusted local machine.
2. Add the private PKCS#8 PEM as the GitHub Actions secret `UPDATE_SIGNING_PRIVATE_KEY` without sharing or committing it.
3. Provide only the SPKI public PEM for `src/update/key/quotix-update-public.pem`.
4. Record the public-key fingerprint in `docs/update-signing.md` and verify that the workflow derives the same public key from its secret.

The production private key must never appear in terminal output captured by the agent, repository files, test fixtures, build artifacts, or logs.

---

### Task 1: Define Versions, Release Metadata, and Manifest Trust

**Files:**

- Create: `src/update/model.ts`
- Create: `src/update/version.ts`
- Create: `src/update/manifest.ts`
- Create: `src/update/releaseChecker.ts`
- Create: `src/update/key/quotix-update-public.pem` (owner-supplied public key only)
- Create: `src/pem.d.ts`
- Create: `tests/updateVersion.test.mjs`
- Create: `tests/updateManifest.test.mjs`
- Create: `tests/releaseChecker.test.mjs`
- Modify: `esbuild.js`

**Interfaces:**

- `parseReleaseVersion(value): Version | null` accepts only `vMAJOR.MINOR.PATCH` tags and plain `MAJOR.MINOR.PATCH` app versions.
- `compareVersions(left, right)` compares numeric components without permitting downgrade semantics.
- `verifyManifest(rawManifest, rawSignature, publicKey)` verifies the exact bytes before JSON parsing and returns a validated `UpdateManifest`.
- `ReleaseChecker.check(currentVersion, arch)` returns `up-to-date` or a fully validated `AvailableRelease` whose asset URL came from the expected GitHub release response.

- [ ] Write failing version tests covering valid versions, malformed tags, leading zeros, prerelease/build suffix rejection, newer/equal/older comparisons, and very large numeric components.
- [ ] Implement the minimal version parser and comparator; run `pnpm exec tsc --outDir out && node --test tests/updateVersion.test.mjs` and confirm all focused tests pass.
- [ ] Write failing manifest tests using an Ed25519 pair generated in-memory by the test. Cover valid exact-byte signatures, one-byte mutations, malformed base64, wrong key, unsupported schema, missing/extra fields, invalid hashes, sizes above 250 MiB, unsafe filenames, and missing architecture entries.
- [ ] Implement strict manifest schema validation. Reject unknown keys so future schema changes require an explicit compatibility decision.
- [ ] Add the `.pem` text loader and TypeScript module declaration so the production public key is bundled into main-process code rather than read from a mutable runtime path.
- [ ] Write failing release-checker tests with an injected `fetchImpl`. Cover the expected repository endpoint, headers, draft/prerelease rejection, tag/manifest mismatch, duplicate asset names, absent CPU asset, untrusted hosts, GitHub rate limits, and equal/older releases.
- [ ] Implement `ReleaseChecker` with a bounded response body, GitHub API `Accept` header, `User-Agent`, exact repository/asset matching, and sanitized error codes.
- [ ] Run `pnpm run typecheck && pnpm test`.
- [ ] Commit: `feat: validate signed update releases`.

### Task 2: Download, Inspect, Extract, and Validate the App

**Files:**

- Create: `src/update/downloader.ts`
- Create: `src/update/archive.ts`
- Create: `src/update/bundleValidator.ts`
- Create: `tests/updateDownloader.test.mjs`
- Create: `tests/updateArchive.test.mjs`
- Create: `tests/updateBundleValidator.test.mjs`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- `downloadAsset(release, destination, signal, onProgress)` streams to a private partial file and returns only after size and SHA-256 match.
- `inspectArchive(zipPath)` uses `yauzl` in lazy-entry mode to reject unsafe names and escaping links before extraction.
- `extractArchive(zipPath, stagingDir, runner)` calls `/usr/bin/ditto` with an argument array only after preflight passes.
- `validateBundle(appPath, expected)` validates plist identity/version and executable architecture behind an injected process runner.

- [ ] Add `yauzl` as a bundled runtime dependency and its typings as a development dependency.
- [ ] Write failing downloader tests using a local injected response stream. Cover five redirects, redirect loops, host allowlisting, missing/incorrect content length, more than 250 MiB declared or streamed, cancellation, partial-file cleanup, progress, and checksum mismatch.
- [ ] Implement streaming download with `createHash('sha256')`, exclusive file creation, restrictive directory permissions, atomic `.partial` to `.zip` rename, and no buffering of the archive in memory.
- [ ] Write failing archive tests with generated ZIP fixtures covering one valid `Quotix.app`, absolute paths, `..`, sibling roots, duplicate app roots, absolute symlinks, and relative symlinks that escape the app root.
- [ ] Implement ZIP central-directory preflight with `yauzl`; read symlink targets but do not extract through the library. Invoke `/usr/bin/ditto -x -k` only after preflight succeeds, then walk the extracted tree with `lstat` and repeat containment checks.
- [ ] Write failing bundle-validator tests for bundle ID, product name, version, missing executable, `arm64`/`x86_64` mismatch, universal/multiple architecture rejection, and a second `.app` bundle.
- [ ] Implement plist and Mach-O checks via injected `execFile` calls to absolute `/usr/bin/plutil` and `/usr/bin/lipo`, with argument arrays and bounded output.
- [ ] Run `pnpm run typecheck && pnpm test`.
- [ ] Commit: `feat: stage and validate update archives`.

### Task 3: Implement Safe Install Paths, Transactions, and Rollback

**Files:**

- Create: `src/update/installPaths.ts`
- Create: `src/update/transaction.ts`
- Create: `src/update/installer.ts`
- Create: `src/update/installerHelper.ts`
- Create: `tests/updateInstallPaths.test.mjs`
- Create: `tests/updateInstaller.test.mjs`
- Create: `tests/updateInstallerHelper.test.mjs`

**Interfaces:**

- `resolveInstalledBundle(execPath)` returns an eligible local `.app` path or a Finder-fallback reason.
- `prepareInstall(verifiedUpdate)` revalidates containment, requests quarantine removal only after consent, writes a transaction record, and launches the detached helper.
- `runInstallTransaction(transaction, deps)` performs replacement, launch validation, cleanup, and rollback with injected filesystem/process/clock operations.
- `acknowledgeUpdatedLaunch(argv, userDataDir)` writes a one-time success marker only for a valid pending transaction and token.

- [ ] Write failing path tests covering a normal app, `/Volumes`, non-`.app` execution, symlinked ancestors, different app names, missing parent write access, paths outside the active staging root, and normalized-prefix tricks such as `update-1-evil`.
- [ ] Implement canonical-path and containment helpers using `realpath`, `relative`, `lstat`, and explicit boundary checks. Automatic install requires a writable parent directory; otherwise return Finder fallback.
- [ ] Write failing installer tests proving that `xattr` is never called before consent, is called as `/usr/bin/xattr ['-dr', 'com.apple.quarantine', exactPath]`, refuses a changed staged path, never requests elevation, and reveals the staged app when replacement is ineligible.
- [ ] Implement the native-dialog decision and quarantine step in the main process. Preserve a verified download when quarantine removal or permissions require Finder fallback.
- [ ] Write failing helper tests for successful replacement, failure before backup, failure after backup, new-app launch failure, 30-second marker timeout, mismatched token, cleanup only after success, and diagnostic transaction output.
- [ ] Implement `installerHelper.ts` as both importable transaction logic and a CLI entry. Copy the bundled helper outside the app, launch it with `process.execPath`, `ELECTRON_RUN_AS_NODE=1`, `detached: true`, and `stdio: 'ignore'`.
- [ ] Add startup recovery tests for each transaction phase where an original bundle is launchable. Document the unavoidable tiny power-loss window between filesystem renames and direct affected users to the preserved sibling backup.
- [ ] Implement launch acknowledgment after coordinator, popover, tray, IPC handlers, timers, and first render initialize; do not wait for network quota polling.
- [ ] Run `pnpm run typecheck && pnpm test`.
- [ ] Commit: `feat: install updates with rollback helper`.

### Task 4: Add the Update Coordinator and Main-Process Lifecycle

**Files:**

- Create: `src/update/coordinator.ts`
- Create: `tests/updateCoordinator.test.mjs`
- Modify: `src/ui/popoverState.ts`
- Modify: `src/main.ts`
- Modify: `tests/popoverState.test.mjs`

**Interfaces:**

- `UpdateCoordinator` owns the update state machine and dependencies for check, download, verify, install, cancel, and Finder fallback.
- `UpdateViewState` is the only update object sent to renderer code; it contains status, versions, progress percentage, and sanitized display error—not paths or URLs.
- The app checks once 30 seconds after readiness, every six hours, and on manual request, with one in-flight operation at a time.

- [ ] Write failing state-machine tests for every allowed transition in the approved design and for rejection of duplicate/invalid actions.
- [ ] Add tests using fake timers/dependencies for startup delay, six-hour cadence, manual checks, quiet automatic errors, visible manual errors, cancellation, cleanup on dispose, and independence from quota polling.
- [ ] Implement the coordinator and serializable view-state projection. Keep raw errors and update internals in the main process.
- [ ] Extend `PopoverPayload` with update view state and update the existing payload tests.
- [ ] Integrate the coordinator into `src/main.ts`; build tray menu items from current state, add **Check for Updates…**, and ensure manual checking opens the popover.
- [ ] Register only named update IPC actions and validate state in the coordinator rather than trusting renderer timing.
- [ ] Dispose update timers/listeners in the existing `dispose()` path and keep install-triggered quit compatible with the helper.
- [ ] Run `pnpm run typecheck && pnpm test`.
- [ ] Commit: `feat: coordinate update lifecycle`.

### Task 5: Add the Popover Update Controls

**Files:**

- Modify: `src/ui/popoverState.ts`
- Modify: `src/ui/preload.ts`
- Modify: `src/ui/popoverRenderer.ts`
- Modify: `src/ui/popover.html`
- Modify: `tests/popoverState.test.mjs`
- Modify: `tests/popoverRenderer.test.mjs`

**Interfaces:**

- Preload adds parameterless `checkForUpdates`, `downloadUpdate`, `cancelUpdate`, `installUpdate`, and `revealUpdate` methods.
- `updatePresentation(state)` maps main-process states to fixed labels, button action, progress, disabled state, and error visibility.

- [ ] Write failing presentation tests for idle, checking, up-to-date, available, downloading, verifying, ready, fallback, and error states.
- [ ] Implement the pure presentation mapper in `popoverState.ts` so renderer DOM code contains no security decisions.
- [ ] Add the narrow preload methods and update the `Window.quotix` declaration. Do not expose generic IPC send/invoke functions.
- [ ] Add a compact update row above the existing footer with status text, progress, and one context-appropriate action; preserve light/dark colors, fixed width, ResizeObserver sizing, and keyboard/accessibility labels.
- [ ] Wire controls to the narrow bridge, disable repeated actions while busy, and ensure all GitHub/error text is escaped or assigned with `textContent`.
- [ ] Extend renderer source tests to verify button wiring, no raw path/URL rendering, and correct progress clamping.
- [ ] Run `pnpm run typecheck && pnpm test && pnpm run compile`.
- [ ] Commit: `feat: show assisted updates in popover`.

### Task 6: Bundle and Verify the Detached Helper

**Files:**

- Modify: `esbuild.js`
- Modify: `package.json`
- Modify: `tests/packageConfig.test.mjs`
- Create: `tests/updateBuild.test.mjs`

**Interfaces:**

- Compilation emits `dist/installerHelper.js` as a Node-targeted CommonJS entry beside `dist/main.js`.
- The packaged ASAR contains the helper, while installer code copies it to private staging before the app exits.

- [ ] Write a failing build test asserting that a normal compile emits the helper and that it has no renderer entry points.
- [ ] Add a dedicated esbuild context for `src/update/installerHelper.ts`; keep `electron` external and preserve the existing main/preload/renderer outputs.
- [ ] Extend package tests to assert the helper is included through the existing `dist/**/*` boundary and that no private key pattern/file is packaged.
- [ ] Build each local architecture target available on the host and inspect ASAR for `dist/installerHelper.js` and the absence of private signing material.
- [ ] Launch the packaged helper in a temporary dry-run transaction with `ELECTRON_RUN_AS_NODE=1` to confirm the runtime fuse supports Node mode.
- [ ] Run `pnpm run typecheck && pnpm test && pnpm run compile`.
- [ ] Commit: `build: package update installer helper`.

### Task 7: Sign and Publish Update Metadata in GitHub Actions

**Files:**

- Create: `scripts/create-update-manifest.mjs`
- Create: `tests/createUpdateManifest.test.mjs`
- Modify: `.github/workflows/release-macos.yml`
- Modify: `tests/releaseWorkflow.test.mjs`
- Create: `docs/update-signing.md`

**Interfaces:**

- Each architecture job emits its ZIP plus a build-info JSON containing the plist version and `lipo` architecture observed on that runner.
- `create-update-manifest.mjs` accepts the two archives/build-info files, expected tag, committed public key, and private key from environment; it writes exact deterministic manifest bytes and a detached base64 signature.
- The release job uploads exactly two ZIPs, `quotix-update.json`, and `quotix-update.json.sig`.

- [ ] Write failing script tests with temporary Ed25519 keys and fake archives. Cover deterministic bytes, exact filenames, sizes/hashes, wrong architecture/version, missing archive, missing secret, and private/public mismatch.
- [ ] Implement manifest creation with Node built-ins. Derive the public key from the private secret and compare it with the committed public key before signing. Never log key material.
- [ ] Extend workflow tests first: require build-info generation using `/usr/libexec/PlistBuddy` and `lipo`, require the manifest/signature step, require four public release assets, and reject private-key text written to disk outside the step's restricted temporary file.
- [ ] Update each macOS build job to upload ZIP and build-info; update the release job to verify, hash, sign, self-verify, and upload the four public assets.
- [ ] Keep draft creation and cleanup semantics intact. A missing key, mismatch, or signing failure must delete the draft/tag through the existing cleanup path.
- [ ] Document one-time key creation, GitHub secret setup, fingerprint verification, rotation, revocation, and the rule that the private key never enters the repository.
- [ ] Run `node --test tests/createUpdateManifest.test.mjs tests/releaseWorkflow.test.mjs && pnpm test`.
- [ ] Commit: `ci: publish signed update manifests`.

### Task 8: Document Migration and Complete Verification

**Files:**

- Modify: `README.md`
- Modify: release notes template in `.github/workflows/release-macos.yml`
- Modify: `tests/releaseWorkflow.test.mjs`

- [ ] Add README behavior: automatic checks, user-triggered download, explicit quarantine consent, no `sudo`, Finder fallback, rollback, and the fact that `v1.0.6` must be upgraded manually once.
- [ ] Update bilingual release notes to explain the first updater-enabled version and how to recover using the preserved backup/Finder without presenting quarantine removal as universally safe.
- [ ] Run static verification: `pnpm run typecheck`, `pnpm test`, `pnpm run compile`, and `git diff --check`.
- [ ] Run an arm64 packaged smoke test on Apple Silicon and an x64 packaged smoke test on the Intel GitHub runner. Verify no-update, valid update, tampered archive, interrupted download, read-only/Finder fallback, validation timeout, and rollback.
- [ ] Confirm logs contain sanitized codes and versions but no home paths, URLs carrying tokens, response bodies, manifest contents, or key material.
- [ ] Inspect both release archives for the expected architecture and absence of the private key.
- [ ] Confirm a test GitHub Release exposes exactly the two ZIPs, manifest, and signature, and that the previous installed test build completes the full update/restart handshake.
- [ ] Commit: `docs: explain assisted update flow`.

## Final Acceptance Checklist

- [ ] Production public key is committed; matching private key exists only in GitHub Actions secrets.
- [ ] All unit and integration tests pass with zero failures.
- [ ] Both packaged architectures compile and contain the helper.
- [ ] A modified manifest and modified ZIP are rejected before extraction/installation.
- [ ] Quarantine removal occurs only for a contained verified staging path after native consent.
- [ ] Writable installations update and restart; simulated startup failure restores the old app.
- [ ] Read-only and non-writable installations use Finder fallback without privilege escalation.
- [ ] `v1.0.6` migration limitation is documented in English and Thai release guidance.
- [ ] Working tree contains no private key, staging archive, generated application bundle, or update transaction.
