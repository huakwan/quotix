import { contextBridge, ipcRenderer } from "electron";
import type { DisplaySource, ProviderId } from "../quota/model";
import type { ResetMode } from "../preferences";
import type { PopoverPayload } from "./popoverState";

export type UpdatePayload = PopoverPayload;

contextBridge.exposeInMainWorld("quotix", {
  onUpdate: (cb: (payload: PopoverPayload) => void): void => {
    ipcRenderer.on("quota:update", (_event, payload: PopoverPayload) => cb(payload));
  },
  setSource: (source: DisplaySource): void => { ipcRenderer.send("preferences:setSource", source); },
  setMenuBarSource: (source: ProviderId): void => { ipcRenderer.send("preferences:setMenuBarSource", source); },
  setResetMode: (mode: ResetMode): void => { ipcRenderer.send("preferences:setResetMode", mode); },
  setShowPaceLine: (value: boolean): void => { ipcRenderer.send("preferences:setShowPaceLine", value); },
  refresh: (): void => { ipcRenderer.send("quota:refresh"); },
  quit: (): void => { ipcRenderer.send("quota:quit"); },
  resize: (height: number): void => { ipcRenderer.send("popover:resize", height); },
});
