# Package Size Reduction Design

## Problem

The macOS directory build is 573 MB. The application source is compiled into
`dist`, while electron-builder also writes packaged output to `dist`. Because
the package file pattern includes `dist/**/*`, the generated
`dist/mac-arm64/Electron.app` is copied into `app.asar`. The 311 MB archive
therefore contains a second Electron runtime.

## Goals

- Keep packaged artifacts outside the compiled application directory.
- Prevent old or future packaged artifacts and source maps from entering ASAR.
- Package only runtime assets.
- Keep only English and Thai Electron locales.
- Preserve the current app entry point and runtime behavior.
- Add an automated regression check for the packaging configuration.

## Considered Approaches

1. Add only an exclusion for `dist/mac-arm64`. This is the smallest change, but
   retains the unsafe arrangement where compiled files and packaged output share
   a directory and can regress for another architecture or target.
2. Move electron-builder output to `release` and use explicit file sets. This
   separates build stages and makes the package boundary clear. This is the
   selected approach.
3. Replace Electron with Tauri or a native macOS implementation. This would
   reduce the baseline runtime size substantially, but is a product rewrite and
   is outside this fix.

## Design

`esbuild` will continue writing runtime code to `dist` so the existing
`main: dist/main.js` contract remains unchanged. electron-builder will write
packaged products to `release`.

The electron-builder `files` setting will use explicit file-set mappings:

- Copy runtime files from `dist` to `dist` inside the package.
- Exclude source maps and any legacy `mac-*` packaged-output directories.
- Copy only `anthropic.svg` and `openai.svg` from `assets` because these are the
  only assets loaded by runtime code.

The macOS application icon remains configured through `mac.icon`; it does not
need to be copied again as an application asset. `poster.png` is README artwork
and will not be packaged.

Electron locales will be limited to `en` and `th`. This retains the expected
locales for the app while removing unused Chromium translations.

## Testing and Verification

Add a unit test that reads `package.json` and asserts:

- electron-builder output is `release` rather than `dist`;
- packaged file sets are explicit;
- source maps and legacy macOS output are excluded;
- only runtime assets are copied;
- Electron locales are `en` and `th`.

The test must fail against the current configuration before the config changes.
After implementation, run type checking, the complete unit suite, and a real
macOS directory build. Inspect the resulting `app.asar` to confirm it contains
no `.app`, `mac-arm64`, source map, or README poster entries, and report the
fresh on-disk size.

## Success Criteria

- The macOS directory build succeeds.
- The resulting ASAR does not contain a nested Electron application.
- The output is materially smaller than the current 573 MB build.
- Existing tests and type checking pass.
