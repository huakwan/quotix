# CLAUDE.md

## Commands

```bash
pnpm install
pnpm run compile
pnpm run typecheck
pnpm test
pnpm run watch
pnpm start
pnpm run dist:mac
```

Tests use Node's built-in test runner. TypeScript production modules are emitted
to `out/` before tests import them.

## Architecture

Quotix is a macOS-only Electron menu bar app. `src/main.ts` is the composition
root and all quota data flows through a provider framework:

1. `src/quota/provider.ts` — common Claude/Codex adapter contract.
2. `src/quota/sourceRuntime.ts` — per-source cache, loading, in-flight,
   consecutive rate-limit, and backoff state.
3. `src/quota/coordinator.ts` — source lifecycle and concurrent polling.
4. `src/quota/claude/` — Keychain credential provider and Anthropic OAuth usage
   adapter. Preserve sync startup seed, async credential refresh, 401
   invalidation, and safe diagnostics.
5. `src/quota/codex/` — executable discovery, newline-delimited JSON-RPC
   app-server client, and rate-limit mapping. Always dispose the child process.
6. `src/preferences.ts` — validated JSON settings under Electron user data.
7. `src/ui/` — pure tray/popover selectors plus Electron/DOM renderers.

The normal poll interval is two minutes for both providers. Each
`SourceRuntime` keeps independent last-good quota and capped exponential 429
backoff. Manual refresh does not bypass active backoff.

Never log or persist OAuth tokens, Keychain output, Codex credentials, or raw
app-server payloads. Cache only normalized quota fields.
