import type { ProviderId, Quota, QuotaSnapshot, QuotaWindow, SourceState } from "../../quota/model";
import type { UpdateViewState } from "../../update/model";
import type { Preferences } from "../../preferences";
import { menuBarProvider, normalizeProviderIds } from "../../quota/model";
import { PROVIDER_LABELS } from "../branding";

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
// Fallback only for a monthly window with no reset time; the pace line is
// hidden then, so the exact value does not matter.
const MONTH_FALLBACK_SECONDS = 30 * 24 * 3600;

// OpenCode Go's monthly window is calendar-anchored: it resets on the same
// day of the month each billing period, so the pace line must span the real
// inter-reset duration (28-31 days), not a fixed 30. Compute it as the time
// between the upcoming reset and the previous one (one calendar month earlier,
// same wall-clock time, clamped to the previous month's last day for 29-31st
// anchors).
export function monthlyPeriodSeconds(resetsAt: number): number {
  const reset = new Date(resetsAt * 1000);
  const targetDay = reset.getDate();
  const previous = new Date(reset.getFullYear(), reset.getMonth() - 1, 1);
  const lastDay = new Date(previous.getFullYear(), previous.getMonth() + 1, 0).getDate();
  previous.setDate(Math.min(targetDay, lastDay));
  previous.setHours(reset.getHours(), reset.getMinutes(), reset.getSeconds(), reset.getMilliseconds());
  return resetsAt - previous.getTime() / 1000;
}

export interface QuotaRow {
  label: string;
  window: QuotaWindow | null;
  periodSeconds: number;
}

export function quotaRowsForProvider(provider: ProviderId, quota: Quota): QuotaRow[] {
  const rows: QuotaRow[] = [];
  if (provider === "codex") {
    // Codex reports only the windows its plan actually has.
    if (quota.session) { rows.push({ label: "5H", window: quota.session, periodSeconds: FIVE_HOUR_SECONDS }); }
    if (quota.weekly) { rows.push({ label: "7D", window: quota.weekly, periodSeconds: SEVEN_DAY_SECONDS }); }
  } else {
    rows.push({ label: "5H", window: quota.session, periodSeconds: FIVE_HOUR_SECONDS });
    rows.push({ label: "7D", window: quota.weekly, periodSeconds: SEVEN_DAY_SECONDS });
    if (provider === "opencode") {
      const resetsAt = quota.monthly?.resetsAt ?? null;
      rows.push({
        label: "1M",
        window: quota.monthly,
        periodSeconds: resetsAt === null ? MONTH_FALLBACK_SECONDS : monthlyPeriodSeconds(resetsAt),
      });
    }
  }
  for (const entry of quota.weeklyModels ?? []) {
    rows.push({ label: entry.model.slice(0, 2).toUpperCase(), window: entry.window, periodSeconds: SEVEN_DAY_SECONDS });
  }
  return rows;
}

// The tooltip is absolutely positioned, so it cannot push the popover taller —
// anything past three rendered lines would be clipped by the window edge instead.
// Capping the text here keeps what survives the clamp a whole message.
const DIAGNOSTIC_MAX_CHARS = 120;

export function diagnosticText(error: string): string {
  const text = error.replace(/\s+/g, " ").trim();
  if (text.length <= DIAGNOSTIC_MAX_CHARS) { return text; }
  return `${text.slice(0, DIAGNOSTIC_MAX_CHARS - 1).trimEnd()}…`;
}

export function sectionsForPayload(payload: PopoverPayload): PopoverSection[] {
  return payload.preferences.sources.map((provider) => ({
    provider,
    name: PROVIDER_LABELS[provider],
    state: payload.snapshot[provider],
  }));
}

// One enabled source already owns the menu bar, so the choice is meaningless.
export function showMenuBarSetting(preferences: Preferences): boolean {
  return preferences.sources.length > 1;
}

export function selectedMenuBarSource(preferences: Preferences): ProviderId {
  return menuBarProvider(preferences.sources, preferences.menuBarSource);
}

/** Toggling the last enabled source off is refused; something must stay shown. */
export function toggledSources(
  sources: readonly ProviderId[],
  provider: ProviderId,
): ProviderId[] | null {
  if (!sources.includes(provider)) { return normalizeProviderIds([...sources, provider]); }
  if (sources.length === 1) { return null; }
  return sources.filter((id) => id !== provider);
}

export function isQuotaRefreshInProgress(payload: PopoverPayload): boolean {
  return sectionsForPayload(payload).some((section) => section.state.loading);
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
