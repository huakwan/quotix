import type { QuotaCache } from "./cache";
import type { SourceState } from "./model";
import type { QuotaProvider } from "./provider";

const DEFAULT_BACKOFF_SECONDS = 60;
const MAX_BACKOFF_SECONDS = 10 * 60;

interface SourceRuntimeDeps {
  nowMs(): number;
}

const defaultDeps: SourceRuntimeDeps = { nowMs: Date.now };

export class SourceRuntime {
  readonly id;
  private current: SourceState;
  private inFlight: Promise<void> | null = null;
  private consecutiveRateLimits = 0;
  private backoffUntilMs = 0;
  private listeners = new Set<(state: SourceState) => void>();

  constructor(
    private readonly provider: QuotaProvider,
    private readonly cache: QuotaCache,
    private readonly deps: SourceRuntimeDeps = defaultDeps,
  ) {
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

  poll(_force = false): Promise<void> {
    if (this.inFlight) { return this.inFlight; }
    if (this.deps.nowMs() < this.backoffUntilMs) { return Promise.resolve(); }
    if (!this.current.lastGood) {
      this.setState({ ...this.current, loading: true });
    }
    const startedAtMs = this.deps.nowMs();
    this.inFlight = this.provider.read(Math.floor(startedAtMs / 1000))
      .then((result) => {
        if (result.ok) {
          this.consecutiveRateLimits = 0;
          this.backoffUntilMs = 0;
          this.cache.save(result.quota);
          this.setState({ enabled: true, loading: false, result, lastGood: result.quota });
          return;
        }
        if (result.kind === "rate-limited") {
          this.consecutiveRateLimits += 1;
          const base = result.retryAfterSeconds ?? DEFAULT_BACKOFF_SECONDS;
          const seconds = Math.min(base * 2 ** (this.consecutiveRateLimits - 1), MAX_BACKOFF_SECONDS);
          this.backoffUntilMs = startedAtMs + seconds * 1000;
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
        this.setState({ ...this.current, loading: false, result: renderResult });
      })
      .finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  dispose(): void {
    this.provider.dispose();
    this.listeners.clear();
  }

  private setState(state: SourceState): void {
    this.current = state;
    for (const listener of this.listeners) { listener(state); }
  }
}
