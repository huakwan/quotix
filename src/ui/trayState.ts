import type { ProviderId, SourceState } from "../quota/model";

export interface TrayDisplayState {
  provider: ProviderId;
  session: number | null;
  weekly: number | null;
  loading: boolean;
  unavailable: boolean;
}

export function trayWindowVisibility(display: TrayDisplayState): {
  session: boolean;
  weekly: boolean;
} {
  if (display.provider === "claude") {
    return { session: true, weekly: true };
  }
  return { session: display.session !== null, weekly: display.weekly !== null };
}

export interface TrayWindowPresentation {
  session: boolean;
  weekly: boolean;
  compactWeekly: boolean;
}

export function trayWindowPresentation(display: TrayDisplayState): TrayWindowPresentation {
  const visibility = trayWindowVisibility(display);
  return {
    ...visibility,
    compactWeekly: !visibility.session && visibility.weekly,
  };
}

export function trayDisplayState(provider: ProviderId, state: SourceState): TrayDisplayState {
  const quota = state.lastGood ?? (state.result.ok ? state.result.quota : null);
  return {
    provider,
    session: quota?.session?.usedPct ?? null,
    weekly: quota?.weekly?.usedPct ?? null,
    loading: state.loading && quota === null,
    unavailable: !state.loading && quota === null && !state.result.ok,
  };
}
