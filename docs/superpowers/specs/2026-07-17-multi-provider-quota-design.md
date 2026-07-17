# Quotix Multi-Provider Quota — Design

Date: 2026-07-17

## Goal

Add Codex quota as a second AI-agent source and refactor Quotix around a
provider framework shared by Claude and Codex.

Users can choose whether the popover displays Claude, Codex, or both. The menu
bar displays one source at a time: it follows the selected source when only one
is enabled, and is independently selectable when both are enabled. Both
providers use the same two-minute polling interval while retaining independent
request state, backoff, and last-good caches.

## User-Visible Defaults and Rules

Preferences use these types and defaults:

```ts
type DisplaySource = "claude" | "codex" | "both";
type SingleSource = "claude" | "codex";
type ResetMode = "countdown" | "clock";

interface Preferences {
  source: DisplaySource;          // default: "both"
  menuBarSource: SingleSource;    // default: "claude"
  resetMode: ResetMode;           // default: "countdown"
}
```

The effective menu-bar source follows these rules:

- `source = "claude"`: display and poll Claude; the menu bar shows Claude.
- `source = "codex"`: display and poll Codex; the menu bar shows Codex.
- `source = "both"`: display and poll both; the menu bar shows the persisted
  `menuBarSource`.

Changing away from `both` does not overwrite the persisted `menuBarSource`.
Returning to `both` restores the user's last explicit menu-bar choice.

## Architecture

Refactor `src/quota/` into shared domain infrastructure and provider-specific
adapters:

```text
src/quota/
├── model.ts
├── provider.ts
├── cache.ts
├── sourceRuntime.ts
├── coordinator.ts
├── claude/
│   ├── credentials.ts
│   └── provider.ts
└── codex/
    ├── appServer.ts
    ├── executable.ts
    └── provider.ts
```

### Provider contract

All external quota sources implement this shared contract:

```ts
type ProviderId = "claude" | "codex";

interface QuotaProvider {
  readonly id: ProviderId;
  read(nowSec: number): Promise<ProviderReadResult>;
  dispose(): void;
}

type ProviderReadResult =
  | { ok: true; quota: Quota }
  | {
      ok: false;
      kind: "missing" | "auth" | "rate-limited" | "transient";
      error: string;
      retryAfterSeconds?: number;
    };
```

The shared provider result distinguishes successful quota data, unavailable
configuration or credentials, transient failure, rate limiting, and diagnostic
information. Provider-specific credentials, process handles, HTTP responses,
and raw protocol payloads do not escape the adapter.

### Source runtime

`SourceRuntime` wraps one provider with the common operational behavior. Each
runtime owns its provider's loading flag, in-flight guard, last result,
last-good quota, consecutive rate-limit count, backoff deadline, and cache.
It emits a new `SourceState` whenever any of those user-visible values change.

On a rate-limited result, the runtime uses the provider's
`retryAfterSeconds` (or 60 seconds when absent), applies exponential delay for
consecutive rate limits, and caps the result at ten minutes. A successful read
resets the consecutive rate-limit count and backoff deadline. This mechanism is
shared, but its state is separate for every runtime.

### Quota coordinator

`QuotaCoordinator` owns provider lifecycle and exposes a combined snapshot:

```ts
interface QuotaSnapshot {
  claude: SourceState;
  codex: SourceState;
}
```

It is responsible for:

- constructing and disposing providers as preferences enable or disable them;
- creating one `SourceRuntime` per enabled provider;
- loading each runtime's last-good cache before its first network/process
  request;
- polling all enabled providers concurrently at the shared two-minute cadence;
- immediately polling a provider when it becomes enabled;
- refreshing all currently enabled providers from the refresh action;
- notifying the Electron composition layer when the combined snapshot changes.

Provider failures are isolated. A slow, unavailable, or rate-limited Codex
request cannot block Claude from polling or rendering, and vice versa.

### Composition root

`src/main.ts` becomes a thin composition root. It loads preferences, creates
the coordinator, subscribes to snapshots, selects the effective source for the
tray, forwards combined state to the popover, handles IPC, and disposes
resources during application shutdown.

