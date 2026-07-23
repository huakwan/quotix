import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  shell,
  Tray,
} from "electron";
import { createQuotaCache } from "./quota/cache";
import { ClaudeQuotaProvider } from "./quota/claude/provider";
import { createCachedTokenProvider } from "./quota/claude/credentials";
import { CodexAppServerClient, spawnCodexAppServer } from "./quota/codex/appServer";
import { resolveCodexExecutable } from "./quota/codex/executable";
import { CodexQuotaProvider } from "./quota/codex/provider";
import { QuotaCoordinator } from "./quota/coordinator";
import type { ProviderId, QuotaSnapshot } from "./quota/model";
import { SourceRuntime } from "./quota/sourceRuntime";
import { syncOpenAtLogin, updateOpenAtLogin } from "./loginItem";
import {
  asDisplaySource,
  asMenuBarSource,
  asOpenAtLogin,
  asResetMode,
  asShowPaceLine,
} from "./preferenceInput";
import {
  effectiveMenuBarSource,
  loadPreferences,
  savePreferences,
  type Preferences,
} from "./preferences";
import { createPopover, resizePopover, togglePopover } from "./ui/popoverWindow";
import { renderTray } from "./ui/trayCapture";
import { trayDisplayState } from "./ui/trayState";
import { UpdateCoordinator } from "./update/coordinator";
import { acknowledgeUpdatedLaunch, installVerifiedUpdate } from "./update/installer";
import { resolveInstalledBundle } from "./update/installPaths";
import type { UpdateArch } from "./update/model";
import { recoverInterruptedUpdates } from "./update/recovery";
import { ReleaseChecker } from "./update/releaseChecker";
import { stageUpdate } from "./update/stager";
import updatePublicKey from "./update/key/quotix-update-public.pem";

const REFRESH_INTERVAL_SECONDS = 2 * 60;
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const UPDATE_STARTUP_DELAY_MS = 30 * 1000;

let tray: Tray | undefined;
let popover: BrowserWindow | undefined;
let coordinator: QuotaCoordinator | undefined;
let preferences: Preferences;
let pollTimer: NodeJS.Timeout | undefined;
let unsubscribeCoordinator: (() => void) | undefined;
let updateCoordinator: UpdateCoordinator | undefined;
let unsubscribeUpdate: (() => void) | undefined;
let updateStartupTimer: NodeJS.Timeout | undefined;
let updateCheckTimer: NodeJS.Timeout | undefined;
let disposed = false;

function currentSnapshot(): QuotaSnapshot | undefined { return coordinator?.snapshot(); }

function refreshOpenAtLoginPreference(): void {
  const synced = syncOpenAtLogin(app, preferences);
  if (synced === preferences) { return; }
  preferences = synced;
  savePreferences(app.getPath("userData"), preferences);
}

