# Weekly-Only Tray Presentation Design

## Goal

Make the menu-bar presentation more compact and readable when the selected
provider exposes only a seven-day quota window, while preserving every other
tray state exactly as it is.

## Trigger

The compact presentation applies only when normalized tray visibility is:

- session: hidden;
- weekly: visible.

Codex currently enters this state because app-server reports only its seven-day
window. Provider identity is not hard-coded; another provider would receive the
same presentation only if its visibility policy produced the same weekly-only
state. Claude's current policy always exposes both windows, so Claude remains
unchanged.

## Presentation

For the weekly-only state:

- hide the `7D` text label;
- increase the visible progress track from 60px to 90px, exactly 50%;
- retain the provider icon, percentage, progress fill, colors, spacing, and
  menu-bar height;
- render in the order icon, progress bar, percentage.

For session-only, dual-window, loading, and unavailable states, retain the
existing labels, 60px track width, spacing, and behavior.

## Architecture

Extend the pure tray-state selection layer with a presentation value derived
from existing visibility. The Electron/DOM renderer consumes this value to
toggle a weekly-only class on the weekly group. CSS under that class hides the
label and overrides only the weekly track width to 90px.

This keeps policy testable outside Electron and avoids duplicating the trigger
condition inside DOM rendering code.

## Tests

Regression tests will prove:

1. Codex weekly-only visibility selects compact weekly presentation.
2. Claude with the same null session data remains standard because its
   visibility policy exposes both rows.
3. Codex dual-window and session-only states remain standard.

The focused tray-state tests must fail before implementation and pass after it.
The full unit suite, typecheck, production bundle, and diff check must pass.

## Out of scope

- Popover layout or labels.
- Quota normalization, polling, caching, and provider visibility policy.
- Progress colors, percentages, menu-bar height, icons, and loading or
  unavailable states.
