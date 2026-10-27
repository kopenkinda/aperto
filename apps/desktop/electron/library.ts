import { randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { cp, mkdir, readdir, readFile, realpath, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  compareVersions,
  gameKind,
  normalizeTags,
  sandboxable,
  searchName,
  titleMatches,
  type AutoTagReport,
  playCount,
  parseArguments,
  parseFlags,
  type Candidate,
  type Command,
  type Game,
  type ScanReport,
  type Engine,
  type SteamInstall,
  type Snapshot,
} from "../src/model";
import { downloadImage, readableImage } from "./artwork";
import { extractExeIcon } from "./exe-icon";
import { inspectRoot, readObject } from "./detection";
import { detectGame, findGames, fingerprint, versionedName, versionsIn, within } from "./discovery";
import { iconToPng } from "./mac";
import { listComponents, removeComponent } from "./components";
import { findF95Thread, metadataDetails, searchMetadata } from "./metadata";
import { mkxpLaunch } from "./mkxp";
import { renpyLaunch } from "./renpy";
import { sandboxed, type SandboxAccess } from "./sandbox";
import { installedTerminals, openInTerminal, terminalFor } from "./terminals";
import { bottlesDirectory, crossoverWine, listBottles, setRetinaMode } from "./windows";
import {
  changePlugins,
  cheatMenuPlugin,
  listPlugins,
  originallyHas,
  pixelFixPlugin,
  rpgMakerFolder,
} from "./plugins";
import { cheatMenu, cheatMenuFiles, pixelFixSource } from "./cheat-menu";
import { RuntimeManager, getReleases, runtimeExecutable, validVersion } from "./runtimes";
import { atomicWrite, exists, LibraryStore, message, ownedPath } from "./storage";

const execute = promisify(execFile);

export type NativeActions = {
  chooseFolder: () => Promise<string | null>;
  chooseArtwork: () => Promise<string | null>;
  /** Reads an image as a data URL, scaled down to fit `maxSize` pixels on its longer side. */
  image: (file: string, maxSize?: number) => Promise<string | null>;
  reveal: (file: string) => void;
  /** Moves a file or folder to the Trash. */
  trash: (file: string) => Promise<void>;
  /** Opens a web page in the default browser. */
  openExternal: (url: string) => void;
  /** Games installed with Steam inside CrossOver bottles. */
  bottleGames: () => Promise<Candidate[]>;
};

export class DesktopLibrary {
  readonly runtimes: RuntimeManager;
  /** Running games. A Steam game's process is its own, found by Aperto, rather than a child. */
  readonly running = new Map<
    string,
    { process: { kill: (signal?: NodeJS.Signals) => unknown }; stopped: boolean }
  >();
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
          (await exists(
            game.steam ? game.root : (game.executable ?? path.join(game.root, "package.json")),
          ))
            ? null
            : game.id,
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

  /** Normalized tags without the blocked ones, which never go on a game. */
  private allowedTags(tags: readonly string[]) {
    const blocked = new Set(this.store.value.blockedTags ?? []);
    return normalizeTags(tags).filter((tag) => !blocked.has(tag));
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
    if (command.action === "components") return listComponents(this.store.directory);
    if (command.action === "removeComponent") {
      const id = command.id;
      const kind = (await listComponents(this.store.directory)).find(
        (item) => item.id === id,
      )?.kind;
      if (
        kind &&
        this.store.value.games.some((game) => this.running.has(game.id) && gameKind(game) === kind)
      )
        throw new Error("Close the games that use this download before removing it.");
      await removeComponent(this.store.directory, id);
      return listComponents(this.store.directory);
    }
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
    if (command.action === "findMetadata")
      return searchMetadata(command.query ?? searchName(this.game(command.id).name));
    if (command.action === "metadataDetails") return metadataDetails(command.site, command.matchId);
    if (command.action === "autoTag") return this.autoTag();
    if (command.action === "checkUpdates") {
      await this.checkUpdates();
      return this.snapshot();
    }
    if (command.action === "openSource") {
      const game = this.game(command.id);
      const source =
        command.update && game.update
          ? { site: "f95" as const, id: game.update.thread }
          : game.source;
      if (!source) throw new Error("This game is not linked to F95zone or Steam.");
      this.native.openExternal(
        source.site === "f95"
          ? `https://f95zone.to/threads/${source.id}/`
          : `https://store.steampowered.com/app/${source.id}/`,
      );
      return this.snapshot();
    }
    if (command.action === "applyMetadata") {
      const { site, matchId, title } = command;
      const game = this.game(command.id);
      if (command.banner) await this.setArtwork(game, "banner", null, command.banner);
      await this.changeGame(game.id, (current) => ({
        ...current,
        tags: this.allowedTags([...current.tags, ...command.tags]),
        source: { site, id: matchId, title },
      }));
      return this.snapshot();
    }
    if (command.action === "renameTag") {
      const [to] = normalizeTags(command.to);
      if (!to || to.length > 40) throw new Error("Enter a tag name of at most 40 characters.");
      const from = command.from;
      if (from === to) return this.snapshot();
      await this.store.update((state) => {
        const { [from]: color, ...colors } = state.tagColors ?? {};
        return {
          ...state,
          games: state.games.map((game) =>
            game.tags.includes(from)
              ? {
                  ...game,
                  tags: this.allowedTags(game.tags.map((tag) => (tag === from ? to : tag))),
                }
              : game,
          ),
          // A merged tag keeps the color it already had.
          tagColors: color && !colors[to] ? { ...colors, [to]: color } : colors,
        };
      });
      return this.snapshot();
    }
    if (command.action === "deleteTag") {
      const tag = command.tag;
      await this.store.update((state) => {
        const { [tag]: _removed, ...colors } = state.tagColors ?? {};
        return {
          ...state,
          games: state.games.map((game) =>
            game.tags.includes(tag)
              ? { ...game, tags: game.tags.filter((item) => item !== tag) }
              : game,
          ),
          tagColors: colors,
        };
      });
      return this.snapshot();
    }
    if (command.action === "setBlockedTags") {
      const blocked = normalizeTags(command.tags);
      await this.store.update((state) => ({
        ...state,
        blockedTags: blocked,
        games: state.games.map((game) =>
          game.tags.some((tag) => blocked.includes(tag))
            ? { ...game, tags: game.tags.filter((tag) => !blocked.includes(tag)) }
            : game,
        ),
        tagColors: Object.fromEntries(
          Object.entries(state.tagColors ?? {}).filter(([tag]) => !blocked.includes(tag)),
        ),
      }));
      return this.snapshot();
    }
    if (command.action === "setTagColor") {
      const { tag, color } = command;
      await this.store.update((state) => {
        const { [tag]: _previous, ...colors } = state.tagColors ?? {};
        return { ...state, tagColors: color ? { ...colors, [tag]: color } : colors };
      });
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
          const kind = gameKind(game);
          const change: { -readonly [K in keyof Game]?: Game[K] } = {};
          if (command.name !== undefined) {
            const name = command.name.trim();
            if (!name || name.length > 160)
              throw new Error("Enter a display name between 1 and 160 characters.");
            change.name = name;
          }
          // A renamed game can keep running; launch settings wait until it closes.
          if (Object.keys(command).some((key) => !["action", "id", "name"].includes(key)))
            this.idle(game.id);
          // Mac and Windows games take plain arguments; only NW.js has runtimes and switch rules.
          if (command.flags !== undefined)
            change.flags =
              kind === "nwjs" ? parseFlags(command.flags) : parseArguments(command.flags);
          if (command.sandbox !== undefined) {
            if (!sandboxable(game)) throw new Error("Aperto cannot sandbox this kind of game.");
            change.sandbox = command.sandbox;
          }
          if (command.bottle !== undefined || command.highResolution !== undefined) {
            if (kind !== "windows") throw new Error("Only Windows games run in a bottle.");
            if (game.steam && command.bottle !== undefined && command.bottle !== game.steam.bottle)
              throw new Error("A Steam game runs in the bottle Steam installed it in.");
            if (command.bottle !== undefined) change.bottle = command.bottle;
            if (command.highResolution !== undefined)
              change.highResolution = command.highResolution;
          }
          const runtime = command.runtime;
          if (runtime !== undefined) {
            if (kind !== "nwjs") throw new Error("Only NW.js games use a runtime.");
            if (runtime && !this.store.value.runtimes.some((item) => item.version === runtime))
              throw new Error("Install this runtime before assigning it.");
            if (game.runtime && runtime && compareVersions(runtime, game.runtime) < 0) {
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
            change.runtime = runtime;
          }
          await this.changeGame(game.id, (current) => {
            if (runtime && !this.store.value.runtimes.some((item) => item.version === runtime))
              throw new Error("The selected runtime was removed. Choose another version.");
            return { ...current, ...change };
          });
          break;
        }
        case "artwork": {
          const game = this.game(command.id);
          const chosen = command.url === undefined ? await this.native.chooseArtwork() : null;
          if (command.url === undefined && !chosen) break;
          await this.setArtwork(game, command.slot, chosen, command.url ?? null);
          break;
        }
        case "setTags":
          await this.changeGame(this.game(command.id).id, (current) => ({
            ...current,
            tags: this.allowedTags(command.tags),
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
        case "folderToTrash":
          return await this.folderToTrash(this.game(command.id));
        case "remove": {
          const game = this.game(command.id);
          this.idle(game.id);
          // Checked again here, since the library may have changed since the dialog asked.
          if (command.trashFolder) await this.native.trash(await this.folderToTrash(game));
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
              `No ${{ nwjs: "NW.js game", windows: "Windows game", mac: "Mac app", renpy: "Ren'Py game", rgss: "RPG Maker XP–VX Ace game" }[gameKind(game)]} was found there.`,
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
        case "engine":
          return await detectEngine(this.game(command.id));
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
        case "setCheatMenu": {
          const game = this.game(command.id);
          this.idle(game.id);
          const folder = await rpgMakerFolder(game);
          if (!folder) throw new Error("The cheat menu works in RPG Maker MV and MZ games only.");
          const plugins = path.join(folder, "js", "plugins");
          if (command.enabled)
            for (const [name, data] of await cheatMenu(this.store.directory))
              await atomicWrite(path.join(plugins, name), data, 0o644);
          const list = await changePlugins(this.store, game, command.hash, {
            plugin: cheatMenuPlugin,
            enabled: command.enabled,
          });
          // Files the game shipped with itself stay.
          if (!command.enabled && !(await originallyHas(this.store, game, cheatMenuPlugin)))
            for (const name of cheatMenuFiles) await rm(path.join(plugins, name), { force: true });
          return list;
        }
        case "setPixelFix": {
          const game = this.game(command.id);
          this.idle(game.id);
          await this.changeGame(game.id, (current) => ({ ...current, pixelFix: command.enabled }));
          return await this.applyPixelFix(this.game(game.id));
        }
        case "updateRuntime": {
          const from = validVersion(command.from);
          const to = validVersion(command.to);
          if (compareVersions(to, from) <= 0)
            throw new Error("Choose a newer runtime to update to.");
          if (!this.store.value.runtimes.some((runtime) => runtime.version === to))
            throw new Error("Install this runtime before updating games to it.");
          const games = this.store.value.games.filter(
            (game) => !game.removed && game.runtime === from,
          );
          const running = games.find((game) => this.running.has(game.id));
          if (running) throw new Error(`Close ${running.name} before updating its runtime.`);
          // Newer runtimes read older browser data, so unlike a downgrade nothing is backed up.
          await this.store.update((state) => {
            if (!state.runtimes.some((runtime) => runtime.version === to))
              throw new Error("The selected runtime was removed. Choose another version.");
            return {
              ...state,
              games: state.games.map((game) =>
                !game.removed && game.runtime === from && !this.running.has(game.id)
                  ? { ...game, runtime: to }
                  : game,
              ),
            };
          });
          break;
        }
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
            // A Steam game's session ends its own processes inside the bottle.
            if (game.steam) running.process.kill("SIGTERM");
            // CrossOver's launcher waits on the Windows process; end that process inside the bottle.
            else if (gameKind(game) === "windows" && game.executable)
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

  private updating: Promise<void> | null = null;

  /**
   * Reads each game's newest version from its F95zone thread, and records it with the version of
   * this copy. A game whose thread is not known yet, such as one tagged from Steam, is looked up by
   * its title, which must match exactly. One request at a time.
   */
  checkUpdates(): Promise<void> {
    this.updating ??= (async () => {
      for (const game of this.store.value.games) {
        if (game.removed) continue;
        const known =
          game.update ??
          (game.source?.site === "f95"
            ? { thread: game.source.id, title: game.source.title }
            : null);
        const thread = known
          ? await findF95Thread(known.thread, known.title).catch(() => null)
          : ((await searchMetadata(searchName(game.name)).catch(() => [])).find(
              (item) => item.site === "f95" && titleMatches(game.name, item.title),
            ) ?? null);
        if (!thread?.version) continue;
        const { id, title, version } = thread;
        await this.changeGame(game.id, (current) => ({
          ...current,
          update: {
            thread: id,
            title,
            installed: installedVersion(current),
            latest: version,
            checkedAt: new Date().toISOString(),
          },
        }));
        this.changed();
      }
      await this.store.update((state) => ({
        ...state,
        updatesCheckedAt: new Date().toISOString(),
      }));
    })().finally(() => {
      this.updating = null;
    });
    return this.updating;
  }

  /** Checks for updates in the background when the last check is over 12 hours old. */
  checkUpdatesIfStale() {
    const last = this.store.value.updatesCheckedAt;
    if (last && Date.now() - Date.parse(last) < 12 * 3_600_000) return;
    void this.checkUpdates()
      .then(() => this.changed())
      .catch((error) => console.error("Update check failed:", error));
  }

  private autoTagging: Promise<AutoTagReport> | null = null;

  /**
   * Tags each game that has no source yet from F95zone, or else Steam, when a title there names it
   * exactly, and gives games without a banner the store's. Games without such a match are left for
   * the user to match on their page. Requests go one at a time, so the sites are not flooded.
   */
  autoTag(): Promise<AutoTagReport> {
    this.autoTagging ??= (async () => {
      const report: AutoTagReport = { tagged: [], unmatched: [], banners: [] };
      for (const game of this.store.value.games) {
        if (game.removed) continue;
        // A linked game only needs a banner, from the page it is linked to.
        if (game.source) {
          if (game.banner) continue;
          const { site, id, title } = game.source;
          const details = await metadataDetails(site, id).catch(() => null);
          const banner =
            details?.banner ??
            (site === "f95"
              ? (await searchMetadata(title).catch(() => [])).find(
                  (item) => item.site === site && item.id === id,
                )?.banner
              : null);
          if (
            banner &&
            (await this.setArtwork(game, "banner", null, banner).then(
              () => true,
              () => false,
            ))
          )
            report.banners.push(game.name);
          continue;
        }
        const matches = await searchMetadata(searchName(game.name)).catch(() => []);
        const match = matches.find((item) => titleMatches(game.name, item.title));
        const details = match
          ? await metadataDetails(match.site, match.id).catch(() => null)
          : null;
        if (!match || !details) {
          report.unmatched.push(game.name);
          continue;
        }
        // A banner the user chose stays; games without one get the store's.
        const banner = details.banner ?? match.banner;
        if (!game.banner && banner)
          await this.setArtwork(game, "banner", null, banner).then(
            () => report.banners.push(game.name),
            () => {},
          );
        await this.changeGame(game.id, (current) => ({
          ...current,
          tags: this.allowedTags([...current.tags, ...details.tags]),
          source: { site: match.site, id: match.id, title: match.title },
          ...(match.version
            ? {
                update: {
                  thread: match.id,
                  title: match.title,
                  installed: installedVersion(current),
                  latest: match.version,
                  checkedAt: new Date().toISOString(),
                },
              }
            : {}),
        }));
        report.tagged.push(game.name);
        this.changed();
      }
      return report;
    })().finally(() => {
      this.autoTagging = null;
    });
    return this.autoTagging;
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
    // Games installed with Steam inside CrossOver bottles, wherever the games folder is.
    found.push(...(await this.native.bottleGames().catch(() => [])));
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
      // Steam names its games itself; a bottle's folders carry no versions.
      const name = candidate.steam
        ? candidate.name
        : versionedName(
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
        ...(candidate.steam
          ? {
              steam: candidate.steam,
              bottle: candidate.steam.bottle,
              source: { site: "steam" as const, id: candidate.steam.appId, title: candidate.name },
            }
          : {}),
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

  /** Sets a game's icon or banner from a chosen file or, failing that, an image address. */
  private async setArtwork(
    game: Game,
    slot: "icon" | "banner",
    chosen: string | null,
    url: string | null,
  ) {
    const download = chosen ? null : await downloadImage(url!);
    const readable = await readableImage(chosen ?? download!);
    try {
      if (!readable)
        throw new Error(
          chosen
            ? "This file could not be read as an image."
            : "The address does not point to an image.",
        );
      // Banners span the whole header, so they keep more resolution than icons.
      const image = await this.native.image(readable.file, slot === "banner" ? 2400 : 900);
      if (!image) throw new Error("This file could not be read as an image.");
      await this.saveArtwork(game, slot, readable.file);
      await this.changeGame(game.id, (current) =>
        slot === "banner"
          ? { ...current, banner: image }
          : { ...current, artwork: image, customIcon: true },
      );
    } finally {
      if (download) await rm(download, { force: true });
      if (readable?.temporary) await rm(readable.file, { force: true });
    }
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

  /**
   * The folder to trash with a game: its own folder, widened through wrapper folders that hold
   * nothing else, as an extracted archive often leaves (`Game-v1.2/Game/`), but never to the games
   * folder itself. Refuses folders that hold the games folder, the home folder, or another game.
   */
  private async folderToTrash(game: Game) {
    // Game folders are stored resolved, so the games folder is compared resolved too.
    const setting = this.store.value.gamesFolder;
    const top = setting ? await realpath(setting).catch(() => setting) : null;
    let target = game.folder;
    while (top && within(path.dirname(target), top) && path.dirname(target) !== top) {
      const siblings = await readdir(path.dirname(target)).catch(() => null);
      if (siblings?.filter((name) => name !== ".DS_Store").length !== 1) break;
      target = path.dirname(target);
    }
    const others = this.store.value.games.filter(
      (other) => other.id !== game.id && !other.removed && within(other.folder, target),
    );
    if (
      target === path.parse(target).root ||
      within(homedir(), target) ||
      (top && within(top, target)) ||
      others.length
    )
      throw new Error(
        others.length
          ? `The game's folder also holds ${others[0]!.name}, so Aperto will not move it to the Trash.`
          : "Aperto will not move this folder to the Trash. Remove it in Finder instead.",
      );
    return target;
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

  /**
   * Adds or removes the getPixel fix so the game's plugin list matches its setting. A list
   * changed outside Aperto is left alone, as plugin edits are.
   */
  private async applyPixelFix(game: Game) {
    const list = await listPlugins(this.store, game);
    if (!list || list.conflict) return list;
    const wanted = game.pixelFix !== false;
    if (wanted === list.plugins.some((plugin) => plugin.name === pixelFixPlugin && plugin.enabled))
      return list;
    const file = path.join((await rpgMakerFolder(game))!, "js", "plugins", `${pixelFixPlugin}.js`);
    if (wanted) await atomicWrite(file, pixelFixSource, 0o644);
    const next = await changePlugins(this.store, game, list.hash, {
      plugin: pixelFixPlugin,
      enabled: wanted,
    });
    if (!wanted && !(await originallyHas(this.store, game, pixelFixPlugin)))
      await rm(file, { force: true });
    return next;
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
    if (gameKind(game) === "rgss") {
      const mkxp = await mkxpLaunch(
        this.store.directory,
        game.id,
        game.root,
        AbortSignal.timeout(20 * 60_000),
      );
      try {
        return await this.start(
          game,
          "mkxp-z",
          mkxp.executable,
          [...game.flags],
          game.sandbox === false
            ? null
            : { run: [mkxp.app], read: mkxp.read, write: [game.folder, mkxp.data] },
        );
      } finally {
        mkxp.started();
      }
    }
    if (gameKind(game) === "renpy") {
      if (!game.executable || !(await exists(game.executable)))
        throw new Error("The game's launcher script is missing. Locate the game folder again.");
      // Ren'Py keeps saves here as well as in the game folder, as native Mac builds do.
      const saves = path.join(homedir(), "Library", "RenPy");
      await mkdir(saves, { recursive: true });
      const renpy = await renpyLaunch(
        this.store.directory,
        game.root,
        game.executable,
        AbortSignal.timeout(10 * 60_000),
      );
      return this.start(
        game,
        renpy.runtime,
        renpy.executable,
        [...renpy.args, ...game.flags],
        game.sandbox === false
          ? null
          : { run: [renpy.folder], read: [saves], write: [game.folder, saves] },
      );
    }
    if (game.steam) {
      if (!(await exists(game.steam.client)))
        throw new Error(`Steam is no longer installed in the "${game.steam.bottle}" bottle.`);
      return this.startSteam(game, game.steam);
    }
    if (gameKind(game) === "windows") {
      const bottle = this.bottleFor(game);
      if (!game.executable || !(await exists(game.executable)))
        throw new Error("The game's executable is missing. Locate the game folder again.");
      await this.prepareBottle(game, bottle);
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
    // A game whose plugin list cannot be edited still starts, just without the fix.
    await this.applyPixelFix(game).catch((error) =>
      console.error("Could not apply the getPixel fix:", error),
    );
    const executable = runtimeExecutable(this.store.directory, game.runtime);
    if (!(await exists(executable)))
      throw new Error("The assigned runtime is missing. Reinstall it before launching.");
    const data = ownedPath(this.store.directory, "browser-data", game.id);
    await mkdir(data, { recursive: true });
    return this.start(
      game,
      game.runtime,
      executable,
      [`--user-data-dir=${data}`, ...game.flags, game.root],
      game.sandbox === false
        ? null
        : {
            run: [path.resolve(executable, "..", "..", "..")],
            read: [],
            write: [game.folder, data],
          },
    );
  }

  /** Spawns a game process and records the session until it exits. */
  private async start(
    game: Game,
    runtime: string,
    executable: string,
    args: string[],
    sandbox: SandboxAccess | null = null,
  ) {
    // The history keeps the game's own arguments; the sandbox wrapper only adds its rules.
    const [command, commandArgs] = sandbox
      ? await sandboxed(executable, args, sandbox)
      : [executable, args];
    const { id, startedAt } = await this.recordLaunch(game, runtime, args, sandbox !== null);
    const env = { ...process.env };
    delete env.NW_PRE_ARGS;
    delete env.NODE_OPTIONS;
    delete env.NODE_PATH;
    const child = spawn(command, commandArgs, {
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
      this.finishLaunch(id, outcome, detail, log);
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    await this.countPlay(game, startedAt);
  }

  /** Adds a running launch to the history. */
  private async recordLaunch(game: Game, runtime: string, flags: string[], sandboxed: boolean) {
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
          flags,
          sandboxed,
          endedAt: null,
          outcome: "running" as const,
          detail: "",
          log: "",
        },
        ...state.launches,
      ].slice(0, 100),
    }));
    return { id, startedAt };
  }

  /** Records how a launch ended. */
  private finishLaunch(
    id: string,
    outcome: "ended" | "failed" | "stopped",
    detail: string,
    log: string,
  ) {
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
  }

  private async countPlay(game: Game, startedAt: string) {
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

  /**
   * Starts a game through the Steam in its bottle, which keeps Steam's DRM and updates working,
   * and follows the game's own processes, found by the folder they run from. Steam may first need
   * to start, sign in, or update the game, so the game has three minutes to appear.
   */
  private async startSteam(game: Game, steam: SteamInstall) {
    await this.prepareBottle(game, steam.bottle);
    const args = ["-applaunch", steam.appId, ...game.flags];
    const launcher = spawn(
      crossoverWine,
      [
        "--bottle",
        steam.bottle,
        "--no-update",
        "--dll",
        "winemenubuilder.exe=d",
        steam.client,
        ...args,
      ],
      { stdio: "ignore", detached: true },
    );
    await new Promise<void>((resolve, reject) => {
      launcher.once("spawn", resolve);
      launcher.once("error", reject);
    });
    launcher.unref();
    const { id, startedAt } = await this.recordLaunch(game, `Steam · ${steam.bottle}`, args, false);
    // Windows processes show their Windows path, as in `C:\…\steamapps\common\Game\Game.exe`.
    const marker = `\\steamapps\\common\\${steam.installdir}\\`.toLowerCase();
    const processes = async () =>
      (await execute("/bin/ps", ["-axo", "command="]).catch(() => ({ stdout: "" }))).stdout
        .split("\n")
        .filter((line) => line.toLowerCase().includes(marker));
    const executables = new Set<string>();
    const session = {
      stopped: false,
      process: {
        kill: () => {
          for (const name of executables)
            spawn(
              crossoverWine,
              [
                "--bottle",
                steam.bottle,
                "--no-update",
                "--no-gui",
                "--cx-app",
                "taskkill.exe",
                "/F",
                "/IM",
                name,
              ],
              { stdio: "ignore" },
            ).on("error", () => {});
        },
      },
    };
    this.running.set(game.id, session);
    this.changed();
    await this.countPlay(game, startedAt);
    const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    void (async () => {
      let seen = false;
      let misses = 0;
      for (let waited = 0; !session.stopped; waited += 2000) {
        const found = await processes();
        for (const line of found) {
          const exe = /([^\\]+\.exe)/i.exec(line)?.[1];
          if (exe) executables.add(exe);
        }
        if (found.length) {
          seen = true;
          misses = 0;
        } else if (seen) {
          // A launcher often hands over to the game; two empty checks in a row mean it closed.
          if (++misses >= 2) break;
        } else if (waited >= 180_000) break;
        await pause(2000);
      }
      this.running.delete(game.id);
      this.finishLaunch(
        id,
        session.stopped ? "stopped" : seen ? "ended" : "failed",
        session.stopped
          ? "Stopped from Aperto."
          : seen
            ? "The game closed."
            : `The game did not start within 3 minutes. Steam in the "${steam.bottle}" bottle may need you to sign in or finish an update.`,
        "",
      );
      this.changed();
    })();
  }

  /**
   * Checks that a Windows game's bottle exists and sets the bottle's high resolution mode to the
   * game's, refusing when a game running in the same bottle needs the other mode.
   */
  private async prepareBottle(game: Game, bottle: string) {
    if (!(await exists(crossoverWine)))
      throw new Error("CrossOver is not installed in /Applications.");
    if (!(await exists(path.join(bottlesDirectory, bottle, "cxbottle.conf"))))
      throw new Error(`The CrossOver bottle "${bottle}" no longer exists. Choose another one.`);
    const highResolution = !!game.highResolution;
    const sharing = this.store.value.games.find(
      (other) =>
        other.id !== game.id &&
        this.running.has(other.id) &&
        gameKind(other) === "windows" &&
        this.bottleFor(other) === bottle &&
        !!other.highResolution !== highResolution,
    );
    if (sharing)
      throw new Error(
        `Close ${sharing.name} first. High resolution mode applies to the whole "${bottle}" bottle.`,
      );
    await setRetinaMode(bottle, highResolution);
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

/**
 * The version of a copy, as written in its folder names or its name, such as "v1.18c" in
 * `Rinas_Train-1.18c`. A dotted version wins over a bare one; null when there is none.
 */
function installedVersion(game: Game): string | null {
  const versions = versionsIn([...game.folder.split(path.sep).slice(-3), game.name]);
  return versions.filter((version) => version.includes(".")).at(-1) ?? versions.at(-1) ?? null;
}

/** The engine of a Windows or Mac game, recognized by the files its player ships with. */
async function detectEngine(game: Game): Promise<Engine | null> {
  const kind = gameKind(game);
  if (kind === "windows" && game.executable) {
    const data = `${path.basename(game.executable, path.extname(game.executable))}_Data`;
    if (
      (await exists(path.join(game.root, "UnityPlayer.dll"))) ||
      (await exists(path.join(game.root, data)))
    )
      return "unity";
  }
  if (
    kind === "mac" &&
    (await exists(path.join(game.root, "Contents", "Frameworks", "UnityPlayer.dylib")))
  )
    return "unity";
  return null;
}
