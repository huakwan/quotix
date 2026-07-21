# macOS 12 Intel Compatibility Design

## Problem

The current macOS packaging command builds only for the architecture of the
build machine. On Apple Silicon it therefore produces an arm64-only app, which
cannot launch on an Intel Mac running macOS 12.6.7.

The directory build also remains incorrectly signed when electron-builder
cannot find a Developer ID certificate. Electron's downloaded bundle starts
with a signature, but packaging changes its resources. Because electron-builder
skips signing rather than applying an ad-hoc signature, the resulting bundle
fails signature verification and may fail to launch even on a compatible CPU.

Electron 43 still supports macOS 12, and the packaged executables declare a
minimum operating-system version of macOS 12.0. Downgrading Electron is not
part of this fix.

## Goals

- Produce one application bundle that runs natively on Intel and Apple Silicon.
- Preserve macOS 12.0 as the explicit minimum supported version.
- Produce a valid ad-hoc-signed local/internal build when no Developer ID is
  available.
- Keep the current runtime code and package contents unchanged.
- Add automated regression checks for the compatibility configuration.

## Non-Goals

- Apple notarization or public distribution without Gatekeeper prompts.
- Supporting macOS 11 or older.
- Changing application behavior or Electron APIs.

## Considered Approaches

1. Build one Universal application. This provides a single artifact containing
   x64 and arm64 executable slices and is the selected approach.
2. Publish separate x64 and arm64 applications. This reduces each download but
   requires users and release automation to select and manage two artifacts.
3. Publish only x64. This fixes the reported Intel machine but drops native
   Apple Silicon support and creates another compatibility regression.

## Design

The `dist:mac` command will request electron-builder's `universal`
architecture explicitly rather than inheriting the build host architecture.
The macOS configuration will set `minimumSystemVersion` to `12.0` so the
support contract is visible and testable in source control.

Local/internal builds will use electron-builder's explicit ad-hoc signing mode.
The signing configuration will include the Electron-required JIT entitlement
and disable library validation so the hardened runtime accepts Electron's
pre-signed frameworks after the outer application is ad-hoc signed. The same
entitlements will be applied to inherited helper processes.

This signing mode does not replace Developer ID signing and notarization for a
public release. Users receiving an internal build may still need to use
Finder's **Open** action once to approve it through Gatekeeper.

## Testing and Verification

Extend the package configuration test first and confirm it fails against the
current configuration. It will assert that:

- the macOS build command requests the Universal architecture;
- the minimum system version is `12.0`;
- ad-hoc signing and the required entitlement files are configured; and
- the entitlement files enable JIT and disable library validation.

After the configuration passes the regression test, run type checking and the
complete unit suite. Build a fresh macOS directory artifact, then verify:

- `Info.plist` contains `LSMinimumSystemVersion` equal to `12.0`;
- the main executable contains both `x86_64` and `arm64` slices;
- strict deep code-signature verification succeeds; and
- the application launches successfully on the available build host.

The local environment cannot directly execute the Intel slice on macOS 12, so
the x86_64 slice and minimum-version metadata are the reproducible compatibility
checks for that target. Final confirmation remains a launch test on the Intel
Mac running macOS 12.6.7.

## Success Criteria

- One Universal `.app` is produced by `pnpm run dist:mac`.
- The artifact contains both Intel and Apple Silicon executable code.
- The artifact declares macOS 12.0 as its minimum version.
- The artifact passes code-signature verification and launches on the build
  host.
- All automated tests and type checking pass.
- The app launches on the target Intel Mac running macOS 12.6.7 after normal
  first-open approval for an internal build.
