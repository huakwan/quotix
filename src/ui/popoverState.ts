import type { ProviderId, Quota, QuotaSnapshot, QuotaWindow, SourceState } from "../quota/model";
import type { Preferences } from "../preferences";

export interface PopoverPayload {
  snapshot: QuotaSnapshot;
  preferences: Preferences;
  nowSec: number;
}

export interface PopoverSection {
  provider: ProviderId;
  name: string;
  state: SourceState;
}

const FIVE_HOUR_SECONDS = 5 * 3600;
const SEVEN_DAY_SECONDS = 7 * 24 * 3600;

export interface QuotaRow {
  label: string;
  window: QuotaWindow | null;
  periodSeconds: number;
}

export function quotaRowsForProvider(provider: ProviderId, quota: Quota): QuotaRow[] {
  const rows: QuotaRow[] = [];
  if (provider === "claude") {
    rows.push({ label: "5H", window: quota.session, periodSeconds: FIVE_HOUR_SECONDS });
    rows.push({ label: "7D", window: quota.weekly, periodSeconds: SEVEN_DAY_SECONDS });
  } else {
    if (quota.session) { rows.push({ label: "5H", window: quota.session, periodSeconds: FIVE_HOUR_SECONDS }); }
    if (quota.weekly) { rows.push({ label: "7D", window: quota.weekly, periodSeconds: SEVEN_DAY_SECONDS }); }
  }
  for (const entry of quota.weeklyModels ?? []) {
    rows.push({ label: entry.model.slice(0, 2).toUpperCase(), window: entry.window, periodSeconds: SEVEN_DAY_SECONDS });
  }
  return rows;
}

export function sectionsForPayload(payload: PopoverPayload): PopoverSection[] {
  const ids: ProviderId[] = payload.preferences.source === "both"
    ? ["claude", "codex"]
    : [payload.preferences.source];
  return ids.map((provider) => ({
    provider,
    name: provider === "claude" ? "Claude Code" : "Codex OpenAI",
    state: payload.snapshot[provider],
  }));
}

export function showMenuBarSetting(preferences: Preferences): boolean {
  return preferences.source === "both";
}
