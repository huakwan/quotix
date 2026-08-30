import type { ProviderId } from "../quota/model";

/** Section headings in the popover, one per provider. */
export const PROVIDER_LABELS: Record<ProviderId, string> = {
  claude: "Claude Code",
  codex: "Codex OpenAI",
  opencode: "OpenCode Go",
};

/**
 * Popover markup is served from `dist/`, so asset paths are relative to it and
 * resolve against the packaged `assets/` directory.
 */
export const PROVIDER_LOGOS: Record<ProviderId, string> = {
  claude: "../assets/anthropic.svg",
  codex: "../assets/openai.svg",
  opencode: "../assets/opencode.svg",
};

/**
 * Claude ships a mark that carries its own colour and reads on either appearance.
 * The other assets are authored as black glyphs, so they need inverting when the
 * system is in dark mode.
 */
export function logoNeedsInverting(provider: ProviderId): boolean {
  return provider === "codex" || provider === "opencode";
}
