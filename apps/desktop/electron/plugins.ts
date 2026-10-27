import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { Schema } from "effect";
import type { Game, PluginList } from "../src/model";
import type { BackupSchema } from "../src/model";
import { localFile } from "./detection";
import { atomicWrite, digest, exists, LibraryStore, ownedPath } from "./storage";

type Backup = typeof BackupSchema.Type;

const PluginsSchema = Schema.Array(
  Schema.Struct({
    name: Schema.String,
    status: Schema.Boolean,
    description: Schema.optional(Schema.String),
    parameters: Schema.Record(Schema.String, Schema.Unknown),
  }),
);

export function parsePlugins(source: string) {
  const match =
    /^(\uFEFF?(?:(?:\s+)|(?:\/\/[^\r\n]*(?:\r?\n|$))|(?:\/\*[\s\S]*?\*\/))*(?:var|let|const)\s+\$plugins\s*=\s*)(\[[\s\S]*\])(\s*;?\s*)$/.exec(
      source,
    );
  if (!match)
    throw new Error(
      "This game uses a custom plugin configuration. Aperto only edits standard MV/MZ plugin lists.",
    );
  // The schema only checks the fields Aperto uses. Decoding would drop the others, which the game
  // may rely on, so the parsed entries themselves are kept and written back.
  const raw: unknown = JSON.parse(match[2]!);
  Schema.decodeUnknownSync(PluginsSchema)(raw);
  const plugins = raw as typeof PluginsSchema.Type;
  if (plugins.length > 5000) throw new Error("This plugin list is too large.");
  return { prefix: match[1]!, suffix: match[3]!, plugins };
}

/**
 * The folder holding an RPG Maker MV/MZ export's js folder, the only kind with editable plugins,
 * or null for other games. Windows deployments keep the export in www next to package.json.
 */
export async function rpgMakerFolder(game: Game) {
  for (const folder of [game.root, path.join(game.root, "www")]) {
    if (
      (await exists(path.join(folder, "js", "rpg_core.js"))) ||
      (await exists(path.join(folder, "js", "rmmz_core.js")))
    )
      return folder;
  }
  return null;
}

async function readConfiguration(game: Game) {
  const folder = await rpgMakerFolder(game);
  if (!folder) throw new Error("Plugin toggles are available for RPG Maker MV/MZ exports only.");
  const file = path.join(folder, "js", "plugins.js");
  const info = await lstat(file);
  if (!info.isFile() || info.size > 4 * 1024 * 1024 || (await realpath(file)) !== file) {
    throw new Error(
      "Plugin configuration must be a regular file inside the game folder, no larger than 4 MB.",
    );
  }
  const source = await readFile(file, "utf8");
  return {
    file,
    folder,
    source,
    hash: digest(source),
    mode: info.mode & 0o777,
    ...parsePlugins(source),
  };
}

/** The game's plugins, or null when it is not an RPG Maker MV/MZ export. */
export async function listPlugins(store: LibraryStore, game: Game): Promise<PluginList | null> {
  if (!(await rpgMakerFolder(game))) return null;
  const configuration = await readConfiguration(game);
  const backup = store.value.backups.find((item) => item.gameId === game.id);
  const conflict = Boolean(
    backup && ![backup.lastWritten, backup.pending, backup.original].includes(configuration.hash),
  );
  return {
    hash: configuration.hash,
    conflict,
    cheatMenu: configuration.plugins.some(
      (plugin) => plugin.name === cheatMenuPlugin && plugin.status,
    ),
    canRestore: Boolean(backup && !conflict && configuration.hash !== backup.original),
    plugins: await Promise.all(
      configuration.plugins.map(async (plugin) => ({
        name: plugin.name,
        description: plugin.description ?? "",
        enabled: plugin.status,
        missing:
          !plugin.name ||
          !(await localFile(configuration.folder, `js/plugins/${plugin.name}.js`).then(
            () => true,
            () => false,
          )),
      })),
    ),
  };
}

/** Plugins Aperto adds itself, shown as switches instead of in the game's list. */
export type ManagedPlugin = typeof pixelFixPlugin | typeof cheatMenuPlugin;
export const pixelFixPlugin = "Aperto_PixelFix";
export const cheatMenuPlugin = "Cheat_Menu";

