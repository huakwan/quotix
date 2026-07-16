import { app, Tray, Menu, nativeImage, ipcMain, BrowserWindow } from "electron";
import { createCachedTokenProvider } from "./quota/oauthCredentials";
import { fetchOAuthQuota } from "./quota/oauthSource";
import { trayTitle, trayTooltip } from "./ui/render";
import { ReadResult } from "./quota/model";
import { loadPrimary, savePrimary, Primary } from "./prefs";
import { createPopover, togglePopover } from "./ui/popoverWindow";

const REFRESH_INTERVAL_SECONDS = 60;
const RENDER_TICK_SECONDS = 10;
const BAR_WIDTH = 10;

let tray: Tray | undefined;
let popover: BrowserWindow | undefined;
let lastResult: ReadResult = { ok: false, reason: "missing" };
let pollTimer: NodeJS.Timeout | undefined;
let primary: Primary = "session";

const tokenProvider = createCachedTokenProvider();

function render(): void {
  if (!tray) { return; }
  const nowSec = Math.floor(Date.now() / 1000);
  tray.setTitle(trayTitle(lastResult, primary, BAR_WIDTH, nowSec));
  tray.setToolTip(trayTooltip(lastResult, nowSec));
  if (popover && !popover.isDestroyed()) {
    popover.webContents.send("quota:update", { result: lastResult, primary, nowSec });
  }
}

async function poll(): Promise<void> {
  const token = tokenProvider.get();
  if (!token.ok) {
    lastResult = { ok: false, reason: "missing" };
    render();
    schedule(REFRESH_INTERVAL_SECONDS);
    return;
  }

  const result = await fetchOAuthQuota(token.token, fetch);
  if (result.tokenInvalid) { tokenProvider.invalidate(); }
  lastResult = result;
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
});

app.on("window-all-closed", () => { /* menu bar app has no windows to keep it alive */ });
