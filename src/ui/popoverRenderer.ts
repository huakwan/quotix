import type { QuotaWindow, ReadResult } from "../quota/model";
import type { UpdatePayload } from "./preload";

declare global {
  interface Window {
    quotix: {
      onUpdate(cb: (p: UpdatePayload) => void): void;
      refresh(): void;
      quit(): void;
      resize(height: number): void;
    };
  }
}

declare const __APP_VERSION__: string;

type ResetMode = "countdown" | "clock";

let last: UpdatePayload | null = null;
let resetMode: ResetMode =
  localStorage.getItem("resetMode") === "clock" ? "clock" : "countdown";

function colorClass(pct: number): "green" | "amber" | "red" {
  if (pct > 90) { return "red"; }
  if (pct >= 70) { return "amber"; }
  return "green";
}

function countdown(resetsAt: number | null, nowSec: number): string {
  if (resetsAt === null) { return "--"; }
  let s = Math.max(0, Math.floor(resetsAt - nowSec));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60);
  if (d > 0) { return `${d}d${h}h`; }
  if (h > 0) { return `${h}h${m}m`; }
  return `${m}m`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Absolute wall-clock time of the reset. Same calendar day as now -> "23:45";
// otherwise "18Jul 04:56".
function clock(resetsAt: number | null, nowSec: number): string {
  if (resetsAt === null) { return "--"; }
  const d = new Date(resetsAt * 1000);
  const now = new Date(nowSec * 1000);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const time = `${hh}:${mm}`;
  const sameDay = d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay ? time : `${d.getDate()}${MONTHS[d.getMonth()]} ${time}`;
}

function resetText(resetsAt: number | null, nowSec: number): string {
  if (resetsAt === null) { return "--"; }
  return resetMode === "clock"
    ? `reset at ${clock(resetsAt, nowSec)}`
    : `reset in ${countdown(resetsAt, nowSec)}`;
}

function updatedAgo(updatedAt: number, nowSec: number): string {
  const s = Math.max(0, nowSec - updatedAt);
  if (s < 60) { return "Updated just now"; }
  const m = Math.floor(s / 60);
  if (m < 60) { return `Updated ${m} min ago`; }
  const h = Math.floor(m / 60);
  if (h < 24) { return `Updated ${h} hour ago`; }
  const d = Math.floor(h / 24);
  return `Updated ${d} day ago`;
}

function unavailableMessage(result: Extract<ReadResult, { ok: false }>): string {
  if (result.reason === "missing") {
    return "No Claude Code credentials found. Sign in with the Claude Code CLI to see quota here.";
  }
  if (result.error === "HTTP 401") { return "Sign-in expired. Retrying automatically…"; }
  if (result.error === "HTTP 429") { return "Rate limited by Anthropic. Retrying shortly…"; }
  if (result.error === "Request timed out") { return "Request timed out. Retrying shortly…"; }
  if (result.error?.startsWith("Network error")) { return "Network error. Check your connection."; }
  if (result.error?.startsWith("HTTP ")) { return `Anthropic API error (${result.error}).`; }
  return "Quota data unavailable.";
}

function rowHtml(label: string, w: QuotaWindow | null, nowSec: number): string {
  if (!w) {
    return `<div class="item"><div class="row"><span class="label">${label}</span>` +
      `<div class="track"></div><span class="pct">--%</span></div>` +
      `<div class="reset">--</div></div>`;
  }
  const pct = Math.round(w.usedPct);
  const cls = colorClass(pct);
  const width = Math.max(0, Math.min(100, w.usedPct));
  return `<div class="item"><div class="row">` +
    `<span class="label">${label}</span>` +
    `<div class="track"><div class="fill ${cls}" style="width:${width}%"></div></div>` +
    `<span class="pct">${pct}%</span>` +
    `</div>` +
    `<div class="reset">${resetText(w.resetsAt, nowSec)}</div></div>`;
}

function draw(): void {
  if (!last) { return; }
  const rows = document.getElementById("rows")!;
  const updated = document.getElementById("updated")!;
  const nowSec = last.nowSec;
  if (!last.result.ok) {
    rows.innerHTML = `<div class="unavailable">${unavailableMessage(last.result)}</div>`;
    updated.textContent = "";
  } else {
    rows.innerHTML =
      rowHtml("5H", last.result.quota.session, nowSec) +
      rowHtml("7D", last.result.quota.weekly, nowSec);
    updated.textContent = updatedAgo(last.result.quota.updatedAt, nowSec);
  }
}

window.quotix.onUpdate((p) => { last = p; draw(); });

document.getElementById("refresh")!.addEventListener("click", () => window.quotix.refresh());
document.getElementById("quit")!.addEventListener("click", () => window.quotix.quit());

document.getElementById("version")!.textContent = `v${__APP_VERSION__}`;

const resetModeEl = document.getElementById("reset-mode")!;
function syncResetModeButtons(): void {
  for (const btn of resetModeEl.querySelectorAll<HTMLButtonElement>(".seg-btn")) {
    btn.classList.toggle("active", btn.dataset.mode === resetMode);
  }
}
resetModeEl.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".seg-btn");
  if (!btn || !btn.dataset.mode) { return; }
  resetMode = btn.dataset.mode === "clock" ? "clock" : "countdown";
  localStorage.setItem("resetMode", resetMode);
  syncResetModeButtons();
  draw();
});
syncResetModeButtons();

// Auto-size the window to the content: report the panel height whenever it changes
// (rows count, error message, font load) so the main process resizes the window to fit.
const panel = document.querySelector(".panel")!;
let lastH = 0;
const ro = new ResizeObserver(() => {
  const h = Math.ceil(panel.getBoundingClientRect().height);
  if (h > 0 && h !== lastH) { lastH = h; window.quotix.resize(h); }
});
ro.observe(panel);

// Live countdown between pushes: advance nowSec locally each second.
setInterval(() => {
  if (last) { last = { ...last, nowSec: last.nowSec + 1 }; draw(); }
}, 1000);
