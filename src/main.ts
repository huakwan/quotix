import { app, Tray, Menu, nativeImage } from "electron";
import { createCachedTokenProvider } from "./oauthCredentials";
import { fetchOAuthQuota } from "./oauthSource";
import { trayTitle, trayTooltip } from "./render";
import { ReadResult } from "./model";

const REFRESH_INTERVAL_SECONDS = 60;
const RENDER_TICK_SECONDS = 10;
const BAR_WIDTH = 10;

let tray: Tray | undefined;
let lastResult: ReadResult = { ok: false, reason: "missing" };
let pollTimer: NodeJS.Timeout | undefined;

const tokenProvider = createCachedTokenProvider();

function render(): void {
  if (!tray) { return; }
  const nowSec = Math.floor(Date.now() / 1000);
  tray.setTitle(trayTitle(lastResult, BAR_WIDTH, nowSec));
  tray.setToolTip(trayTooltip(lastResult, nowSec));
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

app.whenReady().then(() => {
  app.dock?.hide();

  tray = new Tray(nativeImage.createEmpty());
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Refresh now", click: () => void poll() },
    { type: "separator" },
    { label: "Quit", role: "quit" },
  ]));

  render();
  void poll();
  setInterval(render, RENDER_TICK_SECONDS * 1000);
});

app.on("window-all-closed", () => { /* menu bar app has no windows to keep it alive */ });
