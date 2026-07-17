import type { DisplaySource, ProviderId, QuotaSnapshot, SourceState } from "./model";
import type { SourceRuntime } from "./sourceRuntime";

type RuntimeFactory = () => SourceRuntime;
type RuntimeFactories = Record<ProviderId, RuntimeFactory>;

const disabledState = (): SourceState => ({
  enabled: false,
  loading: false,
  result: { ok: false, reason: "missing" },
  lastGood: null,
});

function enabledIds(source: DisplaySource): ProviderId[] {
  return source === "both" ? ["claude", "codex"] : [source];
}

export class QuotaCoordinator {
  private runtimes = new Map<ProviderId, SourceRuntime>();
  private unsubscribers = new Map<ProviderId, () => void>();
  private listeners = new Set<(snapshot: QuotaSnapshot) => void>();

  constructor(private readonly factories: RuntimeFactories, source: DisplaySource) {
    for (const id of enabledIds(source)) { this.enable(id, false); }
  }

  setSource(source: DisplaySource): void {
    const wanted = new Set(enabledIds(source));
    for (const [id, runtime] of this.runtimes) {
      if (wanted.has(id)) { continue; }
      this.unsubscribers.get(id)?.();
      this.unsubscribers.delete(id);
      runtime.dispose();
      this.runtimes.delete(id);
    }
    for (const id of wanted) {
      if (!this.runtimes.has(id)) { this.enable(id, true); }
    }
    this.notify();
  }

  async pollEnabled(force = false): Promise<void> {
    await Promise.all([...this.runtimes.values()].map((runtime) => runtime.poll(force)));
  }

  snapshot(): QuotaSnapshot {
    return {
      claude: this.runtimes.get("claude")?.state() ?? disabledState(),
      codex: this.runtimes.get("codex")?.state() ?? disabledState(),
    };
  }

  subscribe(listener: (snapshot: QuotaSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribers.values()) { unsubscribe(); }
    for (const runtime of this.runtimes.values()) { runtime.dispose(); }
    this.unsubscribers.clear();
    this.runtimes.clear();
    this.listeners.clear();
  }

  private enable(id: ProviderId, poll: boolean): void {
    const runtime = this.factories[id]();
    this.runtimes.set(id, runtime);
    this.unsubscribers.set(id, runtime.subscribe(() => this.notify()));
    if (poll) { void runtime.poll(); }
  }

  private notify(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) { listener(snapshot); }
  }
}
