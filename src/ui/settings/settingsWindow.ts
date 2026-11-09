import { BrowserWindow } from "electron";
import { join } from "node:path";

const WIDTH = 350;
const HEIGHT = 420;

export function createSettingsWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    roundedCorners: true,
    backgroundColor: "#00000000",
    vibrancy: "menu",
    visualEffectState: "active",
    webPreferences: {
      preload: join(__dirname, "settingsPreload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  void win.loadFile(join(__dirname, "settings.html"));
  win.once("ready-to-show", () => {
    if (!win.isDestroyed()) {
      win.center();
      win.show();
      win.focus();
    }
  });
  return win;
}

export function resizeSettings(win: BrowserWindow, contentHeight: number): void {
  if (win.isDestroyed()) { return; }
  const h = Math.max(200, Math.round(contentHeight));
  const [, current] = win.getContentSize();
  if (h !== current) { win.setContentSize(WIDTH, h); }
}
