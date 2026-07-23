import { BrowserWindow } from "electron";
import { join } from "node:path";

const WIDTH = 420;
const HEIGHT = 520;

export function createAboutWindow(): BrowserWindow {
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
    webPreferences: {
      preload: join(__dirname, "aboutPreload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  void win.loadFile(join(__dirname, "about.html"));
  win.once("ready-to-show", () => {
    if (!win.isDestroyed()) {
      win.center();
      win.show();
      win.focus();
    }
  });
  return win;
}
