import path from "node:path";
import { stat } from "node:fs/promises";
import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from "electron";
import { Effect, Schema } from "effect";
import { CommandSchema } from "../src/model";
import { DesktopLibrary } from "./library";
import { LibraryStore, message } from "./storage";

app.setName("Aperto");
app.setPath("userData", process.env.APERTO_DATA_DIR || path.join(app.getPath("appData"), "Aperto"));
let library: DesktopLibrary;
let startupError: string | null = null;
let quitting = false;
let lastScan = 0;

const changed = () => {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send("aperto:changed");
};

const createWindow = () => {
  const window = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    title: "Aperto",
    backgroundColor: "#0a0a0a",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(import.meta.dirname, "preload.js"),
    },
  });
  // Pick up games added to the games folder while Aperto was in the background.
  window.on("focus", () => {
    if (Date.now() - lastScan < 30_000) return;
    lastScan = Date.now();
    void library?.scanGamesFolder().catch((error) => console.error("Scan failed:", error));
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  if (process.env.VITE_DEV_SERVER_URL) void window.loadURL(process.env.VITE_DEV_SERVER_URL);
  else void window.loadFile(path.join(import.meta.dirname, "../dist/index.html"));
  return window;
};

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    const window = BrowserWindow.getAllWindows()[0] ?? createWindow();
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  void app.whenReady().then(async () => {
    const store = new LibraryStore(app.getPath("userData"), changed);
    library = new DesktopLibrary(
      store,
      {
        async chooseFolder() {
          const result = await dialog.showOpenDialog({
            title: "Choose a folder with games",
            properties: ["openDirectory", "treatPackageAsDirectory"],
          });
          return result.canceled ? null : (result.filePaths[0] ?? null);
        },
        async chooseArtwork() {
          const result = await dialog.showOpenDialog({
            title: "Choose game artwork",
            properties: ["openFile"],
            filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
          });
          return result.canceled ? null : (result.filePaths[0] ?? null);
        },
        async image(file) {
          try {
            if (!/\.(png|jpe?g|webp)$/i.test(file) || (await stat(file)).size > 12 * 1024 * 1024)
              return null;
            const image = nativeImage.createFromPath(file);
            if (image.isEmpty()) return null;
            const size = image.getSize();
            const ratio = Math.min(1, 900 / size.width, 900 / size.height);
            return image
              .resize({
                width: Math.max(1, Math.round(size.width * ratio)),
                height: Math.max(1, Math.round(size.height * ratio)),
              })
              .toDataURL();
          } catch {
            return null;
          }
        },
        reveal(file) {
          shell.showItemInFolder(file);
        },
      },
      changed,
    );
    try {
      await store.load();
    } catch (error) {
      startupError = message(error);
    }
    if (!startupError) {
      lastScan = Date.now();
      void library.scanGamesFolder().catch((error) => console.error("Scan failed:", error));
    }
    const request = Effect.fn("desktop.request")((input: unknown) =>
      Schema.decodeUnknownEffect(CommandSchema)(input).pipe(
        Effect.flatMap((command) =>
          Effect.tryPromise({ try: () => library.handle(command), catch: message }),
        ),
        Effect.map((value) => ({ ok: true as const, value })),
        Effect.catch((error) => Effect.succeed({ ok: false as const, message: message(error) })),
      ),
    );
    ipcMain.handle("aperto:request", (event, input: unknown) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window || event.senderFrame !== event.sender.mainFrame)
        return { ok: false, message: "Untrusted request." };
      const expected = process.env.VITE_DEV_SERVER_URL;
      const url = event.senderFrame.url;
      if (expected ? new URL(url).origin !== new URL(expected).origin : !url.startsWith("file://"))
        return { ok: false, message: "Untrusted request." };
      if (startupError) return { ok: false, message: startupError };
      return Effect.runPromise(request(input));
    });
    createWindow();
    app.on("activate", () => {
      if (!BrowserWindow.getAllWindows().length) createWindow();
    });
  });
  app.on("before-quit", (event) => {
    if (quitting || (!library?.running.size && !library?.runtimes.downloads.size)) return;
    event.preventDefault();
    void dialog
      .showMessageBox({
        type: "question",
        message: "Quit Aperto?",
        detail: "Running games will be stopped and runtime downloads will be cancelled.",
        buttons: ["Keep open", "Stop and quit"],
        defaultId: 0,
        cancelId: 0,
      })
      .then(({ response }) => {
        if (response !== 1) return;
        quitting = true;
        for (const session of library.running.values()) {
          session.stopped = true;
          session.process.kill("SIGTERM");
        }
        for (const download of library.runtimes.downloads.values()) download.controller.abort();
        setTimeout(() => app.quit(), 1000);
      });
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
