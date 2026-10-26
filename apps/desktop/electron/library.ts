import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { cp, mkdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import {
  compareVersions,
  gameKind,
  normalizeTags,
  playCount,
  parseArguments,
  parseFlags,
  type Command,
  type Game,
  type ScanReport,
  type Snapshot,
} from "../src/model";
import { downloadImage, readableImage } from "./artwork";
import { extractExeIcon } from "./exe-icon";
import { inspectRoot, readObject } from "./detection";
import { detectGame, findGames, fingerprint, versionedName, within } from "./discovery";
import { iconToPng } from "./mac";
import { installedTerminals, openInTerminal, terminalFor } from "./terminals";
import { bottlesDirectory, crossoverWine, listBottles } from "./windows";
import { changePlugins, listPlugins } from "./plugins";
import { RuntimeManager, getReleases, runtimeExecutable, validVersion } from "./runtimes";
import { atomicWrite, exists, LibraryStore, message, ownedPath } from "./storage";

export type NativeActions = {
  chooseFolder: () => Promise<string | null>;
  chooseArtwork: () => Promise<string | null>;
  /** Reads an image as a data URL, scaled down to fit `maxSize` pixels on its longer side. */
  image: (file: string, maxSize?: number) => Promise<string | null>;
  reveal: (file: string) => void;
};

export class DesktopLibrary {
  readonly runtimes: RuntimeManager;
  readonly running = new Map<string, { process: ChildProcess; stopped: boolean }>();
  private readonly busy = new Set<string>();
  private scanning: Promise<ScanReport> | null = null;
  private lastScan: ScanReport | null = null;
  private readonly iconAttempts = new Set<string>();

  constructor(
    readonly store: LibraryStore,
    private readonly native: NativeActions,
    private readonly changed: () => void,
  ) {
    this.runtimes = new RuntimeManager(store, changed);
  }

  async snapshot(): Promise<Snapshot> {
    const state = this.store.value;
    const games = state.games.filter((game) => !game.removed);
    const missing = (
      await Promise.all(
        games.map(async (game) =>
          (await exists(game.executable ?? path.join(game.root, "package.json"))) ? null : game.id,
        ),
      )
    ).filter((id): id is string => id !== null);
    return {
      ...state,
      games,
      missing,
      running: [...this.running.keys()],
      downloads: [...this.runtimes.downloads].map(([version, item]) => ({
        version,
        detail: item.detail,
      })),
      scanning: this.scanning !== null,
      lastScan: this.lastScan,
      bottles: (await exists(crossoverWine)) ? await listBottles() : null,
      terminals: await installedTerminals(),
    };
  }

  private game(id: string) {
    const game = this.store.value.games.find((item) => item.id === id && !item.removed);
    if (!game) throw new Error("This game is no longer in the library.");
    return game;
  }

  private idle(id: string) {
    if (this.running.has(id))
      throw new Error("Close the game before changing its files or settings.");
  }

  private async changeGame(id: string, change: (game: Game) => Game) {
    await this.store.update((state) => ({
      ...state,
      games: state.games.map((game) => (game.id === id ? change(game) : game)),
    }));
  }

  async handle(command: Command): Promise<unknown> {
    if (command.action === "snapshot") return this.snapshot();
    if (command.action === "releases") return getReleases();
    if (command.action === "addGames") {
      const folder = await this.native.chooseFolder();
      if (folder) await this.scan(folder, { restoreRemoved: true, requested: true });
      return this.snapshot();
    }
    if (command.action === "chooseGamesFolder") {
      const folder = await this.native.chooseFolder();
      if (!folder) return this.snapshot();
      await this.store.update((state) => ({ ...state, gamesFolder: folder }));
      await this.scan(folder, { restoreRemoved: false, requested: true });
      return this.snapshot();
    }
    if (command.action === "clearGamesFolder") {
      await this.store.update((state) => ({ ...state, gamesFolder: null }));
      return this.snapshot();
    }
    if (command.action === "setTerminal") {
      await this.store.update((state) => ({ ...state, terminal: command.terminal }));
      return this.snapshot();
    }
    if (command.action === "setDefaultBottle") {
      await this.store.update((state) => ({ ...state, defaultBottle: command.bottle }));
      return this.snapshot();
    }
    if (command.action === "scan") {
      await this.scanGamesFolder(true);
      return this.snapshot();
    }
    if (command.action === "installRuntime") {
      this.requireMac();
      await this.runtimes.install(command.version);
      return this.snapshot();
    }
    if (command.action === "cancelDownload") {
      this.runtimes.downloads.get(command.version)?.controller.abort();
      return this.snapshot();
    }
    const lock = "id" in command ? command.id : "runtimes";
    if (this.busy.has(lock)) throw new Error("An operation for this game is already in progress.");
    this.busy.add(lock);
    try {
      switch (command.action) {
        case "update": {
          const game = this.game(command.id);
          this.idle(game.id);
          const name = command.name.trim();
          if (!name || name.length > 160)
            throw new Error("Enter a display name between 1 and 160 characters.");
          const kind = gameKind(game);
          // Mac and Windows games take plain arguments; only NW.js has runtimes and switch rules.
          const native = kind !== "nwjs";
          if (
            !native &&
            command.runtime &&
            !this.store.value.runtimes.some((runtime) => runtime.version === command.runtime)
          )
            throw new Error("Install this runtime before assigning it.");
          const flags = native ? parseArguments(command.flags) : parseFlags(command.flags);
          if (
            !native &&
            game.runtime &&
            command.runtime &&
            compareVersions(command.runtime, game.runtime) < 0
          ) {
            const data = ownedPath(this.store.directory, "browser-data", game.id);
            if (await exists(data)) {
              const backup = path.join(
                ownedPath(this.store.directory, "browser-data-backups", game.id),
                randomUUID(),
              );
              await cp(data, backup, {
                recursive: true,
                dereference: false,
                errorOnExist: true,
                force: false,
              });
            }
          }
          await this.changeGame(game.id, (current) => {
            if (native)
              return {
                ...current,
                name,
                bottle: kind === "windows" ? command.bottle : null,
                flags,
              };
            if (
              command.runtime &&
              !this.store.value.runtimes.some((runtime) => runtime.version === command.runtime)
            )
              throw new Error("The selected runtime was removed. Choose another version.");
            return {
              ...current,
              name,
              runtime: command.runtime,
              flags,
            };
          });
          break;
        }
        case "artwork": {
          const game = this.game(command.id);
          const chosen = command.url === undefined ? await this.native.chooseArtwork() : null;
          if (command.url === undefined && !chosen) break;
          const download = chosen ? null : await downloadImage(command.url!);
          const readable = await readableImage(chosen ?? download!);
          try {
            if (!readable)
              throw new Error(
                chosen
                  ? "This file could not be read as an image."
                  : "The address does not point to an image.",
              );
            // Banners span the whole header, so they keep more resolution than icons.
            const image = await this.native.image(
              readable.file,
              command.slot === "banner" ? 2400 : 900,
            );
            if (!image) throw new Error("This file could not be read as an image.");
            await this.saveArtwork(game, command.slot, readable.file);
            await this.changeGame(game.id, (current) =>
              command.slot === "banner"
                ? { ...current, banner: image }
                : { ...current, artwork: image, customIcon: true },
            );
          } finally {
            if (download) await rm(download, { force: true });
            if (readable?.temporary) await rm(readable.file, { force: true });
          }
          break;
        }
        case "setTags":
          await this.changeGame(this.game(command.id).id, (current) => ({
            ...current,
            tags: normalizeTags(command.tags),
          }));
          break;
        case "setFavorite":
          await this.changeGame(this.game(command.id).id, (current) => ({
            ...current,
            favorite: command.favorite,
          }));
          break;
        case "resetIcon": {
          const game = this.game(command.id);
          const artwork = await this.originalIcon(game);
          await this.saveArtwork(game, "icon", null);
          await this.changeGame(game.id, (current) => ({
            ...current,
            artwork,
            customIcon: false,
          }));
          break;
        }
        case "clearBanner": {
          const game = this.game(command.id);
          await this.saveArtwork(game, "banner", null);
          await this.changeGame(game.id, (current) => ({
            ...current,
            banner: null,
          }));
          break;
        }
        case "remove": {
          const game = this.game(command.id);
          this.idle(game.id);
          if (command.deleteData) {
            await rm(ownedPath(this.store.directory, "browser-data", game.id), {
              recursive: true,
              force: true,
            });
            await rm(ownedPath(this.store.directory, "browser-data-backups", game.id), {
              recursive: true,
              force: true,
            });
          }
          await this.changeGame(game.id, (current) => ({ ...current, removed: true }));
          break;
        }
        case "relink": {
          const game = this.game(command.id);
          this.idle(game.id);
          const folder = await this.native.chooseFolder();
          if (!folder) break;
          const candidate = await detectGame(folder);
          if (!candidate || candidate.kind !== gameKind(game))
            throw new Error(
              `No ${{ nwjs: "NW.js game", windows: "Windows game", mac: "Mac app" }[gameKind(game)]} was found there.`,
            );
          if (
            this.store.value.games.some(
              (item) => item.id !== game.id && item.root === candidate.root,
            )
          )
            throw new Error("That folder already belongs to another game reference.");
          await this.changeGame(game.id, (current) => ({
            ...current,
            folder: candidate.folder,
            root: candidate.root,
            ...(candidate.executable ? { executable: candidate.executable } : {}),
          }));
          break;
        }
        case "plugins":
          return await listPlugins(this.store, this.game(command.id));
        case "togglePlugin":
          this.idle(command.id);
          return await changePlugins(this.store, this.game(command.id), command.hash, {
            index: command.index,
            enabled: command.enabled,
          });
        case "restorePlugins":
          this.idle(command.id);
          return await changePlugins(this.store, this.game(command.id), command.hash, "restore");
        case "removeRuntime": {
          const version = validVersion(command.version);
          if (this.runtimes.downloads.has(version))
            throw new Error("Wait for this download to finish.");
          if (this.store.value.games.some((game) => !game.removed && game.runtime === version))
            throw new Error(
              "Assign another runtime to the games using this version before removing it.",
            );
          const folder = path.join(this.store.directory, "runtimes", version);
          const trash = `${folder}.${randomUUID()}.removed`;
          const present = await exists(folder);
          if (present) await rename(folder, trash);
          try {
            await this.store.update((state) => {
              if (state.games.some((game) => !game.removed && game.runtime === version))
                throw new Error(
                  "A game now uses this runtime. Its installation has been retained.",
                );
              return {
                ...state,
                runtimes: state.runtimes.filter((runtime) => runtime.version !== version),
              };
            });
          } catch (error) {
            if (present) await rename(trash, folder);
            throw error;
          }
          if (present) await rm(trash, { recursive: true, force: true });
          break;
        }
        case "launch":
          await this.launch(this.game(command.id));
          break;
        case "stop": {
          const running = this.running.get(command.id);
          if (running) {
            running.stopped = true;
            const game = this.game(command.id);
            // CrossOver's launcher waits on the Windows process; end that process inside the bottle.
            if (gameKind(game) === "windows" && game.executable)
              spawn(
                crossoverWine,
                [
                  "--bottle",
                  this.bottleFor(game),
                  "--no-update",
                  "--no-gui",
                  "--cx-app",
                  "taskkill.exe",
                  "/F",
                  "/IM",
                  path.basename(game.executable),
                ],
                { stdio: "ignore" },
              ).on("error", () => running.process.kill("SIGTERM"));
            // `open -W` waits on the app, which LaunchServices started; end the app's own processes.
            else if (gameKind(game) === "mac")
              spawn(
                "/usr/bin/pkill",
                ["-TERM", "-f", path.join(game.root, "Contents", "MacOS") + "/"],
                {
                  stdio: "ignore",
                },
              ).on("close", () => running.process.kill("SIGTERM"));
            else running.process.kill("SIGTERM");
          }
          break;
        }
        case "reveal":
          this.native.reveal(this.game(command.id).root);
          break;
        case "openTerminal": {
          const game = this.game(command.id);
          const terminal = await terminalFor(this.store.value.terminal);
          // A Mac game's root is its app bundle, so the shell opens in the folder holding it.
          await openInTerminal(
            terminal.id,
            gameKind(game) === "mac" ? path.dirname(game.root) : game.root,
          );
          break;
        }
        case "revealPluginBackup":
          this.native.reveal(
            path.join(
              ownedPath(this.store.directory, "plugin-backups", this.game(command.id).id),
              "original.js",
            ),
          );
          break;
      }
      return this.snapshot();
    } finally {
      this.busy.delete(lock);
    }
  }

  /** Scans the configured games folder. Overlapping requests share one scan. */
  async scanGamesFolder(requested = false): Promise<ScanReport | null> {
    const folder = this.store.value.gamesFolder;
    return folder ? this.scan(folder, { restoreRemoved: false, requested }) : null;
  }

  private async scan(
    folder: string,
    options: { restoreRemoved: boolean; requested: boolean },
  ): Promise<ScanReport> {
    while (this.scanning) await this.scanning.catch(() => {});
    this.scanning = this.discover(folder, options);
    this.changed();
    try {
      this.lastScan = await this.scanning;
      return this.lastScan;
    } finally {
      this.scanning = null;
      this.changed();
    }
  }

  /**
   * Adds every game found under `folder`. A folder already referenced by the library is skipped,
   * including games the user removed, unless the user picked the folder by hand. A copy of a game
   * that is already known (same name, folder version, and game data) is reported and ignored.
   */
  private async discover(
    folder: string,
    { restoreRemoved, requested }: { restoreRemoved: boolean; requested: boolean },
  ): Promise<ScanReport> {
    const { games: found, problems } = await findGames(folder);
    const library = this.store.value.games;
    const known = new Map<string, string>();
    for (const game of library) {
      // Use the folder's preferred root, as the scan does, so both sides hash the same manifest.
      const current =
        (await detectGame(game.folder)) ??
        (await inspectRoot(game.folder, game.root).catch(() => null));
      if (current) known.set(await fingerprint(current), game.name);
    }
    const latest =
      [...this.store.value.runtimes].sort((a, b) => compareVersions(b.version, a.version))[0]
        ?.version ?? null;
    const added: Game[] = [];
    const restored = new Set<string>();
    const duplicates: ScanReport["duplicates"] = [];
    for (const candidate of found) {
      const existing = library.find(
        (game) => game.root === candidate.root || within(game.root, candidate.folder),
      );
      if (existing) {
        if (existing.removed && restoreRemoved) restored.add(existing.id);
        continue;
      }
      const key = await fingerprint(candidate);
      const original = known.get(key);
      if (original !== undefined) {
        duplicates.push({ folder: candidate.folder, of: original });
        continue;
      }
      const name = versionedName(
        candidate.name || path.basename(candidate.folder),
        candidate.folder,
        folder,
      );
      known.set(key, name);
      added.push({
        id: randomUUID(),
        folder: candidate.folder,
        root: candidate.root,
        name: name.slice(0, 160),
        tags: [],
        artwork: candidate.artwork ? await this.artwork(candidate.artwork) : null,
        runtime: candidate.kind === "nwjs" ? latest : null,
        kind: candidate.kind,
        executable: candidate.executable,
        flags: [],
        addedAt: new Date().toISOString(),
        lastPlayed: null,
        removed: false,
      });
    }
    await this.markCustomIcons();
    await this.fillWindowsIcons();
    if (added.length || restored.size)
      await this.store.update((state) => ({
        ...state,
        games: [
          ...state.games.map((game) =>
            restored.has(game.id)
              ? {
                  ...game,
                  removed: false,
                  runtime: gameKind(game) === "nwjs" ? (game.runtime ?? latest) : null,
                }
              : game,
          ),
          // Another scan or a relink may have claimed a folder while this one was reading.
          ...added.filter((game) => !state.games.some((item) => item.root === game.root)),
        ],
      }));
    return {
      folder,
      finishedAt: new Date().toISOString(),
      requested,
      added: [
        ...added.map((game) => game.name),
        ...library.filter((game) => restored.has(game.id)).map((game) => game.name),
      ],
      duplicates,
      problems,
    };
  }

  private requireMac() {
    if (process.platform !== "darwin" || process.arch !== "arm64")
      throw new Error("Game launching and runtime installation require an Apple Silicon Mac.");
  }

  /** Keeps a copy of custom artwork beside the game. Passing no source only removes the copy. */
  private async saveArtwork(game: Game, slot: "icon" | "banner", source: string | null) {
    const { directory, name } = artworkCopy(game, slot);
    const extension = source
      ? path.extname(source).slice(1).toLowerCase().replace("jpeg", "jpg")
      : null;
    for (const stale of ["png", "jpg", "webp"])
      if (stale !== extension) await rm(path.join(directory, `${name}.${stale}`), { force: true });
    if (source)
      await atomicWrite(
        path.join(directory, `${name}.${extension}`),
        await readFile(source),
        0o644,
      );
  }

  /**
   * Imports discovered artwork, converting a Mac app's .icns icon first. A Windows .exe gives its
   * own icon.
   */
  private async artwork(file: string) {
    if (/\.exe$/i.test(file)) {
      const icon = await extractExeIcon(file);
      if (!icon) return null;
      const readable = await readableImage(icon);
      try {
        return readable ? await this.native.image(readable.file) : null;
      } finally {
        await rm(icon, { force: true });
        if (readable?.temporary) await rm(readable.file, { force: true });
      }
    }
    if (!file.endsWith(".icns")) return this.native.image(file);
    const png = await iconToPng(file);
    if (!png) return null;
    try {
      return await this.native.image(png);
    } finally {
      await rm(png, { force: true });
    }
  }

  /** The icon found in the game itself: the .exe's icon, the app's icon, or the manifest's. */
  private async originalIcon(game: Game) {
    const source =
      gameKind(game) === "windows"
        ? game.executable
        : (
            (await detectGame(game.folder)) ??
            (await inspectRoot(game.folder, game.root).catch(() => null))
          )?.artwork;
    return source ? await this.artwork(source).catch(() => null) : null;
  }

  /**
   * Libraries from before `customIcon` existed only record a chosen icon as its copy in
   * `.aperto`, so each such game is checked once and the answer stored.
   */
  private async markCustomIcons() {
    const found = new Map<string, boolean>();
    for (const game of this.store.value.games) {
      if (game.customIcon !== undefined) continue;
      const { directory, name } = artworkCopy(game, "icon");
      let custom = false;
      for (const extension of ["png", "jpg", "webp"])
        if (await exists(path.join(directory, `${name}.${extension}`))) custom = true;
      found.set(game.id, custom);
    }
    if (found.size)
      await this.store.update((state) => ({
        ...state,
        games: state.games.map((game) =>
          game.customIcon === undefined && found.has(game.id)
            ? { ...game, customIcon: found.get(game.id)! }
            : game,
        ),
      }));
  }

  /**
   * Gives Windows games imported before icon extraction, or whose icon was not readable then, the
   * icon from their executable. Each game is tried once per session; a chosen icon is never replaced.
   */
  private async fillWindowsIcons() {
    for (const game of this.store.value.games) {
      if (game.removed || game.artwork || !game.executable || gameKind(game) !== "windows")
        continue;
      if (this.iconAttempts.has(game.id)) continue;
      this.iconAttempts.add(game.id);
      const artwork = await this.artwork(game.executable).catch(() => null);
      if (artwork)
        await this.changeGame(game.id, (current) =>
          current.artwork ? current : { ...current, artwork },
        );
    }
  }

  private bottleFor(game: Game) {
    const bottle = game.bottle ?? this.store.value.defaultBottle;
    if (!bottle) throw new Error("Choose a CrossOver bottle in Settings to run Windows games.");
    return bottle;
  }

  private async launch(game: Game) {
    this.requireMac();
    this.idle(game.id);
    if (gameKind(game) === "mac") {
      if (!game.executable || !(await exists(game.executable)))
        throw new Error("The app is missing. Locate it again.");
      // `open` lets macOS show its usual first-launch checks; -W waits so the session is tracked,
      // and -n starts a new instance even if a copy of the app is already open.
      return this.start(game, "macOS", "/usr/bin/open", [
        "-W",
        "-n",
        game.executable,
        ...(game.flags.length ? ["--args", ...game.flags] : []),
      ]);
    }
    if (gameKind(game) === "windows") {
      if (!(await exists(crossoverWine)))
        throw new Error("CrossOver is not installed in /Applications.");
      const bottle = this.bottleFor(game);
      if (!(await exists(path.join(bottlesDirectory, bottle, "cxbottle.conf"))))
        throw new Error(`The CrossOver bottle "${bottle}" no longer exists. Choose another one.`);
      if (!game.executable || !(await exists(game.executable)))
        throw new Error("The game's executable is missing. Locate the game folder again.");
      // Like dropping the .exe on CrossOver's Run Command: nothing is registered in the bottle.
      return this.start(game, bottle, crossoverWine, [
        "--bottle",
        bottle,
        // Updating the bottle resyncs CrossOver's Mac launchers in ~/Applications/CrossOver, which
        // macOS blocks as Aperto modifying other apps. CrossOver itself upgrades bottles when opened.
        "--no-update",
        // Keep the game from adding shortcuts or file associations to the bottle and the Mac.
        "--dll",
        "winemenubuilder.exe=d",
        "--workdir",
        game.root,
        // A path as the first argument runs that file; `--cx-app` would look it up in the bottle.
        game.executable,
        ...game.flags,
      ]);
    }
    await inspectRoot(game.folder, game.root);
    const manifest = await readObject(path.join(game.root, "package.json"));
    if (/--(?:user-data-dir|nwapp|url)(?:=|\s|$)/.test(String(manifest["chromium-args"] ?? ""))) {
      throw new Error(
        "The game supplies a launch flag that conflicts with Aperto's isolated browser data or application path. Remove that flag from the game's manifest before launching.",
      );
    }
    if (!game.runtime) throw new Error("Install and assign an NW.js runtime first.");
    const executable = runtimeExecutable(this.store.directory, game.runtime);
    if (!(await exists(executable)))
      throw new Error("The assigned runtime is missing. Reinstall it before launching.");
    const data = ownedPath(this.store.directory, "browser-data", game.id);
    await mkdir(data, { recursive: true });
    return this.start(game, game.runtime, executable, [
      `--user-data-dir=${data}`,
      ...game.flags,
      game.root,
    ]);
  }

  /** Spawns a game process and records the session until it exits. */
  private async start(game: Game, runtime: string, executable: string, args: string[]) {
    const id = randomUUID();
    const startedAt = new Date().toISOString();
    await this.store.update((state) => ({
      ...state,
      launches: [
        {
          id,
          gameId: game.id,
          runtime,
          startedAt,
          flags: args,
          endedAt: null,
          outcome: "running" as const,
          detail: "",
          log: "",
        },
        ...state.launches,
      ].slice(0, 100),
    }));
    const env = { ...process.env };
    delete env.NW_PRE_ARGS;
    delete env.NODE_OPTIONS;
    delete env.NODE_PATH;
    const child = spawn(executable, args, {
      cwd: game.root,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const session = { process: child, stopped: false };
    this.running.set(game.id, session);
    this.changed();
    let log = "";
    let errorMessage = "";
    const capture = (chunk: Buffer) => {
      log = (log + chunk.toString("utf8")).slice(-65536);
    };
    child.stdout?.on("data", capture);
    child.stderr?.on("data", capture);
    child.on("error", (error) => {
      errorMessage = message(error);
    });
    child.once("close", (code, signal) => {
      this.running.delete(game.id);
      const outcome = session.stopped
        ? "stopped"
        : errorMessage || code !== 0 || signal
          ? "failed"
          : "ended";
      const detail =
        errorMessage ||
        (signal
          ? `Process ended with ${signal}.`
          : `Process exited with code ${code ?? "unknown"}.`);
      void this.store
        .update((state) => ({
          ...state,
          launches: state.launches.map((launch) =>
            launch.id === id
              ? { ...launch, endedAt: new Date().toISOString(), outcome, detail, log }
              : launch,
          ),
        }))
        .catch((error) => {
          console.error("Could not save launch result:", error);
          this.changed();
        });
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    // The new launch is already in the history, so a first count from it includes this one.
    await this.changeGame(game.id, (current) => ({
      ...current,
      lastPlayed: startedAt,
      plays:
        current.plays === undefined
          ? playCount(current, this.store.value.launches)
          : current.plays + 1,
    }));
  }
}

/**
 * Where the copy of custom artwork lives: `.aperto` inside the game's folder. A Mac game's folder
 * is its app bundle, and writing inside would break its signature, so its copy sits next to the
 * bundle instead.
 */
function artworkCopy(game: Game, slot: "icon" | "banner") {
  const mac = gameKind(game) === "mac";
  return {
    directory: path.join(mac ? path.dirname(game.folder) : game.folder, ".aperto"),
    name: mac ? `${path.basename(game.folder, path.extname(game.folder))}-${slot}` : slot,
  };
}
