import { app } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Quota, QuotaWindow } from "./model";

// Persists the last successfully-fetched quota so the tray can show real numbers
// immediately on launch instead of a loading state while the first poll runs —
// and to survive frequent 429 rate-limit stretches across restarts.

function cachePath(): string {
  return join(app.getPath("userData"), "quotix-quota-cache.json");
}

function normWindow(w: unknown): QuotaWindow | null {
  if (!w || typeof w !== "object") { return null; }
  const o = w as Record<string, unknown>;
  if (typeof o.usedPct !== "number") { return null; }
  return { usedPct: o.usedPct, resetsAt: typeof o.resetsAt === "number" ? o.resetsAt : null };
}

export function loadQuotaCache(): Quota | null {
  try {
    const parsed = JSON.parse(readFileSync(cachePath(), "utf8")) as Record<string, unknown>;
    if (typeof parsed.updatedAt !== "number") { return null; }
    return {
      updatedAt: parsed.updatedAt,
      session: normWindow(parsed.session),
      weekly: normWindow(parsed.weekly),
      planDetected: parsed.planDetected === true,
    };
  } catch {
    return null;
  }
}

export function saveQuotaCache(quota: Quota): void {
  try {
    writeFileSync(cachePath(), JSON.stringify(quota), "utf8");
  } catch {
    /* best-effort: never crash the app on a read-only home */
  }
}
