import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProviderId } from "./quota/model";
import { PROVIDER_IDS, isProviderId, menuBarProvider, normalizeProviderIds } from "./quota/model";

export type ResetMode = "countdown" | "clock";

export interface Preferences {
  sources: ProviderId[];
  menuBarSource: ProviderId;
  resetMode: ResetMode;
  showPaceLine: boolean;
  openAtLogin: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  sources: [...PROVIDER_IDS],
  menuBarSource: "claude",
  resetMode: "countdown",
  showPaceLine: true,
  openAtLogin: false,
};

interface ReadDeps { readFile(path: string): string; }
interface WriteDeps { writeFile(path: string, value: string): void; }

const defaultReadDeps: ReadDeps = { readFile: (path) => readFileSync(path, "utf8") };
const defaultWriteDeps: WriteDeps = { writeFile: (path, value) => writeFileSync(path, value, "utf8") };

function pathFor(userDataDir: string): string {
  return join(userDataDir, "quotix-preferences.json");
}

// Settings written before multi-select stored a single `source`, where "both"
// meant every provider. Keep reading it so an upgrade does not reset the choice.
function readSources(value: Record<string, unknown>): ProviderId[] {
  const sources = normalizeProviderIds(value.sources);
  if (sources) { return sources; }
  if (value.source === "both") { return [...PROVIDER_IDS]; }
  if (isProviderId(value.source)) { return [value.source]; }
  return [...DEFAULT_PREFERENCES.sources];
}

export function effectiveMenuBarSource(preferences: Preferences): ProviderId {
  return menuBarProvider(preferences.sources, preferences.menuBarSource);
}

export function loadPreferences(userDataDir: string, deps: ReadDeps = defaultReadDeps): Preferences {
  try {
    const value = JSON.parse(deps.readFile(pathFor(userDataDir))) as Record<string, unknown>;
    return {
      sources: readSources(value),
      menuBarSource: isProviderId(value.menuBarSource)
        ? value.menuBarSource : DEFAULT_PREFERENCES.menuBarSource,
      resetMode: value.resetMode === "clock" || value.resetMode === "countdown"
        ? value.resetMode : DEFAULT_PREFERENCES.resetMode,
      showPaceLine: typeof value.showPaceLine === "boolean"
        ? value.showPaceLine : DEFAULT_PREFERENCES.showPaceLine,
      openAtLogin: typeof value.openAtLogin === "boolean"
        ? value.openAtLogin : DEFAULT_PREFERENCES.openAtLogin,
    };
  } catch {
    return { ...DEFAULT_PREFERENCES, sources: [...DEFAULT_PREFERENCES.sources] };
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
