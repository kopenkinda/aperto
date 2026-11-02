import { randomUUID } from "node:crypto";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { cp, lstat, mkdir, readdir, readFile, realpath, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  compareVersions,
  gameKind,
  linkedSites,
  metadataSites,
  normalizeTags,
  sandboxable,
  steamApp,
  searchName,
  shownSites,
  sourceUrl,
  titleMatches,
  type Agent,
  type AutoTagReport,
  launchSeconds,
  playCount,
  playtime,
  parseArguments,
  parseFlags,
  type Candidate,
  type Command,
  type Game,
  type ScanReport,
  type Engine,
  formatSize,
  type ItchGame,
  type SteamInstall,
  type Snapshot,
} from "../src/model";
import { downloadImage, readableImage } from "./artwork";
import { extractExeIcon } from "./exe-icon";
import { inspectRoot, nameManifest, readObject } from "./detection";
import { detectGame, findGames, fingerprint, versionedName, versionsIn, within } from "./discovery";
import { iconToPng } from "./mac";
import { diskUsage, findComponents, listComponents, removeComponent } from "./components";
import { chooseUpload, downloadUpload, itchProfile, ownedGames, unpack } from "./itch";
import { findF95Thread, metadataDetails, searchF95, searchMetadata } from "./metadata";
import { mkxpLaunch } from "./mkxp";
import { renpyLaunch } from "./renpy";
import { sandboxed, type SandboxAccess } from "./sandbox";
import { agentScript, installedAgents } from "./agents";
import { installedTerminals, openInTerminal, runInTerminal, terminalFor } from "./terminals";
import { bottlesDirectory, crossoverWine, listBottles, setRetinaMode, wineArgs } from "./windows";
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
import { artworkCopy, atomicWrite, exists, LibraryStore, message, ownedPath } from "./storage";

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
  /** Secrets such as the itch.io API key, kept encrypted with the Keychain. Null removes one. */
  secret: (name: string, value?: string | null) => Promise<string | null>;
  /**
   * Games installed outside the games folder: game apps in the Applications folders, Mac games
   * installed with Steam, and games installed with Steam inside CrossOver bottles.
   */
  installedGames: () => Promise<Candidate[]>;
};

/**
 * Whether a game's folder was deleted: it does not exist, rather than being unreadable, and the
 * drive holding it, for a path under `/Volumes/<name>`, is connected.
 */
async function deleted(folder: string): Promise<boolean> {
  const volume = /^\/Volumes\/[^/]+/.exec(folder)?.[0];
  if (volume && !(await exists(volume))) return false;
  return lstat(folder).then(
    () => false,
    (error: NodeJS.ErrnoException) => error.code === "ENOENT",
  );
}

