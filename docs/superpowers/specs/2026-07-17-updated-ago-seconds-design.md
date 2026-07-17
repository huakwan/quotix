# Updated Ago Seconds Design

## Goal

Make recent quota refresh timestamps more informative without changing the existing minute, hour, or day formatting.

## Behavior

- Ages from 0 through 5 seconds display `Updated just now`.
- Ages from 6 through 59 seconds display `Updated x sec ago`, where `x` is the whole elapsed-second value.
- Ages of 60 seconds or more retain the existing minute, hour, and day formatting.
- Future timestamps continue to be clamped to an age of 0 seconds and display `Updated just now`.

## Implementation

Keep the change local to `updatedAgo` in `src/ui/popoverRenderer.ts`. Add a direct condition for the 0–5 second range followed by a condition for the 6–59 second range. Do not refactor the formatter into another module or introduce localization machinery.

## Testing

Add focused regression coverage for the boundaries at 5, 6, 59, and 60 seconds. The tests must demonstrate the new second-level behavior while confirming the existing minute transition remains unchanged.

## Scope

Preserve all unrelated working-tree changes, including the existing import-order and reset-date formatting edits in `src/ui/popoverRenderer.ts`.
