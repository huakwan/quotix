import { BrowserWindow, screen } from "electron";
import { join } from "node:path";

const WIDTH = 272;
const HEIGHT = 140; // initial guess; resizePopover() fits to content after first render

let lastHiddenAt = 0;

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
    vibrancy: "menu",
    visualEffectState: "active",
    roundedCorners: true,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(join(__dirname, "popover.html"));
  win.on("blur", () => { if (!win.isDestroyed()) { lastHiddenAt = Date.now(); win.hide(); } });
  return win;
}

// Fit the window height to the rendered content while keeping the fixed width.
// The renderer reports its panel height via the "popover:resize" IPC channel.
export function resizePopover(win: BrowserWindow, contentHeight: number): void {
  if (win.isDestroyed()) { return; }
  const h = Math.max(1, Math.round(contentHeight));
  const [, current] = win.getContentSize();
  if (h !== current) { win.setContentSize(WIDTH, h); }
}

// Returns true if this call made the popover visible (so the caller can refresh
// quota on open), false if it hid it or ignored the click.
export function togglePopover(win: BrowserWindow, trayBounds: Electron.Rectangle): boolean {
  if (!win.isVisible() && Date.now() - lastHiddenAt < 250) { return false; }
  if (win.isVisible()) { lastHiddenAt = Date.now(); win.hide(); return false; }
  const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
  let x = Math.round(trayBounds.x + trayBounds.width / 2 - WIDTH / 2);
  const y = Math.round(trayBounds.y + trayBounds.height + 2);
  const maxX = display.workArea.x + display.workArea.width - WIDTH - 4;
  x = Math.max(display.workArea.x + 4, Math.min(x, maxX));
  win.setPosition(x, y, false);
  win.show();
  win.focus();
  return true;
}
