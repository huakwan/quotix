import type { DisplaySource, ProviderId } from "./quota/model";
import type { ResetMode } from "./preferences";

export function asDisplaySource(value: unknown): DisplaySource | null {
  return value === "claude" || value === "codex" || value === "both" ? value : null;
}

export function asMenuBarSource(value: unknown): ProviderId | null {
  return value === "claude" || value === "codex" ? value : null;
}

export function asResetMode(value: unknown): ResetMode | null {
  return value === "countdown" || value === "clock" ? value : null;
}
