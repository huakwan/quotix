import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("about", {
  close: (): void => { ipcRenderer.send("about:close"); },
});
