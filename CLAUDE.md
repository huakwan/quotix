# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # install deps
npm run compile      # bundle src/main.ts -> dist/main.js via esbuild
npm run watch        # same, watch mode
npm start            # compile, then launch the Electron app
npm run dist:mac      # compile, then package unpacked .app via electron-builder
```

There is no test suite, lint config, or typecheck script in this repo — `tsconfig.json` exists only for editor/type-checking support, not a build step (esbuild does the actual bundling and does not type-check).

## Architecture

Quotix is a macOS-only Electron menu bar app with no windows/renderer process — everything runs in the main process (`src/main.ts`). Data flows in one direction through four modules:

1. **`src/oauthCredentials.ts`** — reads the `Claude Code-credentials` Keychain entry (same credentials Claude Code CLI itself uses) via the `security` CLI. `createCachedTokenProvider()` seeds a token synchronously at startup (so first paint isn't blocked), then refreshes asynchronously in the background on a timer (`refreshMs`, default 30s) so `get()` never blocks the event loop. `invalidate()` forces an immediate async refresh (used after a 401).
2. **`src/oauthSource.ts`** — `fetchOAuthQuota()` calls `https://api.anthropic.com/api/oauth/usage` with the token and maps the response into a `ReadResult`. Handles `401` (marks `tokenInvalid: true` so the caller invalidates the cached token), `429` (reads `retry-after` header, backs off up to `MAX_RATE_LIMIT_BACKOFF_SECONDS`), and network/timeout errors distinctly.
3. **`src/model.ts`** — pure mapping from the raw `/oauth/usage` JSON shape (`five_hour` / `seven_day`) into typed `Quota` windows (`session`, `weekly`), each with `usedPct` and `resetsAt`.
4. **`src/render.ts`** — pure formatting functions (`trayTitle`, `trayTooltip`, `bar`, `countdown`) that turn a `ReadResult` into the plain-text strings shown in the tray. Deliberately plain text only — no codicons or theme colors, since `Tray.setTitle()`/`setToolTip()` are OS-native, unlike a VSCode extension's UI.

`src/main.ts` wires these together: an interval loop calls `poll()`, which pulls the token from the cached provider, fetches quota, updates `lastResult`, and re-renders the tray; a separate faster interval (`RENDER_TICK_SECONDS`) re-renders on its own so the countdown timer stays live between polls. The poll interval is dynamic — it uses `retryAfterSeconds` from a 429 response when present, otherwise `REFRESH_INTERVAL_SECONDS`.

When changing `oauthCredentials.ts` or `oauthSource.ts`, keep the sync-seed/async-refresh split and the distinct 401/429 handling — the poller depends on `tokenInvalid` and `retryAfterSeconds` to self-correct without user intervention.
