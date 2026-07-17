import { app, Tray, Menu, nativeImage, nativeTheme, ipcMain, BrowserWindow } from "electron";
import { createCachedTokenProvider } from "./quota/oauthCredentials";
import { fetchOAuthQuota, MAX_RATE_LIMIT_BACKOFF_SECONDS } from "./quota/oauthSource";
import { renderTray } from "./ui/trayCapture";
import { ReadResult } from "./quota/model";
import { loadQuotaCache, saveQuotaCache } from "./quota/cache";
import { createPopover, togglePopover, resizePopover } from "./ui/popoverWindow";

const REFRESH_INTERVAL_SECONDS = 2 * 60;

type OkResult = Extract<ReadResult, { ok: true }>;

let tray: Tray | undefined;
let popover: BrowserWindow | undefined;
let lastResult: ReadResult = { ok: false, reason: "missing" };
let lastGood: OkResult | null = null;   // survives 429/network errors so the tray keeps showing numbers
let pollTimer: NodeJS.Timeout | undefined;
let consecutive429s = 0;                // drives exponential backoff so repeated 429s don't retry at the same cadence
let tokenChecked = false;               // true once the token has actually been looked up (disambiguates "no token" from "not polled yet")
let loading = false;                    // true only while a fetch is in flight and we have no cached data at all to show meanwhile

const tokenProvider = createCachedTokenProvider();

function render(): void {
  if (!tray) { return; }
  const nowSec = Math.floor(Date.now() / 1000);
  const tokenMissing = tokenChecked && !lastResult.ok && lastResult.reason === "missing";
  // Three tray states: no token -> icon + "Unavailable"; no cached data yet while a fetch
  // is in flight -> icon + "Loading..."; otherwise the normal dual bar with last-good/cached
  // numbers (no dimming — cached numbers render at full opacity).
  const session = lastGood?.quota.session?.usedPct ?? null;
  const weekly = lastGood?.quota.weekly?.usedPct ?? null;
  tray.setTitle("");
  void updateTrayImage(session, weekly, { loading, tokenMissing });
  if (popover && !popover.isDestroyed()) {
    // No token -> always show the explanatory text, never fall back to stale cached bars.
    // Every other failure (401/429/network/other HTTP) -> keep showing cached numbers.
    const popoverResult = tokenMissing ? lastResult : (lastGood ?? lastResult);
    popover.webContents.send("quota:update", { result: popoverResult, nowSec });
  }
}

async function updateTrayImage(
  session: number | null,
  weekly: number | null,
  mode: { loading: boolean; tokenMissing: boolean },
): Promise<void> {
  try {
    const img = await renderTray(session, weekly, nativeTheme.shouldUseDarkColors, mode);
    tray?.setImage(img);
  } catch {
    /* keep last image on capture failure */
  }
}

async function poll(): Promise<void> {
  const token = tokenProvider.get();
  tokenChecked = true;
  if (!token.ok) {
    lastResult = { ok: false, reason: "missing" };
    render();
    schedule(REFRESH_INTERVAL_SECONDS);
    return;
  }

  if (!lastGood) {
    loading = true;
    render();
  }

  const result = await fetchOAuthQuota(token.token, fetch);
  loading = false;
  if (result.tokenInvalid) { tokenProvider.invalidate(); }
  lastResult = result;
  if (result.ok) { lastGood = result; saveQuotaCache(result.quota); }

  if (!result.ok && result.error === "HTTP 429") {
    consecutive429s += 1;
    const backoff = (result.retryAfterSeconds ?? REFRESH_INTERVAL_SECONDS) * 2 ** (consecutive429s - 1);
    render();
    schedule(Math.min(backoff, MAX_RATE_LIMIT_BACKOFF_SECONDS));
    return;
  }
  consecutive429s = 0;
  render();
  schedule(REFRESH_INTERVAL_SECONDS);
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

  // Seed from the on-disk cache so the tray shows real numbers before the first poll completes.
  const cached = loadQuotaCache();
  if (cached) { lastGood = { ok: true, quota: cached }; }

  popover = createPopover();

  tray = new Tray(nativeImage.createEmpty());
  tray.on("click", () => {
    if (popover && tray) {
      // Re-render from cache when the popover opens so "Updated x min ago" and the
      // countdowns reflect a fresh nowSec. The renderer's local 1s tick gets throttled
      // while the window is hidden, so its clock drifts behind real time; pushing a
      // current nowSec here corrects it without a network fetch.
      if (togglePopover(popover, tray.getBounds())) { render(); }
    }
  });
  tray.on("right-click", () => { tray?.popUpContextMenu(contextMenu); });

  ipcMain.on("quota:refresh", () => void poll());
  ipcMain.on("quota:quit", () => app.quit());
  ipcMain.on("popover:resize", (_e, height: number) => {
    if (popover) { resizePopover(popover, height); }
  });

  render();
  void poll();
  nativeTheme.on("updated", render); // re-tint tray text on light/dark switch
});

app.on("window-all-closed", () => { /* menu bar app has no windows to keep it alive */ });
