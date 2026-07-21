# README macOS Compatibility Design

## Goal

Document the operating-system and CPU architectures supported by the current
Quotix macOS build.

## Design

Update the first item under `README.md`'s **Requirements** section to state that
Quotix requires macOS 12 Monterey or later. Add a nested note that the Universal
application supports both Intel (`x86_64`) and Apple Silicon (`arm64`) Macs.

The documented floor matches electron-builder's
`mac.minimumSystemVersion: "12.0"`, and the architectures match the Universal
build produced by `pnpm run dist:mac`. macOS 11 Big Sur and older versions are
therefore not supported.

## Scope

This is a README-only change. It does not modify packaging, runtime behavior,
dependencies, or the existing macOS compatibility configuration.

## Verification

Confirm the README names macOS 12 Monterey as the minimum, identifies both CPU
architectures, and contains no claim of support for macOS 11 or older. Run the
existing package configuration test to confirm the documented requirements
remain aligned with the build configuration.
