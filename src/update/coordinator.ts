import {
  UpdateError,
  type AvailableRelease,
  type ReleaseCheckResult,
  type UpdateViewState,
  type VerifiedUpdate,
} from "./model";

export interface StageHooks {
  progress(percentage: number): void;
  verifying(): void;
}

export interface UpdateCoordinatorDeps {
  currentVersion?: string;
  check(): Promise<ReleaseCheckResult>;
  stage(
    release: AvailableRelease,
    hooks: StageHooks,
    signal: AbortSignal,
  ): Promise<VerifiedUpdate>;
  install(update: VerifiedUpdate): Promise<"installing" | "fallback">;
  reveal(update: VerifiedUpdate): Promise<void>;
  cleanup?(update: VerifiedUpdate): Promise<void>;
}

export class UpdateCoordinator {
  private state: UpdateViewState = { status: "idle" };
  private release: AvailableRelease | undefined;
  private verified: VerifiedUpdate | undefined;
  private abortController: AbortController | undefined;
  private listeners = new Set<(state: UpdateViewState) => void>();
  private disposed = false;

  constructor(private readonly deps: UpdateCoordinatorDeps) {}

  view(): UpdateViewState {
    return { ...this.state };
  }

  subscribe(listener: (state: UpdateViewState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setState(state: UpdateViewState): void {
    if (this.disposed) { return; }
    this.state = state;
    for (const listener of this.listeners) { listener(this.view()); }
  }

  async check(manual: boolean): Promise<void> {
    if (
      ["checking", "downloading", "verifying", "ready", "installing", "fallback"]
        .includes(this.state.status)
    ) {
      throw new UpdateError("update_action_invalid");
    }
    const previous = this.state;
    this.setState({ status: "checking" });
    try {
      const result = await this.deps.check();
      const previousVerified = this.verified;
      this.verified = undefined;
      if (previousVerified) {
        await this.deps.cleanup?.(previousVerified).catch(() => undefined);
      }
      if (result.status === "up-to-date") {
        this.release = undefined;
        this.setState({ status: "up-to-date", version: this.deps.currentVersion ?? "" });
      } else {
        this.release = result.release;
        this.setState({ status: "available", version: result.release.version });
      }
    } catch {
      this.setState(manual
        ? { status: "error", error: "Unable to check for updates." }
        : previous.status === "error" ? { status: "idle" } : previous);
    }
  }

  async download(): Promise<void> {
    if (this.state.status !== "available" || !this.release) {
      throw new UpdateError("update_action_invalid");
    }
    const release = this.release;
    const controller = new AbortController();
    this.abortController = controller;
    this.setState({ status: "downloading", version: release.version, progress: 0 });
    try {
      const verified = await this.deps.stage(release, {
        progress: (progress) => this.setState({
          status: "downloading",
          version: release.version,
          progress: Math.max(0, Math.min(100, progress)),
        }),
        verifying: () => this.setState({ status: "verifying", version: release.version }),
      }, controller.signal);
      if (controller.signal.aborted) {
        this.setState({ status: "available", version: release.version });
        return;
      }
      this.verified = verified;
      this.setState({ status: "ready", version: release.version });
    } catch {
      this.setState(controller.signal.aborted
        ? { status: "available", version: release.version }
        : { status: "error", error: "Unable to download or verify the update." });
    } finally {
      if (this.abortController === controller) { this.abortController = undefined; }
    }
  }

  cancel(): void {
    this.abortController?.abort();
  }

  async install(): Promise<void> {
    if (this.state.status !== "ready" || !this.verified) {
      throw new UpdateError("update_action_invalid");
    }
    const update = this.verified;
    this.setState({ status: "installing", version: update.version });
    try {
      const result = await this.deps.install(update);
      if (result === "fallback") {
        this.setState({ status: "fallback", version: update.version });
      }
    } catch (error) {
      this.setState(error instanceof UpdateError && error.code === "install_cancelled"
        ? { status: "ready", version: update.version }
        : { status: "error", error: "Unable to install the update." });
    }
  }

  async reveal(): Promise<void> {
    if (this.state.status !== "fallback" || !this.verified) {
      throw new UpdateError("update_action_invalid");
    }
    await this.deps.reveal(this.verified);
  }

  dispose(): void {
    this.disposed = true;
    this.abortController?.abort();
    this.abortController = undefined;
    this.listeners.clear();
  }
}
