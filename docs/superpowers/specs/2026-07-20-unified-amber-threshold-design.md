# Unified Amber Threshold Design

## Goal

Make the tray and popover quota bars use the same color thresholds:

- Green below 75%.
- Amber from 75% through 90%, inclusive.
- Red above 90%.

## Scope

Keep the tray implementation unchanged because it already follows these
boundaries. Change the popover renderer's amber lower bound from 70% to 75%.
Do not refactor the renderers or rewrite historical design documents.

## Verification

Add a focused renderer test that exercises the boundary values 74%, 75%, 90%,
and 91%. The expected classes are green, amber, amber, and red respectively.
Run the focused test, then the project's typecheck and full test suite.

