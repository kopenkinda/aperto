import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { cp, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import {
  compareVersions,
  normalizeTags,
  parseFlags,
  type Command,
  type Game,
  type ScanReport,
  type Snapshot,
} from "../src/model";
import { inspectFolder, inspectRoot, readObject } from "./detection";
import { findGames, fingerprint, versionedName, within } from "./discovery";
import { changePlugins, listPlugins } from "./plugins";
import { RuntimeManager, getReleases, runtimeExecutable, validVersion } from "./runtimes";
import { exists, LibraryStore, message, ownedPath } from "./storage";

export type NativeActions = {
  chooseFolder: () => Promise<string | null>;
  chooseArtwork: () => Promise<string | null>;
  image: (file: string) => Promise<string | null>;
  reveal: (file: string) => void;
};

export class DesktopLibrary {
  readonly runtimes: RuntimeManager;
  readonly running = new Map<string, { process: ChildProcess; stopped: boolean }>();
  private readonly busy = new Set<string>();
  private scanning: Promise<ScanReport> | null = null;
  private lastScan: ScanReport | null = null;

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
          (await exists(path.join(game.root, "package.json"))) ? null : game.id,
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
          if (
            command.runtime &&
            !this.store.value.runtimes.some((runtime) => runtime.version === command.runtime)
          )
            throw new Error("Install this runtime before assigning it.");
          const flags = parseFlags(command.flags);
          if (
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
            if (
              command.runtime &&
              !this.store.value.runtimes.some((runtime) => runtime.version === command.runtime)
            )
              throw new Error("The selected runtime was removed. Choose another version.");
            return {
              ...current,
              name,
              tags: normalizeTags(command.tags),
              runtime: command.runtime,
              flags,
            };
          });
          break;
        }
        case "artwork": {
          const game = this.game(command.id);
          const file = await this.native.chooseArtwork();
          if (file) {
            const artwork = await this.native.image(file);
            if (!artwork) throw new Error("This file could not be read as an image.");
            await this.changeGame(game.id, (current) => ({ ...current, artwork }));
          }
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
          const candidate = (await inspectFolder(folder)).game;
          if (!candidate) throw new Error("No NW.js game was found in that folder.");
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
            running.process.kill("SIGTERM");
          }
          break;
        }
        case "reveal":
          this.native.reveal(this.game(command.id).root);
          break;
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
        (await inspectFolder(game.folder).catch(() => null))?.game ??
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
        artwork: candidate.artwork ? await this.native.image(candidate.artwork) : null,
        runtime: latest,
        flags: [],
        addedAt: new Date().toISOString(),
        lastPlayed: null,
        removed: false,
      });
    }
    if (added.length || restored.size)
      await this.store.update((state) => ({
        ...state,
        games: [
          ...state.games.map((game) =>
            restored.has(game.id)
              ? { ...game, removed: false, runtime: game.runtime ?? latest }
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

  private async launch(game: Game) {
    this.requireMac();
    this.idle(game.id);
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
    const id = randomUUID();
    const startedAt = new Date().toISOString();
    await this.store.update((state) => ({
      ...state,
      launches: [
        {
          id,
          gameId: game.id,
          runtime: game.runtime!,
          startedAt,
          flags: [`--user-data-dir=${data}`, ...game.flags, game.root],
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
    const child = spawn(executable, [`--user-data-dir=${data}`, ...game.flags, game.root], {
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
    await this.changeGame(game.id, (current) => ({ ...current, lastPlayed: startedAt }));
  }
}
