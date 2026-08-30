import { canActivateUpdateAction, diagnosticText, isQuotaRefreshInProgress, quotaRowsForProvider, sectionsForPayload, selectedMenuBarSource, showMenuBarSetting, toggledSources, updatePresentation, type PopoverPayload, type UpdateAction, } from "./popoverState";
import type { ProviderId, QuotaWindow, SourceState } from "../../quota/model";
import { isProviderId } from "../../quota/model";
import { PROVIDER_LOGOS, logoNeedsInverting } from "../branding";
import { keepButtonsUnfocused } from "../buttonFocus";
import type { ResetMode, TrayIconColor } from "../../preferences";

declare global {
  interface QuotixApi {
    onUpdate(cb: (payload: PopoverPayload) => void): void;
    setSources(sources: ProviderId[]): void;
    setMenuBarSource(source: ProviderId): void;
    setResetMode(mode: ResetMode): void;
    setShowPaceLine(value: boolean): void;
    setTrayIconColor(value: TrayIconColor): void;
    setOpenAtLogin(value: boolean): void;
    refresh(): Promise<void>;
    openAbout(): void;
    checkForUpdates(): void;
    downloadUpdate(): void;
    cancelUpdate(): void;
    installUpdate(): void;
    revealUpdate(): void;
    quit(): void;
    resize(height: number): void;
  }

  interface Window {
    quotix: QuotixApi;
  }
}

declare const __APP_VERSION__: string;

let last: PopoverPayload | null = null;
let currentUpdateAction: UpdateAction | null = null;
let refreshPending = false;

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
    + `<span class="tooltip">${escapeHtml(diagnosticText(error))}</span></span>${text}</div>`;
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
  // The provider knows which of several causes it hit; prefer its wording over a
  // guess made from the coarse reason alone.
  if (!state.result.ok && state.result.error) { return diagnosticText(state.result.error); }
  if (provider === "claude" && !state.result.ok && state.result.reason === "missing") {
    return "No Claude Code credentials found. Sign in with the Claude Code CLI.";
  }
  if (provider === "codex" && !state.result.ok && state.result.reason === "missing") {
    return "Codex CLI was not found or is not signed in.";
  }
  if (provider === "opencode" && !state.result.ok && state.result.reason === "missing") {
    return "No OpenCode Go key was found. Add it with opencode auth login.";
  }
  return "Quota data unavailable. Retrying automatically…";
}

// Marker showing where usage "should" be at the current point in the window,
// i.e. the fraction of the window that has elapsed (paced usage line).
function guideHtml(periodSeconds: number, resetsAt: number | null, nowSec: number, show: boolean): string {
  if (!show || !periodSeconds || resetsAt === null) { return ""; }
  const remaining = resetsAt - nowSec;
  // A reset more than a full period away means the data still sees the window
  // as not started (now is before the previous reset); the elapsed fraction is
  // undefined there, so do not pin the marker to the left edge.
  if (remaining > periodSeconds) { return ""; }
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
    + `<div class="track">${width > 0 ? `<div class="fill ${colorClass(pct)}" style="width:${width}%"></div>` : ""}`
    + `${guideHtml(periodSeconds, window.resetsAt, nowSec, showPaceLine)}</div>`
    + `<span class="pct">${pct}%</span></div>`
    + `<div class="reset">${resetText(window.resetsAt, nowSec, mode)}</div></div>`;
}

function sectionHtml(provider: ProviderId, name: string, state: SourceState, payload: PopoverPayload): string {
  const logo = PROVIDER_LOGOS[provider];
  const logoClass = logoNeedsInverting(provider) ? "logo monochrome-logo" : "logo";
  const quota = state.lastGood ?? (state.result.ok ? state.result.quota : null);
  const body = quota
    ? quotaRowsForProvider(provider, quota)
      .map((row) => rowHtml(
        row.label, row.window, row.periodSeconds, payload.nowSec, payload.preferences.resetMode, payload.preferences.showPaceLine,
      ))
      .join("")
      + updatedLine(quota, state, payload.nowSec)
    : `<div class="unavailable">${unavailableMessage(provider, state)}</div>`;
  return `<section class="source-section"><div class="header"><img class="${logoClass}" src="${logo}" alt=""/>`
    + `<span>${name}</span></div>${body}</section>`;
}

function syncButtons(containerId: string, value: string): void {
  const container = document.getElementById(containerId)!;
  for (const button of container.querySelectorAll<HTMLButtonElement>(".seg-btn")) {
    button.classList.toggle("active", button.dataset.value === value);
  }
}

// The source row is a multi-select, and the menu-bar row only offers what the
// source row enabled, so both are driven off the enabled set rather than one value.
function syncSourceButtons(sources: readonly ProviderId[], menuBarSource: ProviderId): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>("#source-mode .seg-btn")) {
    button.classList.toggle("active", sources.includes(button.dataset.value as ProviderId));
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>("#menu-source .seg-btn")) {
    const provider = button.dataset.value as ProviderId;
    button.classList.toggle("hidden", !sources.includes(provider));
    button.classList.toggle("active", provider === menuBarSource);
  }
}

