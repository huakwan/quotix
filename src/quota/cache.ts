import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProviderId, Quota, QuotaWindow } from "./model";

export interface QuotaCache {
  readonly path: string;
  load(): Quota | null;
  save(quota: Quota): void;
}

interface CacheDeps {
  readFile(path: string): string;
  writeFile(path: string, value: string): void;
}

const defaultDeps: CacheDeps = {
  readFile: (path) => readFileSync(path, "utf8"),
  writeFile: (path, value) => writeFileSync(path, value, "utf8"),
};

function normWindow(value: unknown): QuotaWindow | null {
  if (value === null) { return null; }
  if (!value || typeof value !== "object") { throw new Error("invalid quota window"); }
  const window = value as Record<string, unknown>;
  if (typeof window.usedPct !== "number") { throw new Error("invalid usage"); }
  if (!(typeof window.resetsAt === "number" || window.resetsAt === null)) {
    throw new Error("invalid reset");
  }
  return { usedPct: window.usedPct, resetsAt: window.resetsAt };
}

function parseQuota(raw: string): Quota {
  const value = JSON.parse(raw) as Record<string, unknown>;
  if (typeof value.updatedAt !== "number") { throw new Error("invalid timestamp"); }
  return {
    updatedAt: value.updatedAt,
    session: normWindow(value.session),
    weekly: normWindow(value.weekly),
    planDetected: value.planDetected === true,
  };
}

export function createQuotaCache(
  userDataDir: string,
  provider: ProviderId,
  deps: CacheDeps = defaultDeps,
): QuotaCache {
  const path = join(userDataDir, `quotix-quota-cache-${provider}.json`);
  const legacyPath = join(userDataDir, "quotix-quota-cache.json");
  return {
    path,
    load: () => {
      try { return parseQuota(deps.readFile(path)); }
      catch {
        if (provider !== "claude") { return null; }
        try { return parseQuota(deps.readFile(legacyPath)); }
        catch { return null; }
      }
    },
    save: (quota) => {
      try { deps.writeFile(path, JSON.stringify(quota)); }
      catch { /* best effort */ }
    },
  };
}

// Compatibility for the current composition root; removed when main.ts adopts
// provider-specific caches.
function electronUserDataDir(): string {
  const { app } = require("electron") as typeof import("electron");
  return app.getPath("userData");
}

export function loadQuotaCache(): Quota | null {
  return createQuotaCache(electronUserDataDir(), "claude").load();
}

export function saveQuotaCache(quota: Quota): void {
  createQuotaCache(electronUserDataDir(), "claude").save(quota);
}
