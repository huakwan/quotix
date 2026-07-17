# Codex Adaptive Monochrome Icon — Design

Date: 2026-07-17

## Goal

Replace the green Codex mark with an adaptive monochrome mark on both Quotix
surfaces: black in light appearance and white in dark appearance.

## Design

`assets/openai.svg` becomes the canonical black version of the mark. The icon
shape, view box, and dimensions remain unchanged.

The popover assigns a Codex-specific class to its source icon. Its existing
`prefers-color-scheme` styles leave the black asset unchanged in light mode and
apply `filter: invert(1)` in dark mode.

The tray capture page uses the same black SVG asset. Its render function already
receives the current native theme; it applies no filter for light appearance and
`invert(1)` for Codex in dark appearance. Claude keeps its current colored mark
and never receives the monochrome filter.

## Testing

Automated tests verify that:

- `assets/openai.svg` uses black and no longer contains the previous green;
- the popover emits the Codex-specific icon class and defines a dark-mode invert
  rule;
- the tray capture renderer applies theme inversion only to the Codex mark.

Run TypeScript type-checking, the complete Node test suite, and the production
bundle compile. No quota, polling, cache, preference, sizing, or layout behavior
changes are in scope.
