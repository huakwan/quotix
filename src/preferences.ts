import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DisplaySource, ProviderId } from "./quota/model";

export type ResetMode = "countdown" | "clock";

export interface Preferences {
  source: DisplaySource;
  menuBarSource: ProviderId;
  resetMode: ResetMode;
}

export const DEFAULT_PREFERENCES: Preferences = {
  source: "both",
  menuBarSource: "claude",
  resetMode: "countdown",
};

interface ReadDeps { readFile(path: string): string; }
interface WriteDeps { writeFile(path: string, value: string): void; }

const defaultReadDeps: ReadDeps = { readFile: (path) => readFileSync(path, "utf8") };
const defaultWriteDeps: WriteDeps = { writeFile: (path, value) => writeFileSync(path, value, "utf8") };

function pathFor(userDataDir: string): string {
  return join(userDataDir, "quotix-preferences.json");
}

export function effectiveMenuBarSource(preferences: Preferences): ProviderId {
  return preferences.source === "both" ? preferences.menuBarSource : preferences.source;
}

export function loadPreferences(userDataDir: string, deps: ReadDeps = defaultReadDeps): Preferences {
  try {
    const value = JSON.parse(deps.readFile(pathFor(userDataDir))) as Record<string, unknown>;
    return {
      source: value.source === "claude" || value.source === "codex" || value.source === "both"
        ? value.source : DEFAULT_PREFERENCES.source,
      menuBarSource: value.menuBarSource === "claude" || value.menuBarSource === "codex"
        ? value.menuBarSource : DEFAULT_PREFERENCES.menuBarSource,
      resetMode: value.resetMode === "clock" || value.resetMode === "countdown"
        ? value.resetMode : DEFAULT_PREFERENCES.resetMode,
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function savePreferences(
  userDataDir: string,
  preferences: Preferences,
  deps: WriteDeps = defaultWriteDeps,
): void {
  try { deps.writeFile(pathFor(userDataDir), JSON.stringify(preferences)); }
  catch { /* best effort */ }
}
