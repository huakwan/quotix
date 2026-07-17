# Native Popover Theme Design

Date: 2026-07-17

## Goal

Make the Quotix window visually match native macOS menu-bar popovers, using
Docker Desktop's dark popover in the supplied screenshot as the reference.
Preserve automatic light and dark appearance support.

## Current State and Root Cause

The renderer already follows the macOS appearance through
`prefers-color-scheme`. It defines separate foreground, muted, progress-track,
selected-control, and Codex-logo treatments for light and dark modes.

The window itself uses Electron's `menu` vibrancy material even though this
surface behaves as a popover. That material gives the transparent window a
stronger wallpaper tint and makes it look like a custom menu panel. Some CSS
colors also use generic white/black opacity values that do not preserve the
same visual hierarchy in both appearances.

## Chosen Direction

Use Electron's native macOS `popover` vibrancy material. Keep the panel
transparent so the system material supplies the background, blur, and tint.
On a white background, the target dark appearance is the darker neutral gray
shown by Docker Desktop rather than Quotix's current lighter gray. The native
material must provide that darker appearance; do not add an opaque graphite
overlay or a fixed background color to force an exact RGB value.

The application continues to follow the system appearance automatically. A
manual theme selector is out of scope.

## Window Material

In `src/ui/popoverWindow.ts`:

- Change `vibrancy` from `"menu"` to `"popover"`.
- Keep `visualEffectState: "active"`, transparency, native shadow, and rounded
  corners.
- Keep sizing, placement, show/hide behavior, and window security settings
  unchanged.

This lets macOS determine the final light or dark surface color and allows the
wallpaper to influence it in the same controlled way as other native
popovers.

## Theme Tokens

In `src/ui/popover.html`, retain semantic CSS variables and define complete
dark defaults plus light overrides for:

- primary text;
- secondary and tertiary text;
- progress and segmented-control tracks;
- separators;
- selected segmented-control fill and border/shadow;
- hover and pressed control fills.

Dark mode will use neutral translucent whites over the system material. Light
mode will use translucent blacks and a softly translucent selected-control
surface rather than a hard white chip. Progress status colors remain the
existing macOS green, amber, and red values.

The Codex logo remains white in dark mode and dark in light mode. Typography,
spacing, content, and interaction behavior do not change.

## Appearance Flow

macOS appearance changes are exposed to Chromium as
`prefers-color-scheme`. CSS media-query overrides update immediately without
an application restart. The BrowserWindow vibrancy material follows the same
system appearance, so the background and content remain synchronized.

No theme state is persisted and no new IPC channel is required.

## Testing

Add source-level regression tests that verify:

1. the BrowserWindow uses `vibrancy: "popover"` and keeps the active visual
   effect;
2. the stylesheet defines automatic light-mode overrides;
3. all key semantic tokens have both dark and light treatments;
4. the panel remains transparent so native vibrancy is visible.

Run the complete unit suite, typecheck, and production compile. Because native
vibrancy cannot be rendered accurately in Node tests, perform a manual macOS
check in both system appearances and compare dark mode with the supplied
Docker Desktop reference.

## Non-goals

- A manual Light/Dark/System preference.
- Layout, dimensions, copy, or quota behavior changes.
- A fixed opaque background color.
- Platform support beyond the existing macOS target.
