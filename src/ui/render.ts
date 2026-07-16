import { ReadResult } from "../quota/model";

export function trayTooltip(result: ReadResult, nowSec: number): string {
  if (!result.ok) { return `Quota unavailable (${result.reason})`; }
  const { session, weekly, updatedAt } = result.quota;
  const ageSec = Math.max(0, nowSec - updatedAt);
  const sessionLine = session ? `Session: ${session.usedPct.toFixed(1)}%` : "Session: unavailable";
  const weeklyLine = weekly ? `Weekly: ${weekly.usedPct.toFixed(1)}%` : "Weekly: unavailable";
  return `${sessionLine}\n${weeklyLine}\nUpdated ${ageSec}s ago`;
}
