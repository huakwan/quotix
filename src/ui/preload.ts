import { contextBridge, ipcRenderer } from "electron";
import type { ReadResult } from "../quota/model";

export interface UpdatePayload {
  result: ReadResult;
  nowSec: number;
}

contextBridge.exposeInMainWorld("quotix", {
  onUpdate: (cb: (payload: UpdatePayload) => void): void => {
    ipcRenderer.on("quota:update", (_e, payload: UpdatePayload) => cb(payload));
  },
  refresh: (): void => { ipcRenderer.send("quota:refresh"); },
  quit: (): void => { ipcRenderer.send("quota:quit"); },
  resize: (height: number): void => { ipcRenderer.send("popover:resize", height); },
});
