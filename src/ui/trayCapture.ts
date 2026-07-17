import { trayWindowPresentation, type TrayDisplayState } from "./trayState";
import anthropicIcon from "../../assets/anthropic.svg";
import openaiIcon from "../../assets/openai.svg";
import { BrowserWindow, NativeImage, nativeImage, screen } from "electron";

// Renders the tray's available inline quota rows with the real system font by
// laying them out in a hidden BrowserWindow and capturing them to a NativeImage.
// The tray runs in the main process with no DOM, and Tray only shows one image, so
// text + bars must live in a single raster — captured here at the OS display scale.

const H = 22; // logical height ~= macOS menu-bar height, so the OS centers it cleanly

const PAGE = `
<!doctype html><html><head><meta charset="utf-8" />
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  #row {
    display: inline-flex; align-items: center; gap: 9px;
    height: ${H}px; line-height: ${H}px; padding: 0 3px; white-space: nowrap;
    font: 13px -apple-system, system-ui, sans-serif; font-weight: 500;
  }
  #row > * { display: inline-flex; align-items: center; }
  .grp { gap: 5px; }
  .logo { width: 15px; height: 15px; display: block; }
  .label { opacity: 0.85; }
  .pct { font-variant-numeric: tabular-nums; }
  .track {
    display: inline-flex; width: 80px; height: 6px; border-radius: 3px;
    background: rgba(140, 140, 145, 0.35); overflow: hidden;
  }
  .grp.compact-weekly .track { width: 120px; }
  .fill { height: 100%; border-radius: 3px; width: 0%; }
  .green { background: #35c759; } .amber { background: #ffcc00; } .red { background: #ff453a; }
  #unavailable, #loading { display: none; }
</style></head><body>
<div id="row">
  <img id="logo" class="logo" src="data:image/svg+xml;base64,${anthropicIcon}" alt="" />
  <span id="grp5" class="grp"><span class="label">5H</span><span class="track"><span id="fs" class="fill"></span></span><span id="ps" class="pct"></span></span>
  <span id="grp7" class="grp"><span class="label">7D</span><span class="track"><span id="fw" class="fill"></span></span><span id="pw" class="pct"></span></span>
  <span id="unavailable">Unavailable</span>
  <span id="loading">Loading...</span>
</div>
<script>
  function cls(p){ return p > 90 ? 'red' : p >= 75 ? 'amber' : 'green'; }
  function seg(fillId, pctId, v){
    var f = document.getElementById(fillId), p = document.getElementById(pctId);
    var c = Math.max(0, Math.min(100, v === null ? 0 : v));
    f.style.width = c + '%'; f.className = 'fill ' + cls(c); p.textContent = Math.round(c) + '%'; p.className = 'pct';
  }
  var logos = { claude: 'data:image/svg+xml;base64,${anthropicIcon}', codex: 'data:image/svg+xml;base64,${openaiIcon}' };
  window.__render = function(provider, s, w, showSession, showWeekly, compactWeekly, dark, loading, unavailable){
    document.documentElement.style.color = dark ? '#f2f2f2' : '#1c1c1e';
    var logo = document.getElementById('logo');
    logo.src = logos[provider];
    logo.style.filter = provider === 'codex' && dark ? 'invert(1)' : 'none';
    var row = document.getElementById('row');
    var grp5 = document.getElementById('grp5'), grp7 = document.getElementById('grp7');
    var una = document.getElementById('unavailable'), ld = document.getElementById('loading');
    grp7.classList.toggle('compact-weekly', compactWeekly);
    grp5.style.display = 'none'; grp7.style.display = 'none'; una.style.display = 'none'; ld.style.display = 'none';
    if (unavailable) {
      una.style.display = 'inline-flex';
    } else if (loading) {
      ld.style.display = 'inline-flex';
    } else {
      if (showSession) { grp5.style.display = 'inline-flex'; seg('fs', 'ps', s); }
      if (showWeekly) { grp7.style.display = 'inline-flex'; seg('fw', 'pw', w); }
    }
    return Math.ceil(row.getBoundingClientRect().width);
  };
</script>
</body></html>`;

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
  dark: boolean,
): Promise<NativeImage> {
  await ensure();
  const wc = win!.webContents;
  const presentation = trayWindowPresentation(display);
  const width: number = await wc.executeJavaScript(
    `window.__render(${JSON.stringify(display.provider)}, ${j(display.session)}, ${j(display.weekly)}, ${presentation.session}, ${presentation.weekly}, ${presentation.compactWeekly}, ${dark}, ${display.loading}, ${display.unavailable})`,
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
