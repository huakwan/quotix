import type { Preferences, ResetMode, TrayIconColor } from "../../preferences";
import type { ProviderId } from "../../quota/model";
import { isProviderId, menuBarProvider, normalizeProviderIds } from "../../quota/model";
import { toggledSources } from "../popover/popoverState";
import { keepButtonsUnfocused } from "../buttonFocus";

declare global {
  interface SettingsApi {
    onUpdate(cb: (preferences: Preferences) => void): void;
    setSources(sources: ProviderId[]): void;
    setMenuBarSource(source: ProviderId): void;
    setResetMode(mode: ResetMode): void;
    setShowPaceLine(value: boolean): void;
    setTrayIconColor(value: TrayIconColor): void;
    setOpenAtLogin(value: boolean): void;
    close(): void;
    resize(height: number): void;
  }

  interface Window {
    settings: SettingsApi;
  }
}

let lastPrefs: Preferences | null = null;

function syncButtons(containerId: string, value: string): void {
  const container = document.getElementById(containerId)!;
  for (const button of container.querySelectorAll<HTMLButtonElement>(".seg-btn")) {
    button.classList.toggle("active", button.dataset.value === value);
  }
}

function syncSourceTable(sources: readonly ProviderId[], menuBarSource: ProviderId): void {
  const effectiveMenu = menuBarProvider(sources, menuBarSource);
  for (const row of document.querySelectorAll<HTMLTableRowElement>("#sources-table-body tr")) {
    const provider = row.dataset.provider as ProviderId;
    const check = row.querySelector<HTMLInputElement>(".source-popover-check");
    const radio = row.querySelector<HTMLInputElement>(".source-menubar-radio");
    if (check) {
      check.checked = sources.includes(provider);
    }
    if (radio) {
      radio.checked = provider === effectiveMenu;
    }
  }
}

function draw(): void {
  if (!lastPrefs) { return; }
  syncSourceTable(lastPrefs.sources, lastPrefs.menuBarSource);
  syncButtons("reset-mode", lastPrefs.resetMode);
  syncButtons("pace-mode", lastPrefs.showPaceLine ? "on" : "off");
  syncButtons("tray-icon-color", lastPrefs.trayIconColor);
  syncButtons("login-mode", lastPrefs.openAtLogin ? "on" : "off");
}

function onSegment(id: string, callback: (value: string) => void): void {
  document.getElementById(id)!.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".seg-btn");
    if (button?.dataset.value) { callback(button.dataset.value); }
  });
}

window.settings.onUpdate((preferences) => {
  lastPrefs = preferences;
  draw();
});

keepButtonsUnfocused();

// Keep table checkboxes and radios out of the tab order and unfocused
for (const input of document.querySelectorAll<HTMLInputElement>(".sources-table input")) {
  input.tabIndex = -1;
  input.addEventListener("mouseup", () => input.blur());
  input.addEventListener("click", () => input.blur());
}

document.getElementById("sources-table-body")!.addEventListener("change", (event) => {
  if (!lastPrefs) { return; }
  const target = event.target as HTMLInputElement;
  const provider = target.dataset.value as ProviderId;
  if (!isProviderId(provider)) { return; }

  if (target.classList.contains("source-popover-check")) {
    const newSources = toggledSources(lastPrefs.sources, provider);
    if (!newSources) {
      // Revert checkbox state if toggling was refused (must keep at least 1)
      target.checked = true;
      return;
    }
    const newMenuBar = menuBarProvider(newSources, lastPrefs.menuBarSource);
    const menuChanged = newMenuBar !== lastPrefs.menuBarSource;
    lastPrefs = { ...lastPrefs, sources: newSources, menuBarSource: newMenuBar };
    draw();
    window.settings.setSources(newSources);
    if (menuChanged) {
      window.settings.setMenuBarSource(newMenuBar);
    }
  } else if (target.classList.contains("source-menubar-radio")) {
    const needAdd = !lastPrefs.sources.includes(provider);
    const newSources = needAdd
      ? normalizeProviderIds([...lastPrefs.sources, provider])!
      : lastPrefs.sources;
    lastPrefs = { ...lastPrefs, sources: newSources, menuBarSource: provider };
    draw();
    window.settings.setMenuBarSource(provider);
    if (needAdd) {
      window.settings.setSources(newSources);
    }
  }
});

onSegment("reset-mode", (value) => window.settings.setResetMode(value as ResetMode));
onSegment("pace-mode", (value) => window.settings.setShowPaceLine(value === "on"));
onSegment("tray-icon-color", (value) => window.settings.setTrayIconColor(value as TrayIconColor));
onSegment("login-mode", (value) => window.settings.setOpenAtLogin(value === "on"));

document.getElementById("close")!.addEventListener("click", () => window.settings.close());
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") { window.settings.close(); }
});

const windowEl = document.querySelector(".window")!;
let lastHeight = 0;
new ResizeObserver(() => {
  const height = Math.ceil(windowEl.getBoundingClientRect().height);
  if (height > 0 && height !== lastHeight) {
    lastHeight = height;
    window.settings.resize(height);
  }
}).observe(windowEl);