## Provider Behavior

### Claude

The Claude adapter preserves the existing behavior:

- read Claude Code OAuth credentials from macOS Keychain;
- retain the synchronous startup seed and asynchronous credential refresh;
- call Anthropic's OAuth usage endpoint;
- invalidate the cached credential after HTTP 401;
- return HTTP 429 `retry-after` to the shared runtime for capped exponential
  backoff;
- use the existing request timeout and safe network-error diagnostics.

The existing `five_hour` and `seven_day` response fields continue mapping to
the shared session and weekly quota windows.

### Codex

The Codex adapter is based on the sibling `ai-quota` project's implementation.
It starts `codex app-server --stdio`, initializes the JSON-RPC session, and
calls `account/rateLimits/read`. Codex `primary` and `secondary` windows map to
the shared session and weekly quota windows.

The app-server client:

- reuses one child process across polls;
- correlates JSON-RPC responses by request ID;
- ignores non-response notifications and malformed output lines;
- uses a 60-second request timeout;
- rejects pending requests when the process exits;
- terminates and lazily recreates the process after timeout or fatal process
  failure;
- disposes the process when Codex is disabled or Quotix exits.

Codex executable discovery checks, in order:

1. `CODEX_PATH`;
2. platform-appropriate bundled executables inside installed official OpenAI
   VS Code extensions found in known VS Code-compatible extension directories;
3. `PATH`;
4. common CLI locations including `~/.local/bin`, `~/.codex/bin`, Homebrew,
   pnpm, Bun, and Volta locations;
5. the bare `codex` command as a final fallback, allowing a missing executable
   to surface as a normal `ENOENT` unavailable state.

Codex rate-limit errors expose a returned retry duration when available. The
shared runtime uses a default 60-second base delay otherwise, applies capped
exponential backoff, and keeps Codex's backoff state independent from Claude.

## Polling and Refresh Semantics

The common normal poll interval remains the current two minutes. Both sources
use that value; there is no new interval setting in this scope.

When `source = "both"`, the coordinator starts Claude and Codex polls
concurrently on each normal polling cycle. Each source runtime owns its
in-flight guard and rate-limit backoff deadline. A runtime still inside active backoff
returns its cached state without making a new external request.

The refresh button and tray context-menu refresh action request a refresh of
every enabled provider. Manual refresh respects active provider backoff so it
does not amplify rate limiting. Enabling a previously disabled source loads its
cache immediately and triggers a poll without waiting for the next interval.

## Cache and Preferences

### Last-good quota cache

Use a generic JSON cache store keyed by provider. Claude and Codex persist to
separate files so their data can never overwrite each other. Only successful,
validated quota responses replace cached quota. Transient HTTP, network,
process, authentication, or protocol failures do not erase last-good data.

The cache contains only normalized quota fields: `updatedAt`, session, weekly,
and plan detection. It never contains OAuth tokens, Keychain output, Codex
account credentials, or raw app-server payloads.

The current Claude cache remains readable through a one-time compatibility
path. When a valid legacy cache exists and the new Claude-specific cache does
not, it is used as Claude's initial last-good state and saved in the new format
after the next successful Claude poll.

### Preferences

Move preferences into one validated JSON file under
`app.getPath("userData")`. This gives the main process a single source of truth
at startup. Invalid or missing fields fall back independently to the defaults,
and read/write failures are best-effort and must never crash the application.

The renderer's existing reset-time choice moves from `localStorage` into this
preferences file. On first run after the change, if no main-process reset
preference exists, the default is `countdown`; migration of renderer-only
`localStorage` is not required because it is not reliably available to the main
process before the popover loads.

## UI Design

### Popover

The popover adds two segmented settings alongside the current reset-time
setting:

- **Source:** Claude / Codex / Both.
- **Menu bar:** Claude / Codex, visible only while Source is Both.

Selecting a single source renders one quota section. Selecting Both renders
two vertically stacked sections in stable Claude-then-Codex order. Each section
contains:

