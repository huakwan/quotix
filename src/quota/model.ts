export interface QuotaWindow {
  usedPct: number;
  resetsAt: number | null;
}

export interface Quota {
  updatedAt: number;
  session: QuotaWindow | null;
  weekly: QuotaWindow | null;
  planDetected: boolean;
}

export type ProviderId = "claude" | "codex";
export type DisplaySource = ProviderId | "both";

export type ReadResult =
  | { ok: true; quota: Quota; diagnostic?: string }
  | { ok: false; reason: "missing" | "corrupt"; error?: string };

export interface SourceState {
  enabled: boolean;
  loading: boolean;
  result: ReadResult;
  lastGood: Quota | null;
}

export type QuotaSnapshot = Record<ProviderId, SourceState>;

function toOAuthWindow(w: unknown): QuotaWindow | null {
  if (!w || typeof w !== "object") { return null; }
  const o = w as Record<string, unknown>;
  if (typeof o.utilization !== "number" || typeof o.resets_at !== "string") { return null; }
  const resetsAt = Math.floor(new Date(o.resets_at).getTime() / 1000);
  return { usedPct: o.utilization, resetsAt };
}

export function quotaFromOAuthUsage(usage: unknown, updatedAt: number): Quota {
  const o = (usage ?? {}) as Record<string, unknown>;
  const session = toOAuthWindow(o.five_hour);
  const weekly = toOAuthWindow(o.seven_day);
  return {
    updatedAt,
    session,
    weekly,
    planDetected: session !== null || weekly !== null,
  };
}

function toCodexWindow(value: unknown): QuotaWindow | null {
  if (!value || typeof value !== "object") { return null; }
  const window = value as Record<string, unknown>;
  if (typeof window.usedPercent !== "number") { return null; }
  if (!(typeof window.resetsAt === "number" || window.resetsAt === null)) { return null; }
  return { usedPct: window.usedPercent, resetsAt: window.resetsAt };
}

const WEEKLY_WINDOW_MINS = 7 * 24 * 60;

function codexWindowDuration(value: unknown): number | null {
  if (!value || typeof value !== "object") { return null; }
  const duration = (value as Record<string, unknown>).windowDurationMins;
  return typeof duration === "number" && Number.isFinite(duration) && duration > 0 ? duration : null;
}

function assignCodexWindow(
  slots: { session: QuotaWindow | null; weekly: QuotaWindow | null },
  value: unknown,
  legacySlot: "session" | "weekly",
): void {
  const window = toCodexWindow(value);
  if (!window) { return; }
  const duration = codexWindowDuration(value);
  const slot = duration === null
    ? legacySlot
    : duration >= WEEKLY_WINDOW_MINS ? "weekly" : "session";
  if (slots[slot] === null) { slots[slot] = window; }
}

export function quotaFromCodexRateLimits(response: unknown, updatedAt: number): Quota {
  const value = (response ?? {}) as Record<string, unknown>;
  const byId = value.rateLimitsByLimitId;
  const codex = byId && typeof byId === "object"
    ? (byId as Record<string, unknown>).codex
    : undefined;
  const snapshot = (codex ?? value.rateLimits ?? {}) as Record<string, unknown>;
  const slots: { session: QuotaWindow | null; weekly: QuotaWindow | null } = {
    session: null,
    weekly: null,
  };
  assignCodexWindow(slots, snapshot.primary, "session");
  assignCodexWindow(slots, snapshot.secondary, "weekly");
  return {
    updatedAt,
    ...slots,
    planDetected: slots.session !== null || slots.weekly !== null,
  };
}
