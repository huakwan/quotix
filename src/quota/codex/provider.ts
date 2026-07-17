import { quotaFromCodexRateLimits } from "../model";
import type { QuotaProvider, ProviderReadResult } from "../provider";
import { CodexAppServerError, type CodexRateLimitsClient } from "./appServer";

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function positiveSeconds(value: unknown): number | undefined {
  const parsed = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 600) : undefined;
}

function retryAfter(error: Error): number | undefined {
  const appError = error instanceof CodexAppServerError ? error : undefined;
  const data = record(appError?.data);
  const headers = record(data?.headers);
  const status = data?.status ?? data?.statusCode ?? data?.httpStatus;
  const is429 = Number(appError?.code) === 429 || Number(status) === 429 || /\b429\b/.test(error.message);
  if (!is429) { return undefined; }
  return positiveSeconds(data?.retryAfterSeconds ?? data?.retry_after_seconds
    ?? data?.retryAfter ?? data?.retry_after ?? headers?.["retry-after"] ?? headers?.["Retry-After"]) ?? 60;
}

export class CodexQuotaProvider implements QuotaProvider {
  readonly id = "codex" as const;
  constructor(private readonly client: CodexRateLimitsClient) {}

  async read(nowSec: number): Promise<ProviderReadResult> {
    try {
      return { ok: true, quota: quotaFromCodexRateLimits(await this.client.readRateLimits(), nowSec) };
    } catch (value) {
      const error = value instanceof Error ? value : new Error(String(value));
      const missing = (error as NodeJS.ErrnoException).code === "ENOENT" || error.message.includes("spawn codex ENOENT");
      if (missing) {
        return { ok: false, kind: "missing", error: "Codex CLI executable was not found" };
      }
      const seconds = retryAfter(error);
      if (seconds !== undefined) {
        return { ok: false, kind: "rate-limited", error: "Codex rate limited", retryAfterSeconds: seconds };
      }
      return { ok: false, kind: "transient", error: "Codex quota request failed" };
    }
  }

  dispose(): void { this.client.dispose(); }
}