function render(): void {
  const snapshot = currentSnapshot();
  if (!tray || !snapshot) { return; }
  refreshOpenAtLoginPreference();
  const provider = effectiveMenuBarSource(preferences);
  tray.setTitle("");
  void updateTray(provider, snapshot);
  if (popover && !popover.isDestroyed()) {
    popover.webContents.send("quota:update", {
      snapshot,
      preferences,
      nowSec: Math.floor(Date.now() / 1000),
      update: updateCoordinator?.view() ?? { status: "idle" },
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

function showPopoverForUpdate(): void {
  if (popover && tray && !popover.isVisible()) {
    togglePopover(popover, tray.getBounds());
  }
  render();
}

function ignoreUpdateAction(action: Promise<void> | undefined): void {
  void action?.catch(() => undefined);
}

function checkForUpdates(manual: boolean): void {
  if (manual) { showPopoverForUpdate(); }
  ignoreUpdateAction(updateCoordinator?.check(manual));
}

function registerIpc(): void {
  ipcMain.on("quota:refresh", () => poll(true));
  ipcMain.on("quota:quit", () => app.quit());
  ipcMain.on("update:check", () => checkForUpdates(true));
  ipcMain.on("update:download", () => ignoreUpdateAction(updateCoordinator?.download()));
  ipcMain.on("update:cancel", () => updateCoordinator?.cancel());
  ipcMain.on("update:install", () => ignoreUpdateAction(updateCoordinator?.install()));
  ipcMain.on("update:reveal", () => ignoreUpdateAction(updateCoordinator?.reveal()));
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
  ipcMain.on("preferences:setOpenAtLogin", (_event, value: unknown) => {
    const requested = asOpenAtLogin(value);
    if (requested === null) { return; }
    const openAtLogin = updateOpenAtLogin(app, requested, preferences.openAtLogin);
    preferences = { ...preferences, openAtLogin };
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
  unsubscribeUpdate?.();
  unsubscribeUpdate = undefined;
  updateCoordinator?.dispose();
  updateCoordinator = undefined;
  if (updateStartupTimer) { clearTimeout(updateStartupTimer); updateStartupTimer = undefined; }
  if (updateCheckTimer) { clearInterval(updateCheckTimer); updateCheckTimer = undefined; }
}

app.whenReady().then(async () => {
  app.dock?.hide();
  const userDataDir = app.getPath("userData");
  preferences = loadPreferences(userDataDir);
  preferences = syncOpenAtLogin(app, preferences);
  savePreferences(userDataDir, preferences);

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
  tray.on("click", () => {
    if (popover && tray && togglePopover(popover, tray.getBounds())) { render(); }
  });
  tray.on("right-click", () => tray?.popUpContextMenu(Menu.buildFromTemplate([
    { label: "Refresh now", click: () => poll(true) },
    { label: "Check for Updates…", click: () => checkForUpdates(true) },
    { type: "separator" },
    { label: "Quit", role: "quit" },
  ])));

  const updateArch: UpdateArch | null = process.arch === "arm64" || process.arch === "x64"
    ? process.arch
    : null;
  const updatesRoot = join(userDataDir, "updates");
  updateCoordinator = new UpdateCoordinator({
    currentVersion: app.getVersion(),
    check: () => {
      if (process.platform !== "darwin" || !updateArch) {
        throw new Error("updates unsupported");
      }
      return new ReleaseChecker({
        fetchImpl: fetch,
        publicKey: updatePublicKey,
        appVersion: app.getVersion(),
        arch: updateArch,
      }).check();
    },
    stage: (release, hooks, signal) => {
      if (!updateArch) { throw new Error("updates unsupported"); }
      return stageUpdate(release, updatesRoot, updateArch, hooks, signal);
    },
    install: (update) => installVerifiedUpdate({
      update,
      execPath: process.execPath,
      helperSource: join(__dirname, "installerHelper.js"),
      originalPid: process.pid,
      confirm: async (mode) => {
        const automatic = mode === "automatic";
        const result = await dialog.showMessageBox({
          type: "warning",
          buttons: ["Cancel", automatic ? "Install and Restart" : "Allow and Show in Finder"],
          defaultId: 0,
          cancelId: 0,
          title: `Install Quotix ${update.version}?`,
          message: automatic
            ? `Update Quotix ${app.getVersion()} to ${update.version} and restart?`
            : `Quotix ${update.version} was verified, but this copy cannot be replaced automatically.`,
          detail: automatic
            ? "Quotix is not Apple-signed. Continuing removes quarantine only from the verified download. The current app is kept as a backup and restored if the updated app cannot start."
            : "Quotix is not Apple-signed. Continuing removes quarantine only from the verified download, then shows it in Finder for manual installation.",
          noLink: true,
        });
        return result.response === 1;
      },
      reveal: (path) => shell.showItemInFolder(path),
      spawnHelper: (executable, args, options) => new Promise((resolve, reject) => {
        const child = spawn(executable, args, options);
        child.once("error", reject);
        child.once("spawn", () => {
          child.removeListener("error", reject);
          resolve(child);
        });
      }),
      quit: () => app.quit(),
    }),
    reveal: async (update) => shell.showItemInFolder(update.appPath),
    cleanup: async (update) => rm(update.stagingRoot, { recursive: true, force: true }),
  });
  unsubscribeUpdate = updateCoordinator.subscribe(render);

  registerIpc();
  render();
  poll();
  pollTimer = setInterval(() => poll(), REFRESH_INTERVAL_SECONDS * 1000);
  updateStartupTimer = setTimeout(() => checkForUpdates(false), UPDATE_STARTUP_DELAY_MS);
  updateCheckTimer = setInterval(() => checkForUpdates(false), UPDATE_CHECK_INTERVAL_MS);
  nativeTheme.on("updated", render);
  try {
    const acknowledged = await acknowledgeUpdatedLaunch(
      process.argv,
      userDataDir,
      app.getVersion(),
    );
    const installed = await resolveInstalledBundle(process.execPath);
    const notices = await recoverInterruptedUpdates({
      updatesRoot,
      currentBundlePath: installed.eligible ? installed.bundlePath : undefined,
      currentVersion: app.getVersion(),
      skipTransactionPath: acknowledged?.transactionPath,
    });
    for (const notice of notices) {
      await dialog.showMessageBox({
        type: notice.status === "rolled-back" ? "info" : "error",
        title: notice.status === "rolled-back"
          ? "Quotix restored the previous version"
          : notice.status === "rollback-failed"
            ? "Quotix could not restore the previous version"
            : "Quotix found an update that needs manual recovery",
        message: notice.status === "rolled-back"
          ? `The update to Quotix ${notice.version} did not finish, so the previous copy was restored.`
          : notice.status === "rollback-failed"
            ? `The update to Quotix ${notice.version} failed and its backup could not be restored automatically.`
            : "Quotix preserved the installed app and update backup because their state was ambiguous.",
        detail: notice.status === "rolled-back"
          ? "You can keep using Quotix and try the update again later."
          : "Open the downloaded update in Finder or reinstall Quotix manually. No existing app was deleted.",
      });
    }
  } catch {
    /* the helper will time out and restore the previous version */
  }
});

app.on("before-quit", dispose);
app.on("window-all-closed", () => { /* menu bar app intentionally stays alive */ });
