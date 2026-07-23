import {
  quotaRowsForProvider,
  sectionsForPayload,
  showMenuBarSetting,
  updatePresentation,
  type PopoverPayload,
  type UpdateAction,
} from "./popoverState";
import type { DisplaySource, ProviderId, QuotaWindow, SourceState } from "../quota/model";
import type { ResetMode } from "../preferences";

declare global {
  interface Window {
    quotix: {
      onUpdate(cb: (payload: PopoverPayload) => void): void;
      setSource(source: DisplaySource): void;
      setMenuBarSource(source: ProviderId): void;
      setResetMode(mode: ResetMode): void;
      setShowPaceLine(value: boolean): void;
      refresh(): void;
      checkForUpdates(): void;
      downloadUpdate(): void;
      cancelUpdate(): void;
      installUpdate(): void;
      revealUpdate(): void;
      quit(): void;
      resize(height: number): void;
    };
  }
}

declare const __APP_VERSION__: string;

let last: PopoverPayload | null = null;
let currentUpdateAction: UpdateAction | null = null;

function colorClass(pct: number): "green" | "amber" | "red" {
  if (pct > 90) { return "red"; }
  if (pct >= 75) { return "amber"; }
  return "green";
}

function countdown(resetsAt: number | null, nowSec: number): string {
  if (resetsAt === null) { return "--"; }
  let seconds = Math.max(0, Math.floor(resetsAt - nowSec));
  const days = Math.floor(seconds / 86400); seconds -= days * 86400;
  const hours = Math.floor(seconds / 3600); seconds -= hours * 3600;
  const minutes = Math.floor(seconds / 60);
  if (days > 0) { return `${days}d ${hours}h`; }
  if (hours > 0) { return `${hours}h ${minutes}m`; }
  return `${minutes}m`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function clock(resetsAt: number | null, nowSec: number): string {
  if (resetsAt === null) { return "--"; }
  const reset = new Date(resetsAt * 1000);
  const now = new Date(nowSec * 1000);
  const time = `${String(reset.getHours()).padStart(2, "0")}:${String(reset.getMinutes()).padStart(2, "0")}`;
  const sameDay = reset.getFullYear() === now.getFullYear()
    && reset.getMonth() === now.getMonth() && reset.getDate() === now.getDate();
  return sameDay ? time : `${reset.getDate()} ${MONTHS[reset.getMonth()]} ${time}`;
}

function resetText(resetsAt: number | null, nowSec: number, mode: ResetMode): string {
  if (resetsAt === null) { return "--"; }
  return mode === "clock" ? `reset at ${clock(resetsAt, nowSec)}` : `reset in ${countdown(resetsAt, nowSec)}`;
}

const STALE_SECONDS = 10 * 60;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const INFO_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" `
  + `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">`
  + `<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`;

function updatedLine(quota: { updatedAt: number }, state: SourceState, nowSec: number): string {
  const text = updatedAgo(quota.updatedAt, nowSec);
  const stale = nowSec - quota.updatedAt > STALE_SECONDS;
  const error = state.result.ok ? state.result.diagnostic : undefined;
  if (!stale || !error) { return `<div class="updated">${text}</div>`; }
  return `<div class="updated"><span class="info" tabindex="-1">${INFO_ICON}`
    + `<span class="tooltip">${escapeHtml(error)}</span></span>${text}</div>`;
}

function updatedAgo(updatedAt: number, nowSec: number): string {
  const seconds = Math.max(0, nowSec - updatedAt);
  if (seconds <= 10) { return "updated just now"; }
  if (seconds < 60) { return `updated ${seconds} sec ago`; }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) { return `updated ${minutes} min ago`; }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) { return `updated ${hours} hour ago`; }
  return `updated ${Math.floor(hours / 24)} day ago`;
}

function unavailableMessage(provider: ProviderId, state: SourceState): string {
  if (state.loading) { return "Loading…"; }
  if (provider === "claude" && !state.result.ok && state.result.reason === "missing") {
    return "No Claude Code credentials found. Sign in with the Claude Code CLI.";
  }
  if (provider === "codex" && !state.result.ok && state.result.reason === "missing") {
    return "Codex CLI was not found or is not signed in.";
  }
  return "Quota data unavailable. Retrying automatically…";
}

// Marker showing where usage "should" be at the current point in the window,
// i.e. the fraction of the window that has elapsed (paced usage line).
function guideHtml(periodSeconds: number, resetsAt: number | null, nowSec: number, show: boolean): string {
  if (!show || !periodSeconds || resetsAt === null) { return ""; }
  const remaining = resetsAt - nowSec;
  const elapsedPct = Math.max(0, Math.min(100, ((periodSeconds - remaining) / periodSeconds) * 100));
  return `<div class="guide" style="left:${elapsedPct}%"></div>`;
}

