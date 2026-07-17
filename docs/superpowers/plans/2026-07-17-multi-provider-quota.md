# Multi-Provider Quota Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor Quotix into a provider framework that polls and displays Claude, Codex, or both, with independent last-good caches and a selectable menu-bar source.

**Architecture:** Pure shared modules define preferences, provider results, cache validation, source runtime, and coordinator behavior. Claude and Codex adapters isolate Keychain/HTTP and app-server details. Electron `main.ts` composes providers and sends one authoritative snapshot/preferences payload to the tray and popover.

**Tech Stack:** TypeScript 6, Electron 43, Node 20 test runner, esbuild, macOS Keychain, Codex app-server JSON-RPC over stdio.

## Global Constraints

- Default `source` is `"both"`; default `menuBarSource` is `"claude"`; default `resetMode` is `"countdown"`.
- The normal polling interval remains exactly two minutes for both providers.
- Claude and Codex keep independent in-flight, backoff, and last-good cache state.
- Rate-limit backoff uses `retry-after` or 60 seconds, exponential consecutive delay, and a ten-minute cap.
- Codex requests time out after 60 seconds.
- Never persist or log OAuth tokens, Keychain blobs, account credentials, or raw app-server payloads.
- Manual refresh respects active backoff.
- The app remains macOS-only and menu-bar-only.

---

## File Map

- `src/quota/model.ts`: shared provider IDs, quota, results, source state, and snapshots.
- `src/preferences.ts`: validated preferences, effective tray-source rule, JSON persistence.
- `src/quota/cache.ts`: provider-keyed normalized JSON cache with legacy Claude fallback.
- `src/quota/provider.ts`: provider adapter contract.
- `src/quota/sourceRuntime.ts`: generic cache/in-flight/backoff/last-good state machine.
- `src/quota/coordinator.ts`: enabled provider lifecycle and concurrent shared-cadence polling.
- `src/quota/claude/credentials.ts`: existing Keychain token provider moved without behavior changes.
- `src/quota/claude/provider.ts`: Claude OAuth adapter.
- `src/quota/codex/executable.ts`: executable and VS Code extension discovery.
- `src/quota/codex/appServer.ts`: JSON-RPC child-process client.
- `src/quota/codex/provider.ts`: Codex rate-limit mapping and adapter.
- `src/ui/trayCapture.ts`: provider-aware tray image.
- `src/ui/preload.ts`: typed multi-provider IPC bridge.
- `src/ui/popoverRenderer.ts`: multi-section rendering and authoritative settings controls.
- `src/ui/popover.html`: source/menu-bar controls and source-section styles.
- `src/main.ts`: Electron composition root.
- `tests/*.test.mjs`: Node test runner coverage against compiled TypeScript output.

### Task 1: Test Harness, Domain Model, Preferences, and Cache

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`
- Modify: `src/quota/model.ts`
- Create: `src/preferences.ts`
- Modify: `src/quota/cache.ts`
- Create: `tests/preferences.test.mjs`
- Create: `tests/cache.test.mjs`

**Interfaces:**
- Produces: `ProviderId`, `DisplaySource`, `SourceState`, `QuotaSnapshot`, `Preferences`, `DEFAULT_PREFERENCES`, `effectiveMenuBarSource()`, `loadPreferences()`, `savePreferences()`, `createQuotaCache()`.

- [ ] **Step 1: Add failing preference and cache tests**

Test invalid-field fallback, `both` tray selection, single-source override, per-provider file names, successful round-trip, corrupt-cache rejection, and legacy Claude fallback. Import from `out/src/preferences.js` and `out/src/quota/cache.js`.

```js
test("single source overrides persisted menu source", () => {
  assert.equal(effectiveMenuBarSource({ ...DEFAULT_PREFERENCES, source: "codex", menuBarSource: "claude" }), "codex");
});