function draw(): void {
  if (!last) { return; }
  document.getElementById("sources")!.innerHTML = sectionsForPayload(last)
    .map((section) => sectionHtml(section.provider, section.name, section.state, last!)).join("");
  syncSourceButtons(last.preferences.sources, selectedMenuBarSource(last.preferences));
  syncButtons("reset-mode", last.preferences.resetMode);
  syncButtons("pace-mode", last.preferences.showPaceLine ? "on" : "off");
  syncButtons("tray-icon-color", last.preferences.trayIconColor);
  syncButtons("login-mode", last.preferences.openAtLogin ? "on" : "off");
  document.getElementById("menu-source-row")!.classList.toggle("hidden", !showMenuBarSetting(last.preferences));
  const refreshButton = document.getElementById("refresh")! as HTMLButtonElement;
  refreshButton.disabled = refreshPending || isQuotaRefreshInProgress(last);
  refreshButton.title = refreshButton.disabled ? "Refreshing…" : "Refresh now";
  const update = updatePresentation(last.update ?? { status: "idle" });
  const updateRow = document.getElementById("update-row")!;
  const updateLabel = document.getElementById("update-label")!;
  const updateButton = document.getElementById("update-action")! as HTMLButtonElement;
  const updateProgress = document.getElementById("update-progress")!;
  const updateProgressFill = document.getElementById("update-progress-fill")!;
  const progress = update.progress ?? 0;
  updateRow.classList.toggle("hidden", !update.visible);
  updateLabel.textContent = update.progress === null
    ? update.label
    : `${update.label} ${Math.round(progress)}%`;
  currentUpdateAction = update.action;
  updateButton.textContent = update.actionLabel;
  updateButton.classList.toggle("hidden", update.action === null);
  updateButton.disabled = update.action === null;
  updateButton.tabIndex = -1;
  if (document.activeElement === updateButton) { updateButton.blur(); }
  updateProgress.classList.toggle("hidden", update.progress === null);
  updateProgress.setAttribute("aria-valuenow", String(Math.round(progress)));
  updateProgressFill.style.width = `${progress}%`;
}

function onSegment(id: string, callback: (value: string) => void): void {
  document.getElementById(id)!.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".seg-btn");
    if (button?.dataset.value) { callback(button.dataset.value); }
  });
}

window.quotix.onUpdate((payload) => { last = payload; draw(); });
keepButtonsUnfocused();
onSegment("source-mode", (value) => {
  if (!last || !isProviderId(value)) { return; }
  const sources = toggledSources(last.preferences.sources, value);
  if (!sources) { return; }
  // Paint the new selection now; the main process echoes it back on the next update.
  last = { ...last, preferences: { ...last.preferences, sources } };
  draw();
  window.quotix.setSources(sources);
});
onSegment("menu-source", (value) => window.quotix.setMenuBarSource(value as ProviderId));
onSegment("reset-mode", (value) => window.quotix.setResetMode(value as ResetMode));
onSegment("pace-mode", (value) => window.quotix.setShowPaceLine(value === "on"));
onSegment("tray-icon-color", (value) => window.quotix.setTrayIconColor(value as TrayIconColor));
onSegment("login-mode", (value) => window.quotix.setOpenAtLogin(value === "on"));
const refreshButton = document.getElementById("refresh")! as HTMLButtonElement;
refreshButton.addEventListener("click", () => {
  if (refreshPending) { return; }
  refreshPending = true;
  refreshButton.disabled = true;
  window.quotix.refresh()
    .catch(() => undefined)
    .finally(() => {
      refreshPending = false;
      draw();
    });
});
document.getElementById("about")!.addEventListener("click", () => window.quotix.openAbout());
const updateActionButton = document.getElementById("update-action")!;
updateActionButton.addEventListener("click", (event) => {
  if (!canActivateUpdateAction(currentUpdateAction, event.detail)) { return; }
  switch (currentUpdateAction) {
    case "download": window.quotix.downloadUpdate(); break;
    case "cancel": window.quotix.cancelUpdate(); break;
    case "install": window.quotix.installUpdate(); break;
    case "reveal": window.quotix.revealUpdate(); break;
    case "retry": window.quotix.checkForUpdates(); break;
  }
});
document.getElementById("quit")!.addEventListener("click", () => window.quotix.quit());
document.getElementById("version")!.textContent = `v${__APP_VERSION__}`;

const panel = document.querySelector(".panel")!;
let lastHeight = 0;
new ResizeObserver(() => {
  const height = Math.ceil(panel.getBoundingClientRect().height);
  if (height > 0 && height !== lastHeight) { lastHeight = height; window.quotix.resize(height); }
}).observe(panel);

setInterval(() => {
  if (last) { last = { ...last, nowSec: last.nowSec + 1 }; draw(); }
}, 1000);
