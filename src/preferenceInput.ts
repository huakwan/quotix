import type { ProviderId } from "./quota/model";
import { isProviderId, normalizeProviderIds } from "./quota/model";
import type { ResetMode } from "./preferences";

export function asSources(value: unknown): ProviderId[] | null {
  return normalizeProviderIds(value);
}

export function asMenuBarSource(value: unknown): ProviderId | null {
  return isProviderId(value) ? value : null;
}

export function asResetMode(value: unknown): ResetMode | null {
  return value === "countdown" || value === "clock" ? value : null;
}

export function asShowPaceLine(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function asOpenAtLogin(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}
