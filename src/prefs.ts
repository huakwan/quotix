import { app } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Primary = "session" | "weekly";

function prefsPath(): string {
  return join(app.getPath("userData"), "quotix-prefs.json");
}

export function loadPrimary(): Primary {
  try {
    const raw = readFileSync(prefsPath(), "utf8");
    const parsed = JSON.parse(raw) as { primary?: unknown };
    return parsed.primary === "weekly" ? "weekly" : "session";
  } catch {
    return "session";
  }
}

export function savePrimary(p: Primary): void {
  try {
    writeFileSync(prefsPath(), JSON.stringify({ primary: p }), "utf8");
  } catch {
    /* best-effort: never crash the app on a read-only home */
  }
}