test("provider caches are isolated", () => {
  const claude = createQuotaCache("/tmp/x", "claude", deps);
  const codex = createQuotaCache("/tmp/x", "codex", deps);
  assert.notEqual(claude.path, codex.path);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm exec tsc --outDir out && node --test tests/preferences.test.mjs tests/cache.test.mjs`

Expected: FAIL because preferences exports and generic cache do not exist.

- [ ] **Step 3: Implement shared types, preferences, and generic cache**

Use these exact core shapes:

```ts
export type ProviderId = "claude" | "codex";
export type DisplaySource = ProviderId | "both";
export interface SourceState {
  enabled: boolean;
  loading: boolean;
  result: ReadResult;
  lastGood: Quota | null;
}
export type QuotaSnapshot = Record<ProviderId, SourceState>;

export interface Preferences {
  source: DisplaySource;
  menuBarSource: ProviderId;
  resetMode: "countdown" | "clock";
}
export const DEFAULT_PREFERENCES: Preferences = {
  source: "both", menuBarSource: "claude", resetMode: "countdown",
};
export function effectiveMenuBarSource(p: Preferences): ProviderId {
  return p.source === "both" ? p.menuBarSource : p.source;
}
```

Inject filesystem methods into preferences/cache tests. Persist caches as
`quotix-quota-cache-claude.json` and `quotix-quota-cache-codex.json`; read
`quotix-quota-cache.json` only as Claude fallback.

- [ ] **Step 4: Add test scripts and verify**

Add `typecheck`, `test:unit`, and `test` scripts; include `src` in compile-to-out while keeping Electron imports type-safe.

Run: `pnpm run typecheck && pnpm run test:unit`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json src/quota/model.ts src/preferences.ts src/quota/cache.ts tests/preferences.test.mjs tests/cache.test.mjs
git commit -m "refactor: add shared quota domain and preferences"
```

### Task 2: Generic Source Runtime and Coordinator

**Files:**
- Create: `src/quota/provider.ts`
- Create: `src/quota/sourceRuntime.ts`
- Create: `src/quota/coordinator.ts`
- Create: `tests/sourceRuntime.test.mjs`
- Create: `tests/coordinator.test.mjs`

**Interfaces:**
- Consumes: `ProviderId`, `Quota`, `ReadResult`, `SourceState`, `QuotaSnapshot`, provider cache.
- Produces: `ProviderReadResult`, `QuotaProvider`, `SourceRuntime`, `QuotaCoordinator`.

- [ ] **Step 1: Write failing runtime tests**

Cover initial cached state, no-cache loading, success save, transient fallback,
missing-without-cache, in-flight deduplication, 429 exponential backoff, cap,
success reset, and manual refresh respecting backoff.

```js
const first = runtime.poll();
const second = runtime.poll();
assert.strictEqual(first, second);
assert.equal(provider.readCalls, 1);

await runtime.poll(); // rate limited, base 60
nowMs = 30_000;
await runtime.poll(true);
assert.equal(provider.readCalls, 1);
```

- [ ] **Step 2: Run runtime tests and verify failure**

Run: `pnpm exec tsc --outDir out && node --test tests/sourceRuntime.test.mjs`

Expected: FAIL because runtime modules do not exist.

- [ ] **Step 3: Implement provider contract and SourceRuntime**

```ts
export type ProviderReadResult =
  | { ok: true; quota: Quota }
  | { ok: false; kind: "missing" | "auth" | "rate-limited" | "transient"; error: string; retryAfterSeconds?: number };

export interface QuotaProvider {
  readonly id: ProviderId;
  read(nowSec: number): Promise<ProviderReadResult>;
  dispose(): void;
}
```

`SourceRuntime.poll(force)` returns the current in-flight promise when one
exists. It emits loading only without last-good data. On failure with cache it
keeps an `ok: true` render result with a diagnostic; without cache it maps
`missing` to `reason: "missing"` and other failures to `reason: "corrupt"`.

- [ ] **Step 4: Write failing coordinator tests**

Cover `claude`, `codex`, and `both`; verify `Promise.all` concurrency, immediate
poll on enable, disposal on disable, disabled snapshot state, and refresh of
all enabled runtimes.

- [ ] **Step 5: Implement coordinator and verify**

```ts
export class QuotaCoordinator {
  setSource(source: DisplaySource): void;
  pollEnabled(force?: boolean): Promise<void>;
  snapshot(): QuotaSnapshot;
  subscribe(listener: (snapshot: QuotaSnapshot) => void): () => void;
  dispose(): void;
}
```

Run: `pnpm run typecheck && node --test tests/sourceRuntime.test.mjs tests/coordinator.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/quota/provider.ts src/quota/sourceRuntime.ts src/quota/coordinator.ts tests/sourceRuntime.test.mjs tests/coordinator.test.mjs
git commit -m "refactor: add quota provider runtime and coordinator"
```

### Task 3: Claude Provider Adapter

**Files:**
- Create: `src/quota/claude/credentials.ts`
- Create: `src/quota/claude/provider.ts`
- Delete after migration: `src/quota/oauthCredentials.ts`
- Delete after migration: `src/quota/oauthSource.ts`
- Create: `tests/claudeProvider.test.mjs`

**Interfaces:**
- Consumes: `QuotaProvider`, `ProviderReadResult`, `quotaFromOAuthUsage()`.
- Produces: `ClaudeQuotaProvider`, `createCachedTokenProvider()`.

- [ ] **Step 1: Write failing adapter tests**

Cover missing token, success, HTTP 401 invalidation, HTTP 429 retry header,
timeout, network error, and unexpected HTTP response using injected token and
fetch dependencies.

```js
const result = await provider.read(123);
assert.deepEqual(result, { ok: false, kind: "rate-limited", error: "HTTP 429", retryAfterSeconds: 90 });
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm exec tsc --outDir out && node --test tests/claudeProvider.test.mjs`

Expected: FAIL because `ClaudeQuotaProvider` does not exist.

- [ ] **Step 3: Move credentials and implement adapter**

Preserve Keychain sync-seed/async-refresh behavior. `read(nowSec)` obtains the
cached token, calls the OAuth endpoint with the existing beta header and
20-second timeout, maps successful JSON through `quotaFromOAuthUsage`, and
returns normalized provider failures. HTTP 401 calls `invalidate()` before
returning `kind: "auth"`.

- [ ] **Step 4: Verify and commit**

Run: `pnpm run typecheck && node --test tests/claudeProvider.test.mjs`

Expected: PASS.

```bash
git add src/quota/claude src/quota/oauthCredentials.ts src/quota/oauthSource.ts tests/claudeProvider.test.mjs
git commit -m "refactor: adapt Claude quota to provider contract"
```

### Task 4: Codex Executable Discovery and App-Server Provider

**Files:**
- Create: `src/quota/codex/executable.ts`
- Create: `src/quota/codex/appServer.ts`
- Create: `src/quota/codex/provider.ts`
- Modify: `src/quota/model.ts`
- Create: `tests/codexExecutable.test.mjs`
- Create: `tests/codexAppServer.test.mjs`
- Create: `tests/codexProvider.test.mjs`

**Interfaces:**
- Produces: `resolveCodexExecutable()`, `CodexAppServerClient`, `CodexQuotaProvider`, `quotaFromCodexRateLimits()`.

- [ ] **Step 1: Write failing discovery and mapping tests**

Test precedence for `CODEX_PATH`, latest matching `openai.chatgpt-*` extension
bundle, `PATH`, common locations, and bare fallback. Test `rateLimitsByLimitId.codex`
before legacy `rateLimits`, mapping primary/secondary usedPercent/resetsAt.

- [ ] **Step 2: Implement discovery and mapping**

Use injected `exists`, `listDirectories`, `home`, `env`, `platform`, and `arch`.
Known extension roots on macOS include `~/.vscode/extensions`,
`~/.vscode-insiders/extensions`, `~/.cursor/extensions`, and
`~/.windsurf/extensions`. Sort matching OpenAI extension directories newest
first and inspect platform bundle directories.

- [ ] **Step 3: Write failing app-server lifecycle tests**

Use a fake child process with PassThrough streams. Assert initialize request,
initialized notification, rate-limit request correlation, JSON error mapping,
timeout rejection/process kill, exit rejection, and idempotent disposal.

- [ ] **Step 4: Implement app-server client**

Port the sibling `ai-quota` client with `DEFAULT_REQUEST_TIMEOUT_MS = 60_000`,
newline-delimited JSON, pending-request timers, and process restart after fatal
failure. Set client info to `{ name: "quotix", title: "Quotix", version }`.

- [ ] **Step 5: Write and implement provider tests**

`CodexQuotaProvider.read(nowSec)` calls `readRateLimits()`, maps success, maps
ENOENT to `missing`, maps detected 429 errors to `rate-limited` with parsed
retry seconds, and maps remaining errors to `transient` without leaking raw
payloads.

- [ ] **Step 6: Verify and commit**

Run: `pnpm run typecheck && node --test tests/codexExecutable.test.mjs tests/codexAppServer.test.mjs tests/codexProvider.test.mjs`

Expected: PASS.

```bash
git add src/quota/model.ts src/quota/codex tests/codexExecutable.test.mjs tests/codexAppServer.test.mjs tests/codexProvider.test.mjs
git commit -m "feat: add Codex quota provider"
```

### Task 5: Provider-Aware Tray Rendering

**Files:**
- Modify: `src/ui/trayCapture.ts`
- Create: `assets/openai.svg`
- Create: `tests/trayState.test.mjs`

**Interfaces:**
- Consumes: `ProviderId`, `SourceState`, `effectiveMenuBarSource()`.
- Produces: `trayDisplayState()` pure selector and provider-aware `renderTray()`.

- [ ] **Step 1: Write failing selector tests**

Assert Claude/Codex identity, last-good values during transient errors, missing
state suppression of cache only for explicit missing credentials/executable,
and independent loading/unavailable labels.

- [ ] **Step 2: Implement selector and tray renderer**

```ts
export interface TrayDisplayState {
  provider: ProviderId;
  session: number | null;
  weekly: number | null;
  loading: boolean;
  unavailable: boolean;
}
```

Embed both local SVG assets into the capture page and switch image source by
provider. Preserve current layout, thresholds, and display-scale capture.

- [ ] **Step 3: Verify and commit**

Run: `pnpm run typecheck && node --test tests/trayState.test.mjs && pnpm run compile`

Expected: PASS; esbuild produces all three bundles.

```bash
git add src/ui/trayCapture.ts assets/openai.svg tests/trayState.test.mjs
git commit -m "feat: render selected provider in menu bar"
```

### Task 6: Multi-Provider Popover and Typed Preferences IPC

**Files:**
- Modify: `src/ui/preload.ts`
- Modify: `src/ui/popoverRenderer.ts`
- Modify: `src/ui/popover.html`
- Create: `tests/popoverState.test.mjs`

**Interfaces:**
- Consumes: `QuotaSnapshot`, `Preferences`, provider/source state.
- Produces: `PopoverPayload`, typed bridge setters, pure `sectionsForPayload()`.

- [ ] **Step 1: Write failing popover-state tests**

Assert source section order, single-source filtering, mixed good/error state,
per-source updated age, menu-bar setting visibility only for Both, and reset
mode from authoritative preferences.

- [ ] **Step 2: Extend preload bridge**

Expose `setSource(source)`, `setMenuBarSource(source)`, and
`setResetMode(mode)` IPC sends. Replace `UpdatePayload.result` with snapshot
and preferences.

- [ ] **Step 3: Refactor renderer and markup**

Render source sections into `#sources`; build each header and quota rows from
the pure section model. Add Source and conditional Menu bar segmented controls.
Remove `localStorage`; clicks send settings and wait for the authoritative
payload. Keep refresh, quit, version, ResizeObserver, and one-second local clock
tick.

- [ ] **Step 4: Verify and commit**

Run: `pnpm run typecheck && node --test tests/popoverState.test.mjs && pnpm run compile`

Expected: PASS.

```bash
git add src/ui/preload.ts src/ui/popoverRenderer.ts src/ui/popover.html tests/popoverState.test.mjs
git commit -m "feat: add multi-provider popover settings"
```

### Task 7: Electron Composition and End-to-End Verification

**Files:**
- Modify: `src/main.ts`
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: all prior task interfaces.
- Produces: running multi-provider Quotix application.

- [ ] **Step 1: Add a failing composition test for settings validation helpers**

Keep IPC input validation in pure exported functions and assert invalid source,
menu source, and reset mode inputs are rejected before coordinator mutation.

- [ ] **Step 2: Rebuild `main.ts` as composition root**

Load preferences and caches from `app.getPath("userData")`; create provider
factories and coordinator; subscribe render; set the two-minute timer; select
tray state through `effectiveMenuBarSource`; send snapshot/preferences/nowSec
to popover; wire validated setting IPC; refresh enabled sources; dispose on
`before-quit`.

- [ ] **Step 3: Update documentation**

Document defaults, Claude/Codex prerequisites, executable discovery,
single/both display rules, menu-bar source behavior, two-minute shared poll,
and separate last-good caches. Update the architecture file list.

- [ ] **Step 4: Run full automated verification**

Run: `pnpm run typecheck && pnpm test && pnpm run compile`

Expected: all Node tests PASS, TypeScript exits 0, and esbuild produces
`dist/main.js`, `dist/preload.js`, and `dist/popoverRenderer.js`.

- [ ] **Step 5: Inspect repository and production artifacts**

Run: `git diff --check && git status --short && ls -l dist/main.js dist/preload.js dist/popoverRenderer.js dist/popover.html`

Expected: no whitespace errors; only intended source, asset, test,
documentation, lockfile, and built-file changes are present. Generated `dist`
files remain untracked/ignored if that is the repository convention.

- [ ] **Step 6: Manual macOS smoke checklist**

Run `pnpm start` and verify: default Both shows Claude then Codex; tray defaults
to Claude; switching source starts/disposes providers; Both menu selector
switches the tray; mixed unavailable/success renders independently; refresh
updates enabled sources; popover auto-resizes; settings and caches survive
restart; quitting leaves no Codex app-server child.

- [ ] **Step 7: Commit**

```bash
git add src/main.ts README.md CLAUDE.md package.json pnpm-lock.yaml tests
git commit -m "feat: integrate multi-provider quota display"
```
