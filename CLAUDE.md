# CLAUDE.md

## Commands

```bash
pnpm install
pnpm run compile
pnpm run typecheck
pnpm test
pnpm run watch
pnpm run dev
pnpm run dist:mac
```

Tests use Node's built-in test runner. TypeScript production modules are emitted
to `out/` before tests import them.

## Architecture

Quotix is a macOS-only Electron menu bar app. `src/main.ts` is the composition
root and all quota data flows through a provider framework:

1. `src/quota/provider.ts` — common Claude/Codex/OpenCode adapter contract.
2. `src/quota/sourceRuntime.ts` — per-source cache, loading, in-flight,
   consecutive rate-limit, and backoff state.
3. `src/quota/coordinator.ts` — source lifecycle and concurrent polling.
4. `src/quota/claude/` — Keychain credential reader and Anthropic OAuth usage
   adapter. Preserve sync startup seed, async re-read, 401 invalidation, and safe
   diagnostics. Quotix only observes the credential the Claude Code CLI owns: it
   never refreshes the OAuth token and never writes the Keychain item. Refreshing
   rotates a refresh token shared with the CLI, and a rotation that loses the race
   has no local recovery. An expired token is reported as expired; the next read
   picks up whatever the CLI wrote. Each failure reason gets its own message —
   never collapse them into one.
5. `src/quota/codex/` — executable discovery, newline-delimited JSON-RPC
   app-server client, and rate-limit mapping. Always dispose the child process.
6. `src/quota/opencode/` — OpenCode CLI `auth.json` reader (`$XDG_DATA_HOME/opencode`,
   else `~/.local/share/opencode`) and the OpenCode Go usage adapter. Quotix only
   reads the key the CLI owns; it never writes or renews it. The endpoint reports
   dollar-denominated `rolling` (5-hour), `weekly`, and `monthly` windows, mapped
   onto the shared `session`, `weekly`, and `monthly` quota windows. Prefer the
   `opencode-go` entry and fall back to `opencode`, because a Zen key reads the
   same account. Each credential failure reason gets its own message.
7. `src/preferences.ts` — validated JSON settings under Electron user data.
   `sources` is a multi-select list of `ProviderId` kept in `PROVIDER_IDS` order and
   never empty; legacy single-`source` settings (including `"both"`) still migrate on
   read. The menu-bar source falls back to the first enabled source and its picker is
   hidden when only one source is on. Adding a source should only mean a new id in
   `PROVIDER_IDS` plus a runtime factory, a logo, and a button in the popover rows.
8. `src/ui/` — pure tray/popover selectors plus Electron/DOM renderers.
   `src/ui/branding.ts` maps a provider to its label, its asset, and whether its
   mark is a black glyph that needs inverting in dark mode.

The normal poll interval is five minutes for every provider. Each
`SourceRuntime` keeps independent last-good quota and capped exponential 429
backoff. Scheduled polls respect active backoff; manual refresh can make one
immediate recovery attempt, while the in-flight guard still deduplicates requests.

Never log or persist OAuth tokens, Keychain output, Codex credentials, OpenCode API
keys, or raw app-server payloads. Cache only normalized quota fields.

## UI interaction rules

Buttons must never retain focus. Keep every button out of the tab order,
prevent mouse presses from assigning focus, and clear any programmatic or
browser-assigned focus immediately on mouse release and click.

## User workflow preference

For small, clearly scoped edits, implement the change directly without using
Superpowers workflows or writing design and implementation plan documents.
Use the full Superpowers workflow only for larger work that affects multiple
files, creates several files, or requires significant design or coordination.
