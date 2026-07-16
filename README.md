# Quotix

Show Claude Code usage quota in the macOS menu bar.

Quotix is a small Electron menu bar app that reads your Claude Code OAuth
credentials from the macOS Keychain, polls the Anthropic usage API, and
displays your session and weekly quota utilization right in the menu bar.

## Features

- Live session (5-hour) quota bar with percent used and time until reset
- Tooltip with session + weekly utilization and last-updated timestamp
- Reads the same credentials Claude Code already stores in Keychain — no
  extra login step
- Backs off automatically on rate limits (`429`) and clears stale tokens on
  `401`
- Menu bar only — no dock icon, no windows

## Requirements

- macOS (reads credentials via the `security` CLI / Keychain — this is the
  only supported platform)
- Node.js
- An active Claude Code login (so `Claude Code-credentials` exists in
  Keychain)

## Getting started

```bash
npm install
npm start
```

`npm start` compiles the TypeScript sources with esbuild and launches the
Electron app.

## Scripts

| Script          | Description                                      |
| --------------- | ------------------------------------------------- |
| `npm run compile` | Bundle `src/main.ts` to `dist/main.js` via esbuild |
| `npm run watch`   | Same as `compile`, but watches for changes         |
| `npm start`       | Compile, then launch the Electron app              |
| `npm run dist:mac` | Compile, then package a `.app` with electron-builder (unpacked dir target) |

## How it works

- `src/oauthCredentials.ts` — reads the `Claude Code-credentials` entry from
  Keychain (sync read on startup, async refresh in the background) and
  extracts the OAuth access token
- `src/oauthSource.ts` — calls `https://api.anthropic.com/api/oauth/usage`
  with that token and maps the response (or errors/rate limits) into a
  `ReadResult`
- `src/model.ts` — shapes the raw API usage payload into session/weekly
  `Quota` windows
- `src/render.ts` — formats quota data into the tray title/tooltip text
  (progress bar, percentage, countdown)
- `src/main.ts` — wires it together: polls on an interval, renders to the
  `Tray`, and re-renders every 10s so the countdown stays live between polls

## Notes

- Quotix only reads your local Keychain entry; it does not store or
  transmit credentials anywhere beyond the standard Anthropic API request.
- Packaging (`npm run dist:mac`) currently targets an unpacked `.app`
  directory, not a signed/notarized installer.
