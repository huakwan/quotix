import type { ProviderId, QuotaSnapshot, SourceState } from "../quota/model";
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
