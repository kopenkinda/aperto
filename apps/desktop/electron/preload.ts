import { contextBridge, ipcRenderer } from "electron";
import type { Command, DesktopApi, ResultFor } from "../src/model";

const desktop: DesktopApi = {
  async request<C extends Command>(command: C): Promise<ResultFor<C>> {
    const result = (await ipcRenderer.invoke("aperto:request", command)) as
      | { ok: true; value: ResultFor<C> }
      | { ok: false; message: string };
    if (!result.ok) throw new Error(result.message);
    return result.value;
  },
  onChange(listener) {
    const receive = () => listener();
    ipcRenderer.on("aperto:changed", receive);
    return () => ipcRenderer.removeListener("aperto:changed", receive);
  },
};
contextBridge.exposeInMainWorld("desktop", Object.freeze(desktop));
