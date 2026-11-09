import { contextBridge, ipcRenderer } from "electron";
import type { ProviderId } from "../../quota/model";
import type { Preferences, ResetMode, TrayIconColor } from "../../preferences";

contextBridge.exposeInMainWorld("settings", {
  onUpdate: (cb: (preferences: Preferences) => void): void => {
    ipcRenderer.on("preferences:update", (_event, prefs: Preferences) => cb(prefs));
  },
  setSources: (sources: ProviderId[]): void => {
    ipcRenderer.send("preferences:setSources", sources);
  },
  setMenuBarSource: (source: ProviderId): void => {
    ipcRenderer.send("preferences:setMenuBarSource", source);
  },
  setResetMode: (mode: ResetMode): void => {
    ipcRenderer.send("preferences:setResetMode", mode);
  },
  setShowPaceLine: (value: boolean): void => {
    ipcRenderer.send("preferences:setShowPaceLine", value);
  },
  setTrayIconColor: (value: TrayIconColor): void => {
    ipcRenderer.send("preferences:setTrayIconColor", value);
  },
  setOpenAtLogin: (value: boolean): void => {
    ipcRenderer.send("preferences:setOpenAtLogin", value);
  },
  close: (): void => {
    ipcRenderer.send("settings:close");
  },
  resize: (height: number): void => {
    ipcRenderer.send("settings:resize", height);
  },
});
