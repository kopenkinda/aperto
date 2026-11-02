import path from "node:path";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeImage,
  net,
  protocol,
  safeStorage,
  session,
  shell,
} from "electron";
import { Effect, Schema } from "effect";
import { CommandSchema } from "../src/model";
import { DesktopLibrary } from "./library";
import { exists, imageScheme, LibraryStore, message } from "./storage";
import { applicationGames, macSteamGames } from "./mac";
import { linkScheme, parseLink } from "./shortcuts";
import { bottleSteamGames, crossoverWine } from "./windows";

app.setName("Aperto");
app.setPath("userData", process.env.APERTO_DATA_DIR || path.join(app.getPath("appData"), "Aperto"));
protocol.registerSchemesAsPrivileged([
  { scheme: imageScheme, privileges: { standard: true, secure: true } },
]);
let library: DesktopLibrary;
let startupError: string | null = null;
let quitting = false;
let lastScan = 0;

let playing = false;

const changed = () => {
  // Aperto steps aside while a game runs, and comes back when the last one closes.
  const running = (library?.running.size ?? 0) > 0;
  if (running !== playing) {
    playing = running;
    for (const window of BrowserWindow.getAllWindows()) {
      if (running) window.minimize();
      else if (window.isMinimized()) window.restore();
    }
    if (!running) app.focus({ steal: true });
  }
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
    library?.checkUpdatesIfStale();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  if (process.env.VITE_DEV_SERVER_URL) void window.loadURL(process.env.VITE_DEV_SERVER_URL);
  else void window.loadFile(path.join(import.meta.dirname, "../dist/index.html"));
  return window;
};

if (!app.requestSingleInstanceLock()) app.quit();
else {
  // aperto:// links, from shortcuts, Spotlight, or other apps. Ones that arrive before the
  // library has loaded wait for it.
  app.setAsDefaultProtocolClient(linkScheme);
  const pendingLinks: string[] = [];
  let ready = false;
  const openLink = (url: string) => {
    const link = parseLink(url);
    if (!link) return;
    if (!ready) return void pendingLinks.push(url);
    if (startupError) return;
    void library.handle({ action: "launch", id: link.id }).catch((error: unknown) => {
      const game = library.store.value.games.find((item) => item.id === link.id);
      void dialog.showMessageBox({
        type: "warning",
        message: game ? `${game.name} could not start.` : "That game is no longer in Aperto.",
        ...(game ? { detail: message(error) } : {}),
      });
    });
  };
  app.on("open-url", (event, url) => {
    event.preventDefault();
    openLink(url);
  });
  app.on("second-instance", () => {
    const window = BrowserWindow.getAllWindows()[0] ?? createWindow();
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  void app.whenReady().then(async () => {
    const store = new LibraryStore(app.getPath("userData"), changed);
    protocol.handle(imageScheme, (request) => {
      const file = store.imageFile(request.url);
      return file ? net.fetch(pathToFileURL(file).href) : new Response(null, { status: 404 });
    });
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
            filters: [
              {
                name: "Images",
                extensions: ["png", "jpg", "jpeg", "webp", "avif", "heic", "gif", "tiff", "bmp"],
              },
            ],
          });
          return result.canceled ? null : (result.filePaths[0] ?? null);
        },
        async image(file, maxSize = 900) {
          try {
            if (!/\.(png|jpe?g|webp)$/i.test(file) || (await stat(file)).size > 24 * 1024 * 1024)
              return null;
            const image = nativeImage.createFromPath(file);
            if (image.isEmpty()) return null;
            const size = image.getSize();
            const ratio = Math.min(1, maxSize / size.width, maxSize / size.height);
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
        trash: (file) => shell.trashItem(file),
        openExternal: (url) => void shell.openExternal(url),
        signInWindow: (url, redirect, partition) =>
          new Promise((resolve) => {
            const parent = BrowserWindow.getAllWindows()[0];
            const window = new BrowserWindow({
              width: 480,
              height: 720,
              ...(parent ? { parent, modal: true } : {}),
              title: "Sign in",
              autoHideMenuBar: true,
              // Without a partition to keep, a session in memory only, so the store's cookies go
              // when the window closes.
              webPreferences: { partition: partition ?? "sign-in", sandbox: true },
            });
            let done = false;
            const check = (event: { preventDefault: () => void }, address: string) => {
              if (done || !address.startsWith(redirect)) return;
              done = true;
              event.preventDefault();
              resolve(address);
              window.close();
            };
            // Links that open new windows, such as help pages, go to the browser.
            window.webContents.setWindowOpenHandler(({ url: link }) => {
              if (link.startsWith("https:")) void shell.openExternal(link);
              return { action: "deny" };
            });
            window.webContents.on("will-redirect", check);
            window.webContents.on("will-navigate", check);
            window.on("closed", () => !done && resolve(null));
            void window.loadURL(url);
          }),
        async sessionFetch(partition, url) {
          const response = await session
            .fromPartition(partition)
            .fetch(url, { signal: AbortSignal.timeout(30_000) })
            .catch(() => null);
          return response?.ok ? response.text() : null;
        },
        sessionCookie: async (partition, url, name) =>
          (await session.fromPartition(partition).cookies.get({ url, name }))[0]?.value ?? null,
        clearSession: (partition) => session.fromPartition(partition).clearStorageData(),
        async secret(name, value) {
          const file = path.join(app.getPath("userData"), "secrets", `${name}.bin`);
          if (value === null) {
            await rm(file, { force: true });
            return null;
          }
          if (value !== undefined) {
            if (!safeStorage.isEncryptionAvailable())
              throw new Error("The Keychain is not available to keep the key safe.");
            await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
            await writeFile(file, safeStorage.encryptString(value), { mode: 0o600 });
            return value;
          }
          const data = await readFile(file).catch(() => null);
          return data ? safeStorage.decryptString(data) : null;
        },
        installedGames: async () =>
          (
            await Promise.all([
              applicationGames(),
              macSteamGames(),
              exists(crossoverWine).then((crossover) => (crossover ? bottleSteamGames() : [])),
            ])
          ).flat(),
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
      // Cleaning up first means a game deleted while Aperto was closed and downloaded again is
      // added as new by the scan.
      void library
        .cleanUp()
        .catch((error) => console.error("Cleanup failed:", error))
        .then(() => library.scanGamesFolder())
        .catch((error) => console.error("Scan failed:", error));
      library.checkUpdatesIfStale();
    }
    ready = true;
    for (const url of pendingLinks.splice(0)) openLink(url);
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
          session.stop();
        }
        for (const download of library.runtimes.downloads.values()) download.controller.abort();
        setTimeout(() => app.quit(), 1000);
      });
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