/**
 * Keeps the game's original plugin list before Aperto first changes it. Returns the backup record,
 * which `changePlugins` stores together with the write.
 */
async function firstBackup(
  game: Game,
  configuration: { hash: string; source: string },
  backupFile: string,
  backup: Backup | undefined,
): Promise<Backup> {
  if (backup) return backup;
  if (await exists(backupFile)) {
    if (digest(await readFile(backupFile)) !== configuration.hash)
      throw new Error(
        "An older plugin backup already exists. Resolve it before editing this game.",
      );
  } else {
    await atomicWrite(backupFile, configuration.source);
  }
  return {
    gameId: game.id,
    original: configuration.hash,
    lastWritten: configuration.hash,
    pending: null,
  };
}

/** Whether the game's original plugin list, from before Aperto changed it, has this plugin. */
export async function originallyHas(store: LibraryStore, game: Game, name: string) {
  const backup = path.join(ownedPath(store.directory, "plugin-backups", game.id), "original.js");
  const source = await readFile(backup, "utf8").catch(() => null);
  if (source === null) return (await readConfiguration(game)).plugins.some((p) => p.name === name);
  try {
    return parsePlugins(source).plugins.some((plugin) => plugin.name === name);
  } catch {
    return true;
  }
}

export async function changePlugins(
  store: LibraryStore,
  game: Game,
  expectedHash: string,
  change:
    | { index: number; enabled: boolean }
    | { plugin: ManagedPlugin; enabled: boolean }
    | "restore",
) {
  const configuration = await readConfiguration(game);
  if (configuration.hash !== expectedHash)
    throw new Error("The plugin configuration changed. Refresh the list before editing it.");
  let backup = store.value.backups.find((item) => item.gameId === game.id);
  if (
    backup &&
    ![backup.original, backup.lastWritten, backup.pending].includes(configuration.hash)
  ) {
    throw new Error(
      "The plugin configuration was changed outside Aperto. Your backup is preserved. Restore or reconcile it manually before making further changes.",
    );
  }
  const backupFile = path.join(
    ownedPath(store.directory, "plugin-backups", game.id),
    "original.js",
  );
  let next: string;
  if (change === "restore") {
    if (!backup) throw new Error("There is no original configuration to restore.");
    next = await readFile(backupFile, "utf8");
    if (digest(next) !== backup.original)
      throw new Error("The plugin backup is damaged. The game configuration has not been changed.");
  } else if ("plugin" in change) {
    const others = configuration.plugins.filter((plugin) => plugin.name !== change.plugin);
    const entry = {
      name: change.plugin,
      status: true,
      description: "Added by Aperto",
      parameters: {},
    };
    // The fix goes first, so plugins that replace getPixel later still wrap it; the menu goes
    // last, as its own install instructions say.
    const plugins = !change.enabled
      ? others
      : change.plugin === pixelFixPlugin
        ? [entry, ...others]
        : [...others, entry];
    next = configuration.prefix + JSON.stringify(plugins, null, 2) + configuration.suffix;
    backup = await firstBackup(game, configuration, backupFile, backup);
  } else {
    const selected = configuration.plugins[change.index];
    if (!selected) throw new Error("That plugin is no longer in the list.");
    if (change.enabled) await localFile(configuration.folder, `js/plugins/${selected.name}.js`);
    const plugins = configuration.plugins.map((plugin, index) =>
      index === change.index ? { ...plugin, status: change.enabled } : plugin,
    );
    next = configuration.prefix + JSON.stringify(plugins, null, 2) + configuration.suffix;
    backup = await firstBackup(game, configuration, backupFile, backup);
  }
  const pending = { ...backup, pending: digest(next) };
  await store.update((state) => ({
    ...state,
    backups: [...state.backups.filter((item) => item.gameId !== game.id), pending],
  }));
  await atomicWrite(configuration.file, next, configuration.mode, async () => {
    const current = await readConfiguration(game);
    if (current.hash !== expectedHash)
      throw new Error("The configuration changed while saving. No game changes were written.");
  });
  await store.update((state) => ({
    ...state,
    backups: state.backups.map((item) =>
      item.gameId === game.id ? { ...item, lastWritten: digest(next), pending: null } : item,
    ),
  }));
  // readConfiguration above confirmed an RPG Maker export, so the list exists.
  return (await listPlugins(store, game))!;
}
