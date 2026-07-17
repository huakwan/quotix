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

export interface QuotaRow {
  label: "5H" | "7D";
  window: QuotaWindow | null;
}

export function quotaRowsForProvider(provider: ProviderId, quota: Quota): QuotaRow[] {
  if (provider === "claude") {
    return [
      { label: "5H", window: quota.session },
      { label: "7D", window: quota.weekly },
    ];
  }
  const rows: QuotaRow[] = [];
  if (quota.session) { rows.push({ label: "5H", window: quota.session }); }
  if (quota.weekly) { rows.push({ label: "7D", window: quota.weekly }); }
  return rows;
}

export function sectionsForPayload(payload: PopoverPayload): PopoverSection[] {
  const ids: ProviderId[] = payload.preferences.source === "both"
    ? ["claude", "codex"]
    : [payload.preferences.source];
  return ids.map((provider) => ({
    provider,
    name: provider === "claude" ? "Claude Code" : "Codex",
    state: payload.snapshot[provider],
  }));
}

export function showMenuBarSetting(preferences: Preferences): boolean {
  return preferences.source === "both";
}
