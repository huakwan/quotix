import { app, Tray, Menu, nativeImage, nativeTheme, ipcMain, BrowserWindow } from "electron";
import { createCachedTokenProvider } from "./quota/oauthCredentials";
import { fetchOAuthQuota } from "./quota/oauthSource";
import { trayTooltip } from "./ui/render";
import { renderTray } from "./ui/trayCapture";
import { ReadResult } from "./quota/model";
import { loadQuotaCache, saveQuotaCache } from "./quota/cache";
import { loadPrimary, savePrimary, Primary } from "./prefs";
import { createPopover, togglePopover } from "./ui/popoverWindow";

const REFRESH_INTERVAL_SECONDS = 60;
const RENDER_TICK_SECONDS = 10;

type OkResult = Extract<ReadResult, { ok: true }>;

let tray: Tray | undefined;
let popover: BrowserWindow | undefined;
let lastResult: ReadResult = { ok: false, reason: "missing" };
let lastGood: OkResult | null = null;   // survives 429/network errors so the tray keeps showing numbers
let lastError: string | undefined;      // set while the latest fetch is failing
let pollTimer: NodeJS.Timeout | undefined;
let primary: Primary = "session";

function describeError(e: string | undefined): string {
  if (e === "HTTP 429") { return "rate limited"; }
  if (e === "HTTP 401") { return "auth expired"; }
  return e ?? "unavailable";
}

const tokenProvider = createCachedTokenProvider();

function render(): void {
  if (!tray) { return; }
  const nowSec = Math.floor(Date.now() / 1000);
  const stale = !lastResult.ok;
  // Always draw the full inline row (5H [bar] % | 7D [bar] %) with the system font.
  // With last-good data: real numbers, dimmed while a fetch is failing.
  // With no data yet: empty tracks + "N/A", dimmed.
  const session = lastGood?.quota.session?.usedPct ?? null;
  const weekly = lastGood?.quota.weekly?.usedPct ?? null;
  tray.setTitle("");
  void updateTrayImage(session, weekly, stale);
  tray.setToolTip(tooltip(nowSec));
  if (popover && !popover.isDestroyed()) {
    // Feed the popover the last-good data too, so it shows numbers rather than "unavailable".
    popover.webContents.send("quota:update", { result: lastGood ?? lastResult, primary, nowSec, stale });
  }
}

function tooltip(nowSec: number): string {
  const base = lastGood ? trayTooltip(lastGood, nowSec) : trayTooltip(lastResult, nowSec);
  if (lastGood && !lastResult.ok) { return `${base}\n⚠ ${describeError(lastError)} — showing last data`; }
  return base;
}

async function updateTrayImage(session: number | null, weekly: number | null, stale: boolean): Promise<void> {
  try {
    const img = await renderTray(session, weekly, nativeTheme.shouldUseDarkColors, stale);
    tray?.setImage(img);
  } catch {
    /* keep last image on capture failure */
  }
}

async function poll(): Promise<void> {
  const token = tokenProvider.get();
  if (!token.ok) {
    lastResult = { ok: false, reason: "missing" };
    lastError = "no token";
    render();
    schedule(REFRESH_INTERVAL_SECONDS);
    return;
  }

  const result = await fetchOAuthQuota(token.token, fetch);
  if (result.tokenInvalid) { tokenProvider.invalidate(); }
  lastResult = result;
  if (result.ok) { lastGood = result; lastError = undefined; saveQuotaCache(result.quota); }
  else { lastError = result.error ?? result.reason; }
  render();
  schedule(result.retryAfterSeconds ?? REFRESH_INTERVAL_SECONDS);
}

function schedule(delaySeconds: number): void {
  if (pollTimer) { clearTimeout(pollTimer); }
  pollTimer = setTimeout(() => { void poll(); }, delaySeconds * 1000);
}

const contextMenu = Menu.buildFromTemplate([
  { label: "Refresh now", click: () => void poll() },
  { type: "separator" },
  { label: "Quit", role: "quit" },
]);

app.whenReady().then(() => {
  app.dock?.hide();
  primary = loadPrimary();

  // Seed from the on-disk cache so the tray shows real (stale) numbers before the first poll.
  const cached = loadQuotaCache();
  if (cached) { lastGood = { ok: true, quota: cached }; }

  popover = createPopover();

  tray = new Tray(nativeImage.createEmpty());
  tray.on("click", () => { if (popover && tray) { togglePopover(popover, tray.getBounds()); } });
  tray.on("right-click", () => { tray?.popUpContextMenu(contextMenu); });

  ipcMain.on("quota:setPrimary", (_e, p: Primary) => {
    primary = p === "weekly" ? "weekly" : "session";
    savePrimary(primary);
    render();
  });
  ipcMain.on("quota:refresh", () => void poll());
  ipcMain.on("quota:quit", () => app.quit());

  render();
  void poll();
  setInterval(render, RENDER_TICK_SECONDS * 1000);
  nativeTheme.on("updated", render); // re-tint tray text on light/dark switch
});

app.on("window-all-closed", () => { /* menu bar app has no windows to keep it alive */ });
