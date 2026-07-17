import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { spawn } from "node:child_process";
import * as readline from "node:readline";
import { resolveCodexExecutable } from "./executable";

type PendingRequest = {
  resolve(value: unknown): void;
  reject(reason: Error): void;
  timer: NodeJS.Timeout;
};

type SpawnCodex = () => ChildProcessWithoutNullStreams;

export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

export class CodexAppServerError extends Error {
  constructor(message: string, readonly code?: unknown, readonly data?: unknown) {
    super(message);
    this.name = "CodexAppServerError";
  }
}

export interface CodexRateLimitsClient {
  readRateLimits(): Promise<unknown>;
  dispose(): void;
}

export function spawnCodexAppServer(executable = resolveCodexExecutable()): ChildProcessWithoutNullStreams {
  return spawn(executable, ["app-server", "--stdio"], {
    stdio: ["pipe", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
}

export class CodexAppServerClient implements CodexRateLimitsClient {
  private process: ChildProcessWithoutNullStreams | undefined;
  private lines: readline.Interface | undefined;
  private ready: Promise<void> | undefined;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private disposed = false;

  constructor(
    private readonly spawnCodex: SpawnCodex = () => spawnCodexAppServer(),
    private readonly clientVersion = "unknown",
    private readonly requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ) {}

  async readRateLimits(): Promise<unknown> {
    await this.ensureStarted();
    return this.request("account/rateLimits/read");
  }

  private async ensureStarted(): Promise<void> {
    if (this.disposed) { throw new Error("Codex app-server client is disposed"); }
    if (this.ready) { return this.ready; }
    this.ready = this.start();
    try { await this.ready; }
    catch (error) { this.ready = undefined; throw error; }
  }

  private async start(): Promise<void> {
    const child = this.spawnCodex();
    this.process = child;
    child.once("error", (error) => this.stopProcess(child, error));
    child.once("exit", (code, signal) => {
      this.stopProcess(child, new Error(`Codex app-server exited (${signal ?? code ?? "unknown"})`));
    });
    child.stdin.on("error", (error) => this.stopProcess(child, error));
    child.stderr.resume();
    this.lines = readline.createInterface({ input: child.stdout });
    this.lines.on("line", (line) => this.handleLine(line));
    try {
      await this.request("initialize", {
        clientInfo: { name: "quotix", title: "Quotix", version: this.clientVersion },
        capabilities: null,
      });
      this.send({ method: "initialized" });
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      this.stopProcess(child, normalized, true);
      throw normalized;
    }
  }

  private request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const error = new Error(`${method} timed out`);
        reject(error);
        if (this.process) { this.stopProcess(this.process, error, true); }
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send(params === undefined ? { method, id } : { method, id, params }); }
      catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private send(message: unknown): void {
    if (!this.process) { throw new Error("Codex app-server is not running"); }
    const child = this.process;
    child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
      if (error) { this.stopProcess(child, error); }
    });
  }

  private handleLine(line: string): void {
    let message: Record<string, unknown>;
    try { message = JSON.parse(line) as Record<string, unknown>; }
    catch { return; }
    if (typeof message.id !== "number") { return; }
    const request = this.pending.get(message.id);
    if (!request) { return; }
    clearTimeout(request.timer);
    this.pending.delete(message.id);
    if (message.error && typeof message.error === "object") {
      const error = message.error as Record<string, unknown>;
      request.reject(new CodexAppServerError(
        typeof error.message === "string" ? error.message : "Codex app-server request failed",
        error.code,
        error.data,
      ));
    } else {
      request.resolve(message.result);
    }
  }

  private stopProcess(child: ChildProcessWithoutNullStreams, error: Error, kill = false): void {
    if (this.process !== child) { return; }
    this.lines?.close();
    this.lines = undefined;
    this.process = undefined;
    this.ready = undefined;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
    if (kill) { child.kill(); }
  }

  dispose(): void {
    this.disposed = true;
    if (this.process) { this.stopProcess(this.process, new Error("Codex app-server client disposed"), true); }
  }
}