- the source name and source-specific mark;
- 5H and 7D quota rows using the existing progress-bar and threshold colors;
- its own updated-age text;
- an independent loading, unavailable, or error state.

The existing `ResizeObserver` continues fitting the window to its content, so
the window grows and shrinks when the source choice or error state changes.

Claude keeps the current Anthropic mark. Codex uses an OpenAI mark bundled as a
local application asset; no remote UI resource is loaded at runtime.

Changing any setting sends a typed IPC message to the main process. The main
process validates and persists it, updates provider lifecycle if necessary,
and broadcasts the authoritative preferences and snapshot back to the
renderer. The renderer does not optimistically become the source of truth.

### Menu bar

The tray renderer takes one `SourceState` and a provider identity. It preserves
the existing inline 5H/7D bars, colors, loading state, and unavailable state,
while switching the mark and source-specific diagnostics.

When Both is active, Quotix does not automatically fail over the menu bar to
the other source. If the selected menu-bar source is unavailable, the menu bar
shows that source's unavailable state; the other source remains visible in the
popover.

### Existing actions

- Left-click continues toggling the popover.
- Right-click continues opening Refresh now / Quit.
- Refresh updates every enabled source.
- Quit disposes the coordinator and child process before application exit.

## IPC and Data Flow

The renderer receives this payload:

```ts
interface PopoverPayload {
  snapshot: QuotaSnapshot;
  preferences: Preferences;
  nowSec: number;
}
```

The preload bridge exposes narrowly scoped methods for subscribing to updates,
changing `source`, changing `menuBarSource`, changing `resetMode`, refreshing,
quitting, and reporting content height. IPC inputs are validated in the main
process before use.

Data flows in one direction:

```text
preferences ──► coordinator ──► provider polls ──► QuotaSnapshot
     ▲                                              │
     │                                              ├──► tray renderer
popover setting IPC                                 └──► popover update IPC
```

## Error and Loading States

Every source renders independently:

- **No cache, request active:** loading.
- **Missing credential/executable with no cache:** source-specific unavailable
  explanation.
- **Transient error with last-good cache:** show cached quota at normal opacity
  and preserve its original `updatedAt`.
- **HTTP 401 for Claude:** invalidate the credential and retry through the
  normal credential-refresh path while retaining last-good quota.
- **Rate limited:** retain last-good quota and retry after the independent
  provider backoff.
- **Codex process failure:** retain last-good quota, tear down the failed
  process, and recreate it lazily on a later eligible poll.

One source's error never replaces, hides, or changes the other source's state.
Logs and UI diagnostics must not expose tokens, raw credential content, or full
app-server messages.

## Testing and Verification

Add a Node-based automated test setup and cover pure modules and injected
runtime dependencies without launching Electron where practical:

1. Claude OAuth response mapping and current HTTP error behavior.
2. Codex rate-limit response mapping, JSON-RPC initialization, request
   correlation, timeout, process exit, and disposal.
3. Codex executable discovery precedence, including mocked VS Code extension
   directories and platform variants.
4. Generic per-provider cache isolation, validation, and legacy Claude cache
   compatibility.
5. Preference defaults, validation, persistence, and effective menu-bar source
   rules.
6. Coordinator behavior for Claude, Codex, Both, concurrent polling,
   independent in-flight guards/backoff, enable/disable lifecycle, and refresh.
7. Tray renderer selection and source-specific loading/unavailable states.
8. Popover rendering for single-source, both-source, mixed success/error, and
   settings visibility.

Run the automated tests, TypeScript type-check, and production bundle compile.
Then manually smoke-test the packaged Electron UI on macOS for tray capture,
source switching, popover auto-resize, child-process cleanup, persistence across
restart, and both light and dark appearance.

## Out of Scope

- Configurable poll interval UI.
- Automatic menu-bar failover between providers.
- Additional quota providers beyond Claude and Codex.
- Authentication or sign-in flows managed by Quotix.
- Displaying Codex account identity, credits, model names, or quota windows
  beyond the shared primary/secondary mapping.
- Remote assets or network-loaded UI resources.
