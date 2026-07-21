import { trayWindowPresentation, type TrayDisplayState } from "./trayState";
import anthropicIcon from "../../assets/anthropic.svg";
import openaiIcon from "../../assets/openai.svg";
import pageTemplate from "./trayCapture.html";
import { BrowserWindow, NativeImage, nativeImage } from "electron";

// Renders the tray's available inline quota rows with the real system font in an
// isolated canvas hosted by a hidden BrowserWindow. Tray only shows one image, so
// the canvas exports the icon, text, and bars together as deterministic PNGs.

const H = 22; // logical height ~= macOS menu-bar height, so the OS centers it cleanly

// The markup/styles live in ./trayCapture.html with build-time placeholders that
// carry values the layout depends on (row height, icon assets, window durations).
const PAGE = pageTemplate
  .replaceAll("__H__", String(H))
  .replaceAll("__ICON_CLAUDE__", anthropicIcon)
  .replaceAll("__ICON_CODEX__", openaiIcon)
  .replaceAll("__SESSION_DUR__", String(5 * 3600))
  .replaceAll("__WEEKLY_DUR__", String(7 * 24 * 3600));

let win: BrowserWindow | undefined;
let ready: Promise<void> | undefined;
let renderQueue = Promise.resolve();

function ensure(): Promise<void> {
  if (ready) { return ready; }
  win = new BrowserWindow({
    width: 320, height: H, show: false, frame: false, transparent: true,
    resizable: true, focusable: false, skipTaskbar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  ready = new Promise<void>((resolve) => {
    win!.webContents.once("did-finish-load", () => resolve());
  });
  void win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(PAGE));
  return ready;
}

const j = (v: number | null): string => (v === null ? "null" : String(v));

async function drawTray(
  display: TrayDisplayState,
  showPaceLine: boolean,
  dark: boolean,
): Promise<NativeImage> {
  await ensure();
  const wc = win!.webContents;
  const presentation = trayWindowPresentation(display);
  const nowSec = Math.floor(Date.now() / 1000);
  const rendered: { width: number; oneX: string; twoX: string } = await wc.executeJavaScript(
    `window.__renderCanvas(${JSON.stringify(display.provider)}, ${j(display.session)}, ${j(display.weekly)}, ${j(display.sessionResetsAt)}, ${j(display.weeklyResetsAt)}, ${nowSec}, ${showPaceLine}, ${presentation.session}, ${presentation.weekly}, ${presentation.compactWeekly}, ${dark}, ${display.loading}, ${display.unavailable})`,
  );
  const image = nativeImage.createEmpty();
  if (process.platform === "darwin" && process.getSystemVersion().startsWith("12.")) {
    return nativeImage.createFromDataURL(rendered.oneX);
  }
  image.addRepresentation({ scaleFactor: 1, dataURL: rendered.oneX });
  image.addRepresentation({ scaleFactor: 2, dataURL: rendered.twoX });
  return image;
}

export function renderTray(
  display: TrayDisplayState,
  showPaceLine: boolean,
  dark: boolean,
): Promise<NativeImage> {
  // A single hidden BrowserWindow backs every canvas render. Startup can publish
  // several provider states at once, so serialize access to its page context.
  const drawing = renderQueue.then(() => drawTray(display, showPaceLine, dark));
  renderQueue = drawing.then(() => undefined, () => undefined);
  return drawing;
}
