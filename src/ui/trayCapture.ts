import { trayWindowPresentation, type TrayDisplayState } from "./trayState";
import anthropicIcon from "../../assets/anthropic.svg";
import openaiIcon from "../../assets/openai.svg";
import pageTemplate from "./trayCapture.html";
import { BrowserWindow, NativeImage, nativeImage, screen } from "electron";

// Renders the tray's available inline quota rows with the real system font by
// laying them out in a hidden BrowserWindow and capturing them to a NativeImage.
// The tray runs in the main process with no DOM, and Tray only shows one image, so
// text + bars must live in a single raster — captured here at the OS display scale.

const H = 22; // logical height ~= macOS menu-bar height, so the OS centers it cleanly

// The markup/styles live in ./trayCapture.html with build-time placeholders that
// carry values the layout depends on (row height, icon assets, window durations).
const PAGE = pageTemplate
  .replaceAll("__H__", String(H))
  .replaceAll("__ICON_CLAUDE__", anthropicIcon)
  .replaceAll("__ICON_CODEX__", openaiIcon)
  .replace("__SESSION_DUR__", String(5 * 3600))
  .replace("__WEEKLY_DUR__", String(7 * 24 * 3600));

let win: BrowserWindow | undefined;
let ready: Promise<void> | undefined;

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

export async function renderTray(
  display: TrayDisplayState,
  showPaceLine: boolean,
): Promise<NativeImage> {
  await ensure();
  const wc = win!.webContents;
  const presentation = trayWindowPresentation(display);
  const nowSec = Math.floor(Date.now() / 1000);
  const width: number = await wc.executeJavaScript(
    `window.__render(${JSON.stringify(display.provider)}, ${j(display.session)}, ${j(display.weekly)}, ${j(display.sessionResetsAt)}, ${j(display.weeklyResetsAt)}, ${nowSec}, ${showPaceLine}, ${presentation.session}, ${presentation.weekly}, ${presentation.compactWeekly}, ${display.loading}, ${display.unavailable})`,
  );
  const w = Math.max(1, Math.min(320, width));
  win!.setContentSize(w, H);
  // Let the resize + fill-width transition settle before grabbing the pixels.
  await wc.executeJavaScript("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))");
  const shot = await wc.capturePage({ x: 0, y: 0, width: w, height: H });
  // capturePage returns pixels at the display scale; re-tag with that scaleFactor
  // so the tray shows it at logical (point) size instead of doubled on retina.
  const scale = screen.getPrimaryDisplay().scaleFactor || 1;
  return nativeImage.createFromBuffer(shot.toPNG(), { scaleFactor: scale });
}
