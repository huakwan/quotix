import type { DisplaySource, ProviderId, QuotaWindow, SourceState } from "../quota/model";
import type { ResetMode } from "../preferences";
import { quotaRowsForProvider, sectionsForPayload, showMenuBarSetting, type PopoverPayload } from "./popoverState";

declare global {
  interface Window {
    quotix: {
      onUpdate(cb: (payload: PopoverPayload) => void): void;
      setSource(source: DisplaySource): void;
      setMenuBarSource(source: ProviderId): void;
      setResetMode(mode: ResetMode): void;
      refresh(): void;
      quit(): void;
      resize(height: number): void;
    };
  }
}

declare const __APP_VERSION__: string;

let last: PopoverPayload | null = null;

function colorClass(pct: number): "green" | "amber" | "red" {
  if (pct > 90) { return "red"; }
  if (pct >= 70) { return "amber"; }
  return "green";
}

function countdown(resetsAt: number | null, nowSec: number): string {
  if (resetsAt === null) { return "--"; }
  let seconds = Math.max(0, Math.floor(resetsAt - nowSec));
  const days = Math.floor(seconds / 86400); seconds -= days * 86400;
  const hours = Math.floor(seconds / 3600); seconds -= hours * 3600;
  const minutes = Math.floor(seconds / 60);
  if (days > 0) { return `${days}d${hours}h`; }
  if (hours > 0) { return `${hours}h${minutes}m`; }
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
  return sameDay ? time : `${reset.getDate()}${MONTHS[reset.getMonth()]} ${time}`;
}

function resetText(resetsAt: number | null, nowSec: number, mode: ResetMode): string {
  if (resetsAt === null) { return "--"; }
  return mode === "clock" ? `reset at ${clock(resetsAt, nowSec)}` : `reset in ${countdown(resetsAt, nowSec)}`;
}

function updatedAgo(updatedAt: number, nowSec: number): string {
  const seconds = Math.max(0, nowSec - updatedAt);
  if (seconds <= 5) { return "Updated just now"; }
  if (seconds < 60) { return `Updated ${seconds} sec ago`; }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) { return `Updated ${minutes} min ago`; }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) { return `Updated ${hours} hour ago`; }
  return `Updated ${Math.floor(hours / 24)} day ago`;
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

function rowHtml(label: string, window: QuotaWindow | null, nowSec: number, mode: ResetMode): string {
  if (!window) {
    return `<div class="item"><div class="row"><span class="label">${label}</span>`
      + `<div class="track"></div><span class="pct">--%</span></div><div class="reset">--</div></div>`;
  }
  const pct = Math.round(window.usedPct);
  const width = Math.max(0, Math.min(100, window.usedPct));
  return `<div class="item"><div class="row"><span class="label">${label}</span>`
    + `<div class="track"><div class="fill ${colorClass(pct)}" style="width:${width}%"></div></div>`
    + `<span class="pct">${pct}%</span></div>`
    + `<div class="reset">${resetText(window.resetsAt, nowSec, mode)}</div></div>`;
}

function sectionHtml(provider: ProviderId, name: string, state: SourceState, payload: PopoverPayload): string {
  const logo = provider === "claude" ? "../assets/anthropic.svg" : "../assets/openai.svg";
  const quota = state.lastGood ?? (state.result.ok ? state.result.quota : null);
  const body = quota
    ? quotaRowsForProvider(provider, quota)
      .map((row) => rowHtml(row.label, row.window, payload.nowSec, payload.preferences.resetMode))
      .join("")
      + `<div class="updated">${updatedAgo(quota.updatedAt, payload.nowSec)}</div>`
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
  document.getElementById("menu-source-row")!.classList.toggle("hidden", !showMenuBarSetting(last.preferences));
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
document.getElementById("refresh")!.addEventListener("click", () => window.quotix.refresh());
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
