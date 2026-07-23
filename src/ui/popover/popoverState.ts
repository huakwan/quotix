import type { ProviderId, Quota, QuotaSnapshot, QuotaWindow, SourceState } from "../../quota/model";
import type { Preferences } from "../../preferences";
import type { UpdateViewState } from "../../update/model";

export interface PopoverPayload {
  snapshot: QuotaSnapshot;
  preferences: Preferences;
  nowSec: number;
  update: UpdateViewState;
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

export type UpdateAction = "download" | "cancel" | "install" | "reveal" | "retry";

export interface UpdatePresentation {
  visible: boolean;
  label: string;
  action: UpdateAction | null;
  actionLabel: string;
  progress: number | null;
}

export function canActivateUpdateAction(
  action: UpdateAction | null,
  mouseClickCount: number,
): boolean {
  return action !== "download" || mouseClickCount > 0;
}

export function updatePresentation(state: UpdateViewState): UpdatePresentation {
  switch (state.status) {
    case "idle":
      return { visible: false, label: "", action: null, actionLabel: "", progress: null };
    case "checking":
      return { visible: false, label: "", action: null, actionLabel: "", progress: null };
    case "up-to-date":
      return { visible: false, label: "", action: null, actionLabel: "", progress: null };
    case "available":
      return {
        visible: true, label: `Version ${state.version} is available`,
        action: "download", actionLabel: "Update", progress: null,
      };
    case "downloading":
      return {
        visible: true, label: `Downloading ${state.version}…`,
        action: "cancel", actionLabel: "Cancel",
        progress: Math.max(0, Math.min(100, state.progress)),
      };
    case "verifying":
      return { visible: true, label: "Verifying update…", action: null, actionLabel: "", progress: null };
    case "ready":
      return {
        visible: true, label: `Version ${state.version} is ready`,
        action: "install", actionLabel: "Install and Restart", progress: null,
      };
    case "installing":
      return { visible: true, label: "Installing update…", action: null, actionLabel: "", progress: null };
    case "fallback":
      return {
        visible: true, label: "Open the verified download in Finder; right-click Open if macOS blocks it",
        action: "reveal", actionLabel: "Show in Finder", progress: null,
      };
    case "error":
      return {
        visible: true, label: state.error,
        action: "retry", actionLabel: "Retry", progress: null,
      };
  }
}