function rowHtml(
  label: string,
  window: QuotaWindow | null,
  periodSeconds: number,
  nowSec: number,
  mode: ResetMode,
  showPaceLine: boolean,
): string {
  const escapedLabel = escapeHtml(label);
  if (!window) {
    return `<div class="item"><div class="row"><span class="label">${escapedLabel}</span>`
      + `<div class="track"></div><span class="pct">0%</span></div><div class="reset">(not started)</div></div>`;
  }
  const pct = Math.round(window.usedPct);
  const width = Math.max(0, Math.min(100, window.usedPct));
  return `<div class="item"><div class="row"><span class="label">${escapedLabel}</span>`
    + `<div class="track"><div class="fill ${colorClass(pct)}" style="width:${width}%"></div>`
    + `${guideHtml(periodSeconds, window.resetsAt, nowSec, showPaceLine)}</div>`
    + `<span class="pct">${pct}%</span></div>`
    + `<div class="reset">${resetText(window.resetsAt, nowSec, mode)}</div></div>`;
}

function sectionHtml(provider: ProviderId, name: string, state: SourceState, payload: PopoverPayload): string {
  const logo = provider === "claude" ? "../assets/anthropic.svg" : "../assets/openai.svg";
  const quota = state.lastGood ?? (state.result.ok ? state.result.quota : null);
  const body = quota
    ? quotaRowsForProvider(provider, quota)
      .map((row) => rowHtml(
        row.label, row.window, row.periodSeconds, payload.nowSec, payload.preferences.resetMode, payload.preferences.showPaceLine,
      ))
      .join("")
      + updatedLine(quota, state, payload.nowSec)
    : `<div class="unavailable">${unavailableMessage(provider, state)}</div>`;
  return `<section class="source-section"><div class="header"><img class="${provider === "codex" ? "logo codex-logo" : "logo"}" src="${logo}" alt=""/>`
    + `<span>${name}</span></div>${body}</section>`;
}

function syncButtons(containerId: string, value: string): void {
  const container = document.getElementById(containerId)!;
  for (const button of container.querySelectorAll<HTMLButtonElement>(".seg-btn")) {
    button.classList.toggle("active", button.dataset.value === value);
  }
}

function draw(): void {
  if (!last) { return; }
  document.getElementById("sources")!.innerHTML = sectionsForPayload(last)
    .map((section) => sectionHtml(section.provider, section.name, section.state, last!)).join("");
  syncButtons("source-mode", last.preferences.source);
  syncButtons("menu-source", last.preferences.menuBarSource);
  syncButtons("reset-mode", last.preferences.resetMode);
  syncButtons("pace-mode", last.preferences.showPaceLine ? "on" : "off");
  document.getElementById("menu-source-row")!.classList.toggle("hidden", !showMenuBarSetting(last.preferences));
  const update = updatePresentation(last.update ?? { status: "idle" });
  const updateRow = document.getElementById("update-row")!;
  const updateLabel = document.getElementById("update-label")!;
  const updateButton = document.getElementById("update-action")! as HTMLButtonElement;
  const updateProgress = document.getElementById("update-progress")! as HTMLProgressElement;
  updateRow.classList.toggle("hidden", !update.visible);
  updateLabel.textContent = update.label;
  currentUpdateAction = update.action;
  updateButton.textContent = update.actionLabel;
  updateButton.classList.toggle("hidden", update.action === null);
  updateButton.disabled = update.action === null;
  updateProgress.classList.toggle("hidden", update.progress === null);
  updateProgress.value = update.progress ?? 0;
}

function onSegment(id: string, callback: (value: string) => void): void {
  document.getElementById(id)!.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".seg-btn");
    if (button?.dataset.value) { callback(button.dataset.value); }
  });
}

window.quotix.onUpdate((payload) => { last = payload; draw(); });
onSegment("source-mode", (value) => window.quotix.setSource(value as DisplaySource));
onSegment("menu-source", (value) => window.quotix.setMenuBarSource(value as ProviderId));
onSegment("reset-mode", (value) => window.quotix.setResetMode(value as ResetMode));
onSegment("pace-mode", (value) => window.quotix.setShowPaceLine(value === "on"));
document.getElementById("refresh")!.addEventListener("click", () => window.quotix.refresh());
document.getElementById("update-action")!.addEventListener("click", () => {
  switch (currentUpdateAction) {
    case "download": window.quotix.downloadUpdate(); break;
    case "cancel": window.quotix.cancelUpdate(); break;
    case "install": window.quotix.installUpdate(); break;
    case "reveal": window.quotix.revealUpdate(); break;
    case "retry": window.quotix.checkForUpdates(); break;
  }
});
document.getElementById("quit")!.addEventListener("click", () => window.quotix.quit());
document.getElementById("version")!.textContent = `hu@KwaN - v${__APP_VERSION__}`;

const panel = document.querySelector(".panel")!;
let lastHeight = 0;
new ResizeObserver(() => {
  const height = Math.ceil(panel.getBoundingClientRect().height);
  if (height > 0 && height !== lastHeight) { lastHeight = height; window.quotix.resize(height); }
}).observe(panel);

setInterval(() => {
  if (last) { last = { ...last, nowSec: last.nowSec + 1 }; draw(); }
}, 1000);
