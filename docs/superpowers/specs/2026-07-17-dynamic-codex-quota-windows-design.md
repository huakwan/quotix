# Dynamic Codex Quota Windows Design

## Goal

Render the quota windows that Codex actually reports. The current Codex
app-server response contains one 10,080-minute window, so Quotix must classify
it as the seven-day window and show only `7D` for Codex. Claude behavior remains
unchanged when both of its existing windows are present.

## Data normalization

`quotaFromCodexRateLimits()` will inspect both `primary` and `secondary` instead
of assuming that primary always means session and secondary always means
weekly.

- A window with `windowDurationMins >= 10,080` is classified as `weekly`.
- A shorter positive duration is classified as `session`.
- For legacy payloads without `windowDurationMins`, retain the existing mapping:
  primary to session and secondary to weekly.
- Invalid windows remain absent. If two valid windows classify to the same slot,
  preserve the first one in app-server order rather than replacing it.

This keeps the shared `Quota` contract stable while correctly mapping the new
single-window response.

## Presentation

Both presentation surfaces will be driven by normalized window availability.

- The menu-bar renderer shows the `5H` group only when `session` is non-null and
  the `7D` group only when `weekly` is non-null.
- The popover builds rows only for non-null windows.
- Loading and unavailable states are unchanged.
- Claude still shows both rows when its response contains both windows.

No provider-specific `Codex => 7D only` hard-code is added. If Codex reports a
shorter window again, it will reappear automatically.

## Compatibility and errors

Cached quota files require no migration because the normalized shape is
unchanged. A cached Codex value produced before this change may display the old
mapping until the next successful poll replaces it; normal startup polling
already performs that refresh. Missing or malformed duration metadata uses the
legacy fallback and never prevents the provider from returning otherwise valid
quota data.

## Tests and documentation

Regression coverage will verify:

1. A single 10,080-minute primary Codex window maps to `weekly`, with `session`
   absent.
2. Shorter-duration and legacy dual-window payloads keep the intended mapping.
3. Presentation row selection omits absent windows and retains both Claude rows.

The README feature description will state that Codex displays the quota windows
reported by app-server rather than promising both 5-hour and 7-day windows.

## Out of scope

- Changing Claude OAuth normalization.
- Changing polling, backoff, caching, preferences, colors, or reset formatting.
- Adding new domain slots for daily, monthly, credits, or model-specific limits.
