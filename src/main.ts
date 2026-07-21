import { app, BrowserWindow, ipcMain, Menu, nativeImage, nativeTheme, Tray } from "electron";
import { createQuotaCache } from "./quota/cache";
import { ClaudeQuotaProvider } from "./quota/claude/provider";
import { createCachedTokenProvider } from "./quota/claude/credentials";
import { CodexAppServerClient, spawnCodexAppServer } from "./quota/codex/appServer";
import { resolveCodexExecutable } from "./quota/codex/executable";
import { CodexQuotaProvider } from "./quota/codex/provider";
import { QuotaCoordinator } from "./quota/coordinator";
import type { ProviderId, QuotaSnapshot } from "./quota/model";
import { SourceRuntime } from "./quota/sourceRuntime";
import { asDisplaySource, asMenuBarSource, asResetMode, asShowPaceLine } from "./preferenceInput";
import {
  effectiveMenuBarSource,
  loadPreferences,
  savePreferences,
  type Preferences,
} from "./preferences";
import { createPopover, resizePopover, togglePopover } from "./ui/popoverWindow";
import { renderTray } from "./ui/trayCapture";
import { trayDisplayState } from "./ui/trayState";

const REFRESH_INTERVAL_SECONDS = 2 * 60;

let tray: Tray | undefined;
let popover: BrowserWindow | undefined;
let coordinator: QuotaCoordinator | undefined;
let preferences: Preferences;
let pollTimer: NodeJS.Timeout | undefined;
let unsubscribeCoordinator: (() => void) | undefined;
let disposed = false;

function currentSnapshot(): QuotaSnapshot | undefined { return coordinator?.snapshot(); }

function render(): void {
  const snapshot = currentSnapshot();
  if (!tray || !snapshot) { return; }
  const provider = effectiveMenuBarSource(preferences);
  tray.setTitle("");
  void updateTray(provider, snapshot);
  if (popover && !popover.isDestroyed()) {
    popover.webContents.send("quota:update", {
      snapshot,
      preferences,
      nowSec: Math.floor(Date.now() / 1000),
    });
  }
}

async function updateTray(provider: ProviderId, snapshot: QuotaSnapshot): Promise<void> {
  try {
    const image = await renderTray(
      trayDisplayState(provider, snapshot[provider]),
      preferences.showPaceLine,
      nativeTheme.shouldUseDarkColors,
    );
    tray?.setImage(image);
  } catch {
    /* retain the last tray image if capture fails */
  }
}

function poll(force = false): void {
  void coordinator?.pollEnabled(force);
}

function persistPreferences(): void {
  savePreferences(app.getPath("userData"), preferences);
  render();
}

function registerIpc(): void {
  ipcMain.on("quota:refresh", () => poll(true));
  ipcMain.on("quota:quit", () => app.quit());
  ipcMain.on("popover:resize", (_event, height: unknown) => {
    if (popover && typeof height === "number" && Number.isFinite(height)) {
      resizePopover(popover, height);
    }
  });
  ipcMain.on("preferences:setSource", (_event, value: unknown) => {
    const source = asDisplaySource(value);
    if (!source) { return; }
    preferences = { ...preferences, source };
    coordinator?.setSource(source);
    persistPreferences();
  });
  ipcMain.on("preferences:setMenuBarSource", (_event, value: unknown) => {
    const source = asMenuBarSource(value);
    if (!source) { return; }
    preferences = { ...preferences, menuBarSource: source };
    persistPreferences();
  });
  ipcMain.on("preferences:setResetMode", (_event, value: unknown) => {
    const resetMode = asResetMode(value);
    if (!resetMode) { return; }
    preferences = { ...preferences, resetMode };
    persistPreferences();
  });
  ipcMain.on("preferences:setShowPaceLine", (_event, value: unknown) => {
    const showPaceLine = asShowPaceLine(value);
    if (showPaceLine === null) { return; }
    preferences = { ...preferences, showPaceLine };
    persistPreferences();
  });
}

function dispose(): void {
  if (disposed) { return; }
  disposed = true;
  if (pollTimer) { clearInterval(pollTimer); pollTimer = undefined; }
  unsubscribeCoordinator?.();
  unsubscribeCoordinator = undefined;
  coordinator?.dispose();
  coordinator = undefined;
}

app.whenReady().then(() => {
  app.dock?.hide();
  const userDataDir = app.getPath("userData");
  preferences = loadPreferences(userDataDir);

  coordinator = new QuotaCoordinator({
    claude: () => new SourceRuntime(
      new ClaudeQuotaProvider({ tokenProvider: createCachedTokenProvider(), fetchImpl: fetch }),
      createQuotaCache(userDataDir, "claude"),
    ),
    codex: () => {
      const executable = resolveCodexExecutable();
      const client = new CodexAppServerClient(
        () => spawnCodexAppServer(executable),
        app.getVersion(),
      );
      return new SourceRuntime(new CodexQuotaProvider(client), createQuotaCache(userDataDir, "codex"));
    },
  }, preferences.source);
  unsubscribeCoordinator = coordinator.subscribe(render);

  popover = createPopover();
  tray = new Tray(nativeImage.createEmpty());
  const contextMenu = Menu.buildFromTemplate([
    { label: "Refresh now", click: () => poll(true) },
    { type: "separator" },
    { label: "Quit", role: "quit" },
  ]);
  tray.on("click", () => {
    if (popover && tray && togglePopover(popover, tray.getBounds())) { render(); }
  });
  tray.on("right-click", () => tray?.popUpContextMenu(contextMenu));

  registerIpc();
  render();
  poll();
  pollTimer = setInterval(() => poll(), REFRESH_INTERVAL_SECONDS * 1000);
  nativeTheme.on("updated", render);
});

app.on("before-quit", dispose);
app.on("window-all-closed", () => { /* menu bar app intentionally stays alive */ });
