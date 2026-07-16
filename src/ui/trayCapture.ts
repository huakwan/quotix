import { BrowserWindow, NativeImage, nativeImage, screen } from "electron";
import anthropicIcon from "../../assets/anthropic.svg";

// Renders the tray's inline row (5H [bar] % | 7D [bar] %) with the real system
// font by laying it out in a hidden BrowserWindow and capturing it to a NativeImage.
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
  .label { opacity: 0.7; }
  .pct { font-variant-numeric: tabular-nums; }
  .track {
    width: 30px; height: 6px; border-radius: 3px;
    background: rgba(140, 140, 145, 0.35); overflow: hidden;
  }
  .fill { height: 100%; border-radius: 3px; width: 0%; }
  .green { background: #35c759; } .amber { background: #ffcc00; } .red { background: #ff453a; }
</style></head><body>
<div id="row">
  <img class="logo" src="data:image/svg+xml;base64,${anthropicIcon}" alt="" />
  <span class="grp"><span class="label">5H</span><span class="track"><span id="fs" class="fill"></span></span><span id="ps" class="pct"></span></span>
  <span class="grp"><span class="label">7D</span><span class="track"><span id="fw" class="fill"></span></span><span id="pw" class="pct"></span></span>
</div>
<script>
  function cls(p){ return p > 90 ? 'red' : p >= 70 ? 'amber' : 'green'; }
  function seg(fillId, pctId, v){
    var f = document.getElementById(fillId), p = document.getElementById(pctId);
    if (v === null){ f.style.width = '0%'; f.className = 'fill'; p.textContent = 'N/A'; }
    else {
      var c = Math.max(0, Math.min(100, v));
      f.style.width = c + '%'; f.className = 'fill ' + cls(c); p.textContent = Math.round(c) + '%';
    }
  }
  window.__render = function(s, w, dark, stale){
    document.documentElement.style.color = dark ? '#f2f2f2' : '#1c1c1e';
    var row = document.getElementById('row');
    row.style.opacity = stale ? '0.45' : '1';
    seg('fs', 'ps', s); seg('fw', 'pw', w);
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
  session: number | null,
  weekly: number | null,
  dark: boolean,
  stale = false,
): Promise<NativeImage> {
  await ensure();
  const wc = win!.webContents;
  const width: number = await wc.executeJavaScript(`window.__render(${j(session)}, ${j(weekly)}, ${dark}, ${stale})`);
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
