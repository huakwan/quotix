import type { QuotaCache } from "./cache";
import type { SourceState } from "./model";
import type { QuotaProvider } from "./provider";

const MINUTE_MS = 60_000;

export interface RateLimitPolicy {
  /** Hard floor between any two provider requests, whatever asks for one. */
  minSpacingMs: number;
  /** Shortest quiet period after a 429. */
  minBackoffMs: number;
  maxBackoffMs: number;
  /** Growth per consecutive 429. */
  growth: number;
  /** Random spread added to a backoff so pollers do not retry in lockstep. */
  jitterMs: number;
}

// Tuned against the Anthropic OAuth usage endpoint: its budget is a handful of
// requests in a short window, and any request sent while blocked restarts the
// block. Retrying sooner than minBackoffMs measurably keeps the block alive, so
// the only way out of a 429 is to go quiet.
export const defaultRateLimitPolicy: RateLimitPolicy = {
  minSpacingMs: MINUTE_MS,
  minBackoffMs: 5 * MINUTE_MS,
  maxBackoffMs: 10 * MINUTE_MS,
  growth: 1.5,
  jitterMs: MINUTE_MS,
};

export interface SourceRuntimeDeps {
  nowMs(): number;
  random(): number;
  policy: Partial<RateLimitPolicy>;
}

export class SourceRuntime {
  readonly id;
  private current: SourceState;
  private inFlight: Promise<void> | null = null;
  private consecutiveRateLimits = 0;
  private backoffUntilMs = 0;
  private lastRequestAtMs = Number.NEGATIVE_INFINITY;
  private listeners = new Set<(state: SourceState) => void>();
  private readonly nowMs: () => number;
  private readonly random: () => number;
  private readonly policy: RateLimitPolicy;

  constructor(
    private readonly provider: QuotaProvider,
    private readonly cache: QuotaCache,
    deps: Partial<SourceRuntimeDeps> = {},
  ) {
    this.nowMs = deps.nowMs ?? Date.now;
    this.random = deps.random ?? Math.random;
    this.policy = { ...defaultRateLimitPolicy, ...deps.policy };
    this.id = provider.id;
    const cached = cache.load();
    this.current = {
      enabled: true,
      loading: false,
      result: cached ? { ok: true, quota: cached } : { ok: false, reason: "missing" },
      lastGood: cached,
    };
  }

  state(): SourceState { return this.current; }

  subscribe(listener: (state: SourceState) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Milliseconds until the next request is permitted; 0 when one can go now. */
  waitMs(): number {
    if (this.inFlight) { return 0; }
    const nowMs = this.nowMs();
    return Math.max(
      0,
      this.backoffUntilMs - nowMs,
      this.lastRequestAtMs + this.policy.minSpacingMs - nowMs,
    );
  }

  // Every caller — scheduled tick, manual refresh, popover open — is held to the
  // same guards. A manual bypass only spends budget the provider has already
  // refused and extends the block, so there is no force flag.
  poll(): Promise<void> {
    if (this.inFlight) { return this.inFlight; }
    if (this.waitMs() > 0) { return Promise.resolve(); }
    const nowMs = this.nowMs();
    this.lastRequestAtMs = nowMs;
    this.setState({ ...this.current, loading: true });
    const startedAtMs = nowMs;
    this.inFlight = this.provider.read(Math.floor(startedAtMs / 1000))
      .then((result) => {
        if (result.ok) {
          this.consecutiveRateLimits = 0;
          this.backoffUntilMs = 0;
          this.cache.save(result.quota);
          this.setState({ enabled: true, loading: true, result, lastGood: result.quota });
          return;
        }
        if (result.kind === "rate-limited") {
          this.consecutiveRateLimits += 1;
          this.backoffUntilMs = this.nowMs() + this.backoffMs(result.retryAfterSeconds);
        } else {
          this.consecutiveRateLimits = 0;
          this.backoffUntilMs = 0;
        }
        const renderResult = this.current.lastGood
          ? { ok: true as const, quota: this.current.lastGood, diagnostic: result.error }
          : {
              ok: false as const,
              reason: result.kind === "missing" ? "missing" as const : "corrupt" as const,
              error: result.error,
            };
        this.setState({ ...this.current, loading: true, result: renderResult });
      })
      .finally(() => {
        this.inFlight = null;
        this.setState({ ...this.current, loading: false });
      });
    return this.inFlight;
  }

  dispose(): void {
    this.provider.dispose();
    this.listeners.clear();
  }

  // A server-supplied retry-after is honoured when it asks for longer than the
  // policy, but never trusted to shorten the quiet period: this endpoint answers
  // "retry-after: 0" while still blocking.
  private backoffMs(retryAfterSeconds: number | undefined): number {
    const requested = (retryAfterSeconds ?? 0) * 1000;
    const base = Math.max(requested, this.policy.minBackoffMs);
    const scaled = base * this.policy.growth ** (this.consecutiveRateLimits - 1);
    const ceiling = Math.max(this.policy.maxBackoffMs, requested);
    return Math.min(scaled, ceiling) + this.random() * this.policy.jitterMs;
  }

  private setState(state: SourceState): void {
    this.current = state;
    for (const listener of this.listeners) { listener(state); }
  }
}
