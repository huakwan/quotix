import { QuotaWindow, ReadResult } from "../quota/model";
import { Primary } from "../prefs";

export function bar(pct: number, width: number): string {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round((clamped / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

export function countdown(resetsAt: number, nowSec: number): string {
  let s = Math.max(0, Math.floor(resetsAt - nowSec));
  const days = Math.floor(s / 86400); s -= days * 86400;
  const hours = Math.floor(s / 3600); s -= hours * 3600;
  const mins = Math.floor(s / 60);
  if (days > 0) { return `${days}d${hours}h`; }
  if (hours > 0) { return `${hours}h${mins}m`; }
  return `${mins}m`;
}

function segment(label: string, w: QuotaWindow | null, width: number, _nowSec: number): string {
  if (!w) { return `${label} --%`; }
  const pct = Math.round(w.usedPct);
  return `${label} ${bar(w.usedPct, width)} ${pct}%`;
}

// Plain text for Tray.setTitle() — no codicons/theme colors, those are VSCode-only.
export function trayTitle(result: ReadResult, primary: Primary, width: number, nowSec: number): string {
  if (!result.ok) { return "Quota: --"; }
  if (primary === "weekly") {
    return segment("W", result.quota.weekly, width, nowSec);
  }
  return segment("S", result.quota.session, width, nowSec);
}

export function trayTooltip(result: ReadResult, nowSec: number): string {
  if (!result.ok) { return `Quota unavailable (${result.reason})`; }
  const { session, weekly, updatedAt } = result.quota;
  const ageSec = Math.max(0, nowSec - updatedAt);
  const sessionLine = session ? `Session: ${session.usedPct.toFixed(1)}%` : "Session: unavailable";
  const weeklyLine = weekly ? `Weekly: ${weekly.usedPct.toFixed(1)}%` : "Weekly: unavailable";
  return `${sessionLine}\n${weeklyLine}\nUpdated ${ageSec}s ago`;
}