export class DesktopLibrary {
  readonly runtimes: RuntimeManager;
  /** Running games, each with how to stop it. */
  readonly running = new Map<string, { stop: () => void; stopped: boolean }>();
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
      itchDownloads: [...this.itchDownloads].map(([gameId, item]) => ({
        gameId,
        title: item.title,
        detail: item.detail,
        progress: item.progress,
      })),
      scanning: this.scanning !== null,
      lastScan: this.lastScan,
      checkingUpdates: this.updateProgress,
      bottles: (await exists(crossoverWine)) ? await listBottles() : null,
      agents: this.agents(),
      terminals: await installedTerminals(),
    };
  }

  private foundAgents: Agent[] = [];
  /**
   * The coding agents found so far. Asking the user's shell takes a moment, so the snapshot shows
   * the last answer and updates once a new one arrives.
   */
  private agents() {
    void installedAgents().then((agents) => {
      if (
        agents.map((agent) => agent.id).join() === this.foundAgents.map((agent) => agent.id).join()
      )
        return;
      this.foundAgents = agents;
      this.changed();
    });
    return this.foundAgents;
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
    if (command.action === "librarySize")
      return diskUsage(this.store.value.games.map((game) => game.folder));
    if (command.action === "removeComponent") {
      const id = command.id;
      const kind = (await findComponents(this.store.directory)).find(
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
      return searchMetadata(command.query ?? searchName(this.game(command.id).name), command.site);
    if (command.action === "metadataDetails") return metadataDetails(command.site, command.matchId);
    if (command.action === "autoTag") return this.autoTag();
    if (command.action === "checkUpdates") {
      await this.checkUpdates();
      return this.snapshot();
    }
    if (command.action === "openSource") {
      const link = this.game(command.id).links?.[command.site];
      if (!link) throw new Error(`This game is not linked to ${metadataSites[command.site]}.`);
      this.native.openExternal(sourceUrl(command.site, link.id));
      return this.snapshot();
    }
    if (command.action === "setLinkSites") {
      const sites = command.sites;
      await this.store.update((state) => ({
        ...state,
        linkSites: shownSites({ linkSites: sites }),
      }));
      return this.snapshot();
    }
    if (command.action === "itchSignIn") {
      const key = command.key.trim();
      if (!/^[A-Za-z0-9]{20,64}$/.test(key))
        throw new Error("Paste the API key from itch.io's API keys page.");
      const user = await itchProfile(key);
      await this.native.secret("itch", key);
      this.itchOwned = null;
      await this.store.update((state) => ({ ...state, itchUser: user }));
      return this.snapshot();
    }
    if (command.action === "itchSignOut") {
      await this.native.secret("itch", null);
      this.itchOwned = null;
      await this.store.update((state) => {
        const { itchUser: _, ...rest } = state;
        return rest;
      });
      return this.snapshot();
    }
    if (command.action === "itchKeysPage") {
      this.native.openExternal("https://itch.io/user/settings/api-keys");
      return this.snapshot();
    }
    if (command.action === "itchGames") {
      this.itchOwned = await ownedGames(await this.itchKey());
      return this.itchOwned;
    }
    if (command.action === "itchDownload") {
      await this.downloadItch(command.keyId);
      return this.snapshot();
    }
    if (command.action === "itchCancel") {
      this.itchDownloads.get(command.gameId)?.controller.abort();
      return this.snapshot();
    }
    if (command.action === "applyMetadata") {
      const { site, matchId, title } = command;
      const game = this.game(command.id);
      if (command.banner) await this.setArtwork(game, "banner", null, command.banner);
      await this.changeGame(game.id, (current) => {
        // A different F95zone thread makes the found update stale until the next check.
        const { update, ...rest } = current;
        const keepUpdate = site !== "f95" || current.links?.f95?.id === matchId;
        return {
          ...rest,
          ...(keepUpdate && update ? { update } : {}),
          tags: this.allowedTags([...current.tags, ...command.tags]),
          links: { ...current.links, [site]: { id: matchId, title } },
        };
      });
      return this.snapshot();
    }
    if (command.action === "unlink") {
      await this.changeGame(command.id, (current) => {
        const { [command.site]: _, ...links } = current.links ?? {};
        const { update, ...rest } = current;
        return {
          ...rest,
          ...(command.site !== "f95" && update ? { update } : {}),
          links,
        };
      });
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
          await this.launch(this.game(command.id), command.via);
          break;
        case "stop": {
          const running = this.running.get(command.id);
          if (running) {
            running.stopped = true;
            running.stop();
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
        case "openAgent": {
          const game = this.game(command.id);
          const terminal = await terminalFor(this.store.value.terminal);
          const folder = gameKind(game) === "mac" ? path.dirname(game.root) : game.root;
          await runInTerminal(
            terminal.id,
            await agentScript(
              this.store.directory,
              command.agent,
              folder,
              this.agentContext(game, folder),
            ),
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
  private updateProgress: { checked: number; total: number } | null = null;

  /**
   * Reads each game's newest version from its F95zone thread, and records it with the version of
   * this copy. A game not linked to F95zone yet is looked up by its title, which must match
   * exactly, and linked to the thread found. One request at a time, with progress in the snapshot.
   */
  checkUpdates(): Promise<void> {
    this.updating ??= (async () => {
      const games = this.store.value.games.filter((game) => !game.removed);
      for (const [index, game] of games.entries()) {
        this.updateProgress = { checked: index, total: games.length };
        this.changed();
        const known = game.links?.f95;
        const thread = known
          ? await findF95Thread(known.id, known.title).catch(() => null)
          : ((await searchF95(searchName(game.name)).catch(() => [])).find((item) =>
              titleMatches(game.name, item.title),
            ) ?? null);
        const version = thread?.version;
        if (!thread || !version) continue;
        await this.changeGame(game.id, (current) =>
          // The user may have linked another thread, or unlinked this one, during the check.
          current.links?.f95?.id === known?.id
            ? {
                ...current,
                links: { ...current.links, f95: { id: thread.id, title: thread.title } },
                update: updateRecord(current, version),
              }
            : current,
        );
      }
      await this.store.update((state) => ({
        ...state,
        updatesCheckedAt: new Date().toISOString(),
      }));
    })().finally(() => {
      this.updating = null;
      this.updateProgress = null;
      this.changed();
    });
    return this.updating;
  }

  /** Checks for updates in the background when the last check is over 12 hours old. */
  checkUpdatesIfStale() {
    const last = this.store.value.updatesCheckedAt;
    if (last && Date.now() - Date.parse(last) < 12 * 3_600_000) return;
    void this.checkUpdates().catch((error) => console.error("Update check failed:", error));
  }

  private itchOwned: ItchGame[] | null = null;
  private readonly itchDownloads = new Map<
    string,
    { title: string; detail: string; progress: number | null; controller: AbortController }
  >();

  private async itchKey() {
    const key = this.store.value.itchUser ? await this.native.secret("itch") : null;
    if (!key) throw new Error("Sign in to itch.io in Settings first.");
    return key;
  }

  /**
   * Downloads an owned itch.io game into a new folder in the games folder, then scans the folder
   * and links each game found in it to its itch.io page, with the page's tags and banner. The
   * download unpacks beside Aperto's data first, so a scan never sees half a game.
   */
  private async downloadItch(keyId: string) {
    const key = await this.itchKey();
    const find = (games: ItchGame[] | null) => games?.find((item) => item.keyId === keyId);
    const game = find(this.itchOwned) ?? find((this.itchOwned = await ownedGames(key)));
    if (!game) throw new Error("This game is no longer in your itch.io library.");
    const folder = this.store.value.gamesFolder;
    if (!folder)
      throw new Error("Choose a games folder in Settings first; itch.io games download there.");
    if (this.itchDownloads.has(game.gameId))
      throw new Error(`${game.title} is already downloading.`);
    const download = {
      title: game.title,
      detail: "Starting…",
      progress: null as number | null,
      controller: new AbortController(),
    };
    this.itchDownloads.set(game.gameId, download);
    this.changed();
    const staging = path.join(this.store.directory, "downloads", randomUUID());
    try {
      await mkdir(staging, { recursive: true });
      const upload = await chooseUpload(key, game);
      const file = path.join(staging, path.basename(upload.filename) || "download");
      let reported = 0;
      await downloadUpload(
        key,
        game,
        upload,
        file,
        download.controller.signal,
        (received, total) => {
          if (received - reported < 1024 ** 2) return;
          reported = received;
          download.progress = total ? received / total : null;
          download.detail = total
            ? `${formatSize(received)} of ${formatSize(total)}`
            : formatSize(received);
          this.changed();
        },
      );
      download.detail = "Unpacking…";
      download.progress = null;
      this.changed();
      const unpacked = path.join(staging, "game");
      await unpack(file, unpacked);
      download.controller.signal.throwIfAborted();
      let destination = path.join(folder, folderName(game.title));
      for (let copy = 2; await exists(destination); copy++)
        destination = path.join(folder, `${folderName(game.title)} ${copy}`);
      // The games folder may be on another drive, where a rename cannot reach.
      await rename(unpacked, destination).catch(async (error: NodeJS.ErrnoException) => {
        if (error.code !== "EXDEV") throw error;
        await execute("/usr/bin/ditto", [unpacked, destination]);
      });
      await this.scanGamesFolder(true);
      const real = await realpath(destination);
      const found = this.store.value.games.filter(
        (item) => !item.removed && within(item.folder, real),
      );
      if (!found.length) {
        this.native.reveal(destination);
        throw new Error(
          `${game.title} downloaded to ${destination}, but Aperto found no game it can run in it.`,
        );
      }
      const details = await metadataDetails("itch", game.page).catch(() => null);
      for (const item of found) {
        if (!item.banner && details?.banner)
          await this.setArtwork(item, "banner", null, details.banner).catch(() => {});
        await this.changeGame(item.id, (current) => ({
          ...current,
          name: game.title.slice(0, 160),
          tags: this.allowedTags([...current.tags, ...(details?.tags ?? [])]),
          links: { ...current.links, itch: { id: game.page, title: game.title } },
        }));
      }
    } catch (error) {
      // Stopped by the user, which needs no message.
      if (!download.controller.signal.aborted) throw error;
    } finally {
      await rm(staging, { recursive: true, force: true });
      this.itchDownloads.delete(game.gameId);
      this.changed();
    }
  }

  private autoTagging: Promise<AutoTagReport> | null = null;

  /**
   * Tags each unlinked game from F95zone, or else Steam, or else itch.io, among the sites shown on
   * game pages, when a title there names it exactly, and links it to that page. Linked games without tags get those of their page in
   * the same order, and
   * games without a banner get the store's. Games without such a match are left for the user to
   * match on their page. Requests go one at a time, so the sites are not flooded.
   */
  autoTag(): Promise<AutoTagReport> {
    this.autoTagging ??= (async () => {
      const report: AutoTagReport = { tagged: [], unmatched: [], banners: [] };
      for (const game of this.store.value.games) {
        if (game.removed) continue;
        const sites = linkedSites(game);
        if (sites.length) {
          if (!game.tags.length) {
            const site = (["f95", "steam", "itch"] as const).find((item) => sites.includes(item))!;
            const details = await metadataDetails(site, game.links![site]!.id).catch(() => null);
            if (details?.tags.length) {
              await this.changeGame(game.id, (current) => ({
                ...current,
                tags: this.allowedTags([...current.tags, ...details.tags]),
              }));
              report.tagged.push(game.name);
            }
          }
          if (game.banner) continue;
          // Steam's and itch.io's banners come with the game's details; F95zone's with its search result.
          const site = sites[0]!;
          const { id, title } = game.links![site]!;
          const banner =
            site === "f95"
              ? (await findF95Thread(id, title).catch(() => null))?.banner
              : (await metadataDetails(site, id).catch(() => null))?.banner;
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
        const shown = shownSites(this.store.value);
        if (!shown.length) continue;
        const matches = (
          await Promise.all(
            shown.map((site) => searchMetadata(searchName(game.name), site).catch(() => [])),
          )
        ).flat();
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
          links: { ...current.links, [match.site]: { id: match.id, title: match.title } },
          ...(match.version ? { update: updateRecord(current, match.version) } : {}),
        }));
        report.tagged.push(game.name);
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
    // Apps and Steam installs, on the Mac and in CrossOver bottles, wherever the games folder is.
    found.push(...(await this.native.installedGames().catch(() => [])));
    // Candidates carry resolved paths, so the folder is compared resolved too.
    const scanRoot = await realpath(folder).catch(() => folder);
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
      // Games installed outside the games folder, by Steam or as apps, have their own names; their
      // folders carry no versions.
      const name =
        candidate.steam || candidate.steamAppId || !within(candidate.folder, scanRoot)
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
              links: { steam: { id: candidate.steam.appId, title: candidate.name } },
            }
          : candidate.steamAppId
            ? { links: { steam: { id: candidate.steamAppId, title: candidate.name } } }
            : {}),
        flags: [],
        addedAt: new Date().toISOString(),
        lastPlayed: null,
        removed: false,
      });
    }
    // A deleted game leaves the list as if removed by hand, so its data returns if it comes back.
    // One on a disconnected drive is kept until the drive is back.
    const vanished: Game[] = [];
    for (const game of library)
      if (!game.removed && (await deleted(game.folder))) vanished.push(game);
    await this.markCustomIcons();
    await this.fillWindowsIcons();
    if (vanished.length)
      await this.store.update((state) => ({
        ...state,
        games: state.games.map((game) =>
          vanished.some((item) => item.id === game.id) ? { ...game, removed: true } : game,
        ),
      }));
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
      removed: vanished.map((game) => game.name),
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
    const { directory, name } = artworkCopy(game, slot, this.store.directory);
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
      const { directory, name } = artworkCopy(game, "icon", this.store.directory);
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

  /**
   * What a coding agent opened on a game is told first: where the game is, what kind it is, and
   * how Aperto starts it, so it can read logs and change files without asking.
   */
  private agentContext(game: Game, folder: string) {
    const kind = gameKind(game);
    const sandbox = sandboxable(game)
      ? game.sandbox !== false
        ? "on: no internet, no other programs, writes only to the game folder and its data"
        : "off"
      : null;
    const how = game.steam
      ? `Windows game installed with Steam in the CrossOver bottle "${game.steam.bottle}". Play starts it through that bottle's Steam; the user can also have Aperto run ${game.executable} in the bottle directly, like Run Command.`
      : kind === "windows"
        ? `Windows game run with CrossOver's wine in the bottle "${game.bottle ?? this.store.value.defaultBottle ?? "(none chosen)"}", like Run Command: ${game.executable}`
        : kind === "mac"
          ? steamApp(game)
            ? `Mac app installed with Steam (app ${steamApp(game)}). Play starts it through Steam with \`open steam://run/${steamApp(game)}\`; the user can also have Aperto open it directly with \`open -W -n ${game.executable}\`.`
            : `Mac app, opened with \`open -W -n ${game.executable}\`.`
          : kind === "renpy"
            ? `Ren'Py game, run with Aperto's own Ren'Py runtime from the launcher script ${game.executable}. Saves are also in ~/Library/RenPy.`
            : kind === "rgss"
              ? "RPG Maker XP–VX Ace game, run natively with mkxp-z."
              : `NW.js game (RPG Maker MV/MZ or similar), run with NW.js ${game.runtime ?? "(no runtime assigned)"} as \`nw --user-data-dir=${ownedPath(this.store.directory, "browser-data", game.id)} ${game.root}\`. Browser data, including localStorage saves, is in that user data folder.`;
    const last = this.store.value.launches.find((launch) => launch.gameId === game.id);
    const links = linkedSites(game).map(
      (site) => `${metadataSites[site]}: ${sourceUrl(site, game.links![site]!.id)}`,
    );
    return [
      `You are helping with a game in the user's Aperto library. Aperto is a macOS app that launches games made for other platforms.`,
      `- Game: ${game.name}`,
      `- Working directory: ${folder}`,
      ...(game.root !== folder ? [`- Game root: ${game.root}`] : []),
      `- How it runs: ${how}`,
      ...(sandbox ? [`- Aperto's sandbox: ${sandbox}`] : []),
      ...(game.flags.length ? [`- Launch flags: ${game.flags.join(" ")}`] : []),
      ...(game.update
        ? [
            `- Version: this copy ${game.update.installed ?? "unknown"}, latest on F95zone ${game.update.latest}`,
          ]
        : []),
      ...(last
        ? [
            `- Last launch: ${last.outcome}, ${last.startedAt}${last.detail ? `: ${last.detail}` : ""}`,
          ]
        : []),
      ...(links.length ? [`- Pages: ${links.join(", ")}`] : []),
      `- Running now: ${this.running.has(game.id) ? "yes; ask the user to close it in Aperto before changing its files" : "no"}`,
    ].join("\n");
  }

  private bottleFor(game: Game) {
    const bottle = game.bottle ?? this.store.value.defaultBottle;
    if (!bottle) throw new Error("Choose a CrossOver bottle in Settings to run Windows games.");
    return bottle;
  }

  /** Starts a game. A Steam game starts through Steam unless `via` asks Aperto to run it itself. */
  private async launch(game: Game, via: "steam" | "aperto" = "steam") {
    this.requireMac();
    this.idle(game.id);
    const macSteam = game.steam ? null : steamApp(game);
    if (macSteam && via === "steam") {
      if (!(await exists(game.root))) throw new Error("The app is missing. Locate it again.");
      return this.startMacSteam(game, macSteam);
    }
    if (gameKind(game) === "mac") {
      if (!game.executable || !(await exists(game.executable)))
        throw new Error("The app is missing. Locate it again.");
      // `open` lets macOS show its usual first-launch checks; -W waits so the session is tracked,
      // and -n starts a new instance even if a copy of the app is already open.
      const contents = path.join(game.root, "Contents", "MacOS") + "/";
      return this.start(
        game,
        "macOS",
        "/usr/bin/open",
        ["-W", "-n", game.executable, ...(game.flags.length ? ["--args", ...game.flags] : [])],
        {
          // `open -W` waits on the app, which LaunchServices started; end the app's own processes.
          stop: (child) =>
            spawn("/usr/bin/pkill", ["-TERM", "-f", contents], { stdio: "ignore" }).on(
              "close",
              () => child.kill("SIGTERM"),
            ),
        },
      );
    }
    if (gameKind(game) === "rgss") {
      const mkxp = await mkxpLaunch(
        this.store.directory,
        game.id,
        game.root,
        AbortSignal.timeout(20 * 60_000),
      );
      try {
        return await this.start(game, "mkxp-z", mkxp.executable, [...game.flags], {
          sandbox: { run: [mkxp.app], read: mkxp.read, write: [game.folder, mkxp.data] },
        });
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
      return this.start(game, renpy.runtime, renpy.executable, [...renpy.args, ...game.flags], {
        sandbox: { run: [renpy.folder], read: [saves], write: [game.folder, saves] },
      });
    }
    if (game.steam && via === "steam") {
      if (!(await exists(game.steam.client)))
        throw new Error(`Steam is no longer installed in the "${game.steam.bottle}" bottle.`);
      return this.startSteam(game, game.steam);
    }
    if (gameKind(game) === "windows") {
      const bottle = this.bottleFor(game);
      if (!game.executable || !(await exists(game.executable)))
        throw new Error("The game's executable is missing. Locate the game folder again.");
      await this.prepareBottle(game, bottle);
      const executable = game.executable;
      // Like dropping the .exe on CrossOver's Run Command: nothing is registered in the bottle. A
      // path as the first argument runs that file; `--cx-app` would look it up in the bottle.
      return this.start(
        game,
        bottle,
        crossoverWine,
        wineArgs(bottle, ["--workdir", game.root, executable, ...game.flags], "game"),
        {
          // CrossOver's launcher waits on the Windows process; end that process in the bottle.
          stop: (child) =>
            spawn(
              crossoverWine,
              wineArgs(bottle, ["taskkill.exe", "/F", "/IM", path.basename(executable)], "tool"),
              { stdio: "ignore" },
            ).on("error", () => child.kill("SIGTERM")),
        },
      );
    }
    await inspectRoot(game.folder, game.root);
    await nameManifest(game.root, game.name);
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
      {
        sandbox: {
          run: [path.resolve(executable, "..", "..", "..")],
          read: [],
          write: [game.folder, data],
        },
      },
    );
  }

  /**
   * Spawns a game process and records the session until it exits. The game runs in the sandbox
   * with the given access unless its Protection is off. Stopping sends SIGTERM unless the launch
   * says how else to end the game.
   */
  private async start(
    game: Game,
    runtime: string,
    executable: string,
    args: string[],
    options: {
      sandbox?: SandboxAccess;
      stop?: (child: ChildProcess) => void;
    } = {},
  ) {
    const sandbox =
      options.sandbox && sandboxable(game) && game.sandbox !== false ? options.sandbox : null;
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
    const session = {
      stopped: false,
      stop: () => (options.stop ? options.stop(child) : child.kill("SIGTERM")),
    };
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
      .update((state) => {
        const endedAt = new Date().toISOString();
        const launches = state.launches.map((launch) =>
          launch.id === id ? { ...launch, endedAt, outcome, detail, log } : launch,
        );
        const finished = launches.find((launch) => launch.id === id);
        if (!finished) return { ...state, launches };
        // A first total from the history already includes this launch.
        const games = state.games.map((game) =>
          game.id === finished.gameId
            ? {
                ...game,
                playtime:
                  game.playtime === undefined
                    ? playtime(game, launches)
                    : game.playtime + launchSeconds(finished),
              }
            : game,
        );
        return { ...state, launches, games };
      })
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
   * Starts a game through the Steam in its bottle, which keeps Steam's DRM and updates working.
   * Windows processes show their Windows path, as in `C:\…\steamapps\common\Game\Game.exe`.
   */
  private async startSteam(game: Game, steam: SteamInstall) {
    await this.prepareBottle(game, steam.bottle);
    const args = ["-applaunch", steam.appId, ...game.flags];
    const marker = `\\steamapps\\common\\${steam.installdir}\\`.toLowerCase();
    const executables = new Set<string>();
    return this.followSteam(game, {
      runtime: `Steam · ${steam.bottle}`,
      args,
      client: `Steam in the "${steam.bottle}" bottle`,
      launcher: () =>
        spawn(crossoverWine, wineArgs(steam.bottle, [steam.client, ...args], "game"), {
          stdio: "ignore",
          detached: true,
        }),
      matches: (line) => {
        if (!line.toLowerCase().includes(marker)) return false;
        const exe = /([^\\]+\.exe)/i.exec(line)?.[1];
        if (exe) executables.add(exe);
        return true;
      },
      // Ends the game's own processes, which Steam started, inside the bottle.
      stop: () => {
        for (const name of executables)
          spawn(
            crossoverWine,
            wineArgs(steam.bottle, ["taskkill.exe", "/F", "/IM", name], "tool"),
            { stdio: "ignore" },
          ).on("error", () => {});
      },
    });
  }

  /** Starts a Mac game through the Mac Steam client, by its Steam link. */
  private async startMacSteam(game: Game, appId: string) {
    const contents = path.join(game.root, "Contents", "MacOS") + "/";
    // Steam passes what follows `//` in a run link to the game.
    const link = `steam://run/${appId}${game.flags.length ? `//${encodeURIComponent(game.flags.join(" "))}` : ""}`;
    return this.followSteam(game, {
      runtime: "Steam",
      args: [...game.flags],
      client: "Steam",
      launcher: () => spawn("/usr/bin/open", ["-g", link], { stdio: "ignore", detached: true }),
      matches: (line) => line.includes(contents),
      stop: () => {
        spawn("/usr/bin/pkill", ["-TERM", "-f", contents], { stdio: "ignore" }).on(
          "error",
          () => {},
        );
      },
    });
  }

  /**
   * Asks a Steam client to start a game, then follows the game's own processes, which Steam
   * starts, by the lines of `ps` they match. Steam may first need to start, sign in, or update the
   * game, so the game has three minutes to appear.
   */
  private async followSteam(
    game: Game,
    steam: {
      runtime: string;
      args: string[];
      /** The Steam client, as named in the message when the game does not start. */
      client: string;
      launcher: () => ChildProcess;
      matches: (line: string) => boolean;
      stop: () => void;
    },
  ) {
    const launcher = steam.launcher();
    await new Promise<void>((resolve, reject) => {
      launcher.once("spawn", resolve);
      launcher.once("error", reject);
    });
    launcher.unref();
    const { id, startedAt } = await this.recordLaunch(game, steam.runtime, steam.args, false);
    const processes = async () =>
      (await execute("/bin/ps", ["-axo", "command="]).catch(() => ({ stdout: "" }))).stdout
        .split("\n")
        .filter(steam.matches);
    const session = { stopped: false, stop: steam.stop };
    this.running.set(game.id, session);
    this.changed();
    await this.countPlay(game, startedAt);
    const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    void (async () => {
      let seen = false;
      let misses = 0;
      for (let waited = 0; !session.stopped; waited += 2000) {
        const found = await processes();
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
            : `The game did not start within 3 minutes. ${steam.client} may need you to sign in or finish an update.`,
        "",
      );
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

/** What an update check learned about a game from its F95zone thread. */
/** A folder name for a downloaded game: its title without characters macOS paths cannot hold. */
function folderName(title: string) {
  const name = title
    .replace(/[/:\\\p{Cc}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    // A leading dot would hide the folder.
    .replace(/^\.+/, "");
  return name.slice(0, 100) || "itch.io game";
}

function updateRecord(game: Game, latest: string): NonNullable<Game["update"]> {
  return { installed: installedVersion(game), latest, checkedAt: new Date().toISOString() };
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
