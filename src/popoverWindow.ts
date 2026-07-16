import { BrowserWindow, screen } from "electron";
import { join } from "node:path";

const WIDTH = 272;
const HEIGHT = 150;

export function createPopover(): BrowserWindow {
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(join(__dirname, "popover.html"));
  win.on("blur", () => { if (!win.isDestroyed()) { win.hide(); } });
  return win;
}

export function togglePopover(win: BrowserWindow, trayBounds: Electron.Rectangle): void {
  if (win.isVisible()) { win.hide(); return; }
  const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
  let x = Math.round(trayBounds.x + trayBounds.width / 2 - WIDTH / 2);
  const y = Math.round(trayBounds.y + trayBounds.height + 2);
  const maxX = display.workArea.x + display.workArea.width - WIDTH - 4;
  x = Math.max(display.workArea.x + 4, Math.min(x, maxX));
  win.setPosition(x, y, false);
  win.show();
  win.focus();
}
