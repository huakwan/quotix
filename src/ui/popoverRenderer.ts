import type { QuotaWindow } from "../quota/model";
import type { UpdatePayload } from "./preload";

declare global {
  interface Window {
    quotix: {
      onUpdate(cb: (p: UpdatePayload) => void): void;
      refresh(): void;
      quit(): void;
    };
  }
}

let last: UpdatePayload | null = null;

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

function rowHtml(label: string, w: QuotaWindow | null, nowSec: number): string {
  if (!w) {
    return `<div class="row"><span class="label">${label}</span><span class="dot"></span>` +
      `<div class="track"></div><span class="pct">--%</span><span class="reset">--</span></div>`;
  }
  const pct = Math.round(w.usedPct);
  const cls = colorClass(pct);
  const width = Math.max(0, Math.min(100, w.usedPct));
  return `<div class="row">` +
    `<span class="label">${label}</span>` +
    `<span class="dot ${cls}"></span>` +
    `<div class="track"><div class="fill ${cls}" style="width:${width}%"></div></div>` +
    `<span class="pct">${pct}%</span>` +
    `<span class="reset">${countdown(w.resetsAt, nowSec)}</span>` +
    `</div>`;
}

function draw(): void {
  if (!last) { return; }
  const rows = document.getElementById("rows")!;
  const nowSec = last.nowSec;
  if (!last.result.ok) {
    rows.innerHTML = `<div class="unavailable">Quota unavailable (${last.result.reason})</div>`;
  } else {
    rows.innerHTML =
      rowHtml("5h", last.result.quota.session, nowSec) +
      rowHtml("Wk", last.result.quota.weekly, nowSec);
  }
}

window.quotix.onUpdate((p) => { last = p; draw(); });

document.getElementById("refresh")!.addEventListener("click", () => window.quotix.refresh());
document.getElementById("quit")!.addEventListener("click", () => window.quotix.quit());

// Live countdown between pushes: advance nowSec locally each second.
setInterval(() => {
  if (last) { last = { ...last, nowSec: last.nowSec + 1 }; draw(); }
}, 1000);
