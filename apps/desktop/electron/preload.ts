import { contextBridge } from "electron";

const desktopApi = Object.freeze({
  versions: () => ({
    chrome: process.versions.chrome,
    electron: process.versions.electron,
    node: process.versions.node,
  }),
});

contextBridge.exposeInMainWorld("desktop", desktopApi);
