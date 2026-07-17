# Provider-Specific Quota Visibility Design

## Goal

Keep Claude's established two-window presentation while allowing Codex to show
only the quota windows returned by app-server.

## Root cause

The dynamic Codex change introduced shared availability helpers that hide every
null quota window. Those helpers do not consider provider identity, so a missing
Claude session window also hides Claude's `5H` row. The Codex-specific display
policy was unintentionally applied to both providers.

## Design

Make both UI selection helpers provider-aware and keep the policy in pure state
modules:

- Claude always selects `5H` and `7D`. A missing window remains visible with the
  existing `--%` and `--` reset presentation.
- Codex selects only non-null normalized windows. With the current app-server
  response, Codex selects only `7D`.
- The popover renderer consumes provider-aware row selection.
- The menu-bar renderer consumes provider-aware visibility flags.

The behavior belongs in shared selection helpers rather than duplicated
conditionals inside the DOM and tray renderers.

## Interfaces

- Change `availableQuotaRows(quota)` to
  `quotaRowsForProvider(provider, quota)`. Its row window becomes nullable so
  Claude placeholder rows can use the existing `rowHtml()` null handling.
- Keep `trayWindowVisibility(display)` but make its result provider-aware using
  `display.provider`.

## Tests

Regression tests will prove:

1. Claude selects both rows when only weekly data exists.
2. Codex selects only `7D` for the same normalized quota.
3. Claude menu-bar visibility is both true when session is null.
4. Codex menu-bar visibility remains weekly-only.

Focused tests must fail under the current provider-agnostic implementation,
then pass after the helper and renderer changes. The full unit suite, typecheck,
and production bundle must pass.

## Out of scope

- Codex duration normalization and legacy fallback.
- Claude OAuth normalization.
- Polling, caching, preferences, colors, labels, and reset formatting.
