# Quotix

Show Claude Code and Codex usage quota in the macOS menu bar.

Quotix is a small Electron menu bar app that polls the local signed-in sessions
used by Claude Code and Codex. The menu bar shows one source; clicking it opens
a popover with Claude, Codex, or both.

## Features

- Claude 5-hour/session and 7-day/weekly quota bars, plus the quota windows
  currently reported by Codex
- Popover source setting: `Claude`, `Codex`, or `Both`
- Independent menu-bar source setting while `Both` is selected
- Shared two-minute poll cadence with independent in-flight and rate-limit state
- Separate last-good caches so one provider's failure never hides the other
- Live reset countdown or wall-clock reset time
- Pace line marker on each bar, showing how much of the window has elapsed so
  you can compare actual usage against an even burn rate (toggle on/off)
- Light and dark theme that follows the macOS system appearance
- Menu-bar-only macOS app with no dock icon

Defaults are `Source: Both`, `Menu bar: Claude`, `Reset time: Countdown`, and
`Pace line: On`. When a single source is selected, the menu bar automatically
follows that source. Returning to Both restores the last explicit menu-bar
choice.

## Requirements

- macOS
- Node.js and pnpm for development
- Claude: sign in once with Claude Code so its OAuth credential exists in
  macOS Keychain
- Codex: sign in with Codex CLI or the official OpenAI VS Code extension

Codex executable discovery checks `CODEX_PATH`, official OpenAI extensions in
VS Code-compatible extension directories, `PATH`, and common CLI install
locations. Codex quota is read through `codex app-server --stdio`; Quotix never
stores account credentials or raw app-server payloads.

## Getting started

```bash
pnpm install
pnpm start
```

## Scripts

| Script | Description |
| --- | --- |
| `pnpm run compile` | Bundle the Electron main, preload, and popover renderer files. |
| `pnpm run typecheck` | Run strict TypeScript checking without emitting files. |
| `pnpm test` | Compile TypeScript to `out/` and run the Node unit suite. |
| `pnpm run watch` | Rebuild bundles continuously. |
| `pnpm start` | Compile and launch Quotix. |
| `pnpm run dist:mac` | Build an unpacked macOS `.app`. |

## Architecture

- `src/quota/provider.ts` defines the common provider contract.
- `src/quota/sourceRuntime.ts` owns per-provider cache, loading, in-flight, and
  backoff state.
- `src/quota/coordinator.ts` enables providers and polls them concurrently.
- `src/quota/claude/` reads Keychain credentials and Anthropic OAuth usage.
- `src/quota/codex/` discovers Codex, manages app-server JSON-RPC, and maps
  account rate limits.
- `src/preferences.ts` validates and persists source/menu/reset/pace-line settings.
- `src/main.ts` composes Electron, providers, tray, popover, and IPC.

Only successful normalized quota data is cached. Claude and Codex caches are
separate, and the legacy Claude cache is still accepted as a startup fallback.
