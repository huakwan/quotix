import { contextBridge, ipcRenderer } from "electron";
import type { ReadResult } from "../quota/model";

export interface UpdatePayload {
  result: ReadResult;
  primary: "session" | "weekly";
  nowSec: number;
}

contextBridge.exposeInMainWorld("quotix", {
  onUpdate: (cb: (payload: UpdatePayload) => void): void => {
    ipcRenderer.on("quota:update", (_e, payload: UpdatePayload) => cb(payload));
  },
  setPrimary: (p: "session" | "weekly"): void => { ipcRenderer.send("quota:setPrimary", p); },
  refresh: (): void => { ipcRenderer.send("quota:refresh"); },
  quit: (): void => { ipcRenderer.send("quota:quit"); },
});
