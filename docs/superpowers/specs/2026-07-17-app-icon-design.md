# Quotix macOS App Icon Design

**Date:** 2026-07-17  
**Status:** Approved

## Goal

Replace Electron's default application icon with a distinctive Quotix icon that remains legible at all standard macOS icon sizes and is embedded in packaged `Quotix.app` builds.

## Scope

This change covers the macOS application icon only. It does not change the dynamic menu-bar tray graphic, application behavior, signing, notarization, or distribution format.

## Visual Design

The selected direction is **Quota Q — Graphite**:

- A macOS-style rounded-square silhouette.
- A graphite gradient running from a lighter charcoal at the upper edge to near-black at the lower edge.
- A white capital `Q` constructed from a circular quota/progress ring with a deliberate gap and a diagonal tail.
- No text, small labels, shadows with fine detail, or secondary symbols.
- Optical adjustments at the smallest raster sizes may increase stroke weight and simplify the gradient so the mark stays recognizable.

The icon should have sufficient transparent margin around the rounded square to fit macOS icon conventions without appearing larger than neighboring application icons.

## Assets

The repository will contain:

- An editable vector source for the approved icon under `assets/`.
- A generated macOS `.icns` file under `assets/` containing the standard 16, 32, 64, 128, 256, 512, and 1024 pixel representations, including Retina variants where required by the iconset format.

The vector source is the design source of truth. The `.icns` file is the packaging input and should be regenerated from that source when the design changes.

## Build Integration

Electron Builder's macOS configuration in `package.json` will explicitly reference the generated `.icns` asset. Existing build commands remain unchanged:

```text
make dist-mac
```

The packaged result remains an unpacked application at `dist/mac-arm64/Quotix.app` on the current Apple Silicon environment.

## Verification

Implementation is complete when all of the following are true:

1. The source SVG and generated `.icns` exist and are valid image files.
2. The project compiles successfully.
3. `make dist-mac` completes successfully.
4. The packaged application's `Info.plist` references the custom icon.
5. The icon resource exists inside `Quotix.app/Contents/Resources`.
6. A rendered preview of the packaged icon matches the approved Quota Q Graphite design and remains readable at 16, 32, and 128 pixels.

## Error Handling

Icon generation must fail visibly if a required raster size cannot be produced; it must not silently package a partial iconset. Packaging verification must also fail if Electron Builder falls back to its default icon or omits the icon resource.

## Out of Scope

- Changing the tray/menu-bar graphic.
- Windows or Linux icons.
- A `.dmg`, installer background, code signing, or notarization.
- Rebranding other UI artwork such as `assets/anthropic.svg`.
