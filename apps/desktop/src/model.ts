import { Schema } from "effect";

export const metadataSites = { f95: "F95zone", steam: "Steam", itch: "itch.io" } as const;
export type MetadataSite = keyof typeof metadataSites;
const SiteSchema = Schema.Literals(["f95", "steam", "itch"]);
export const SteamInstallSchema = Schema.Struct({
  appId: Schema.String,
  bottle: Schema.String,
  /** The game's folder name under `steamapps/common`, which its processes run from. */
  installdir: Schema.String,
  /** The bottle's `steam.exe`, as a Mac path. */
  client: Schema.String,
});
export type SteamInstall = typeof SteamInstallSchema.Type;
const LinkSchema = Schema.Struct({ id: Schema.String, title: Schema.String });
export type Link = typeof LinkSchema.Type;
export const GameSchema = Schema.Struct({
  id: Schema.String,
  folder: Schema.String,
  root: Schema.String,
  name: Schema.String,
  tags: Schema.Array(Schema.String),
  /** Starred on the game's page. Favorites lead the library list. Older libraries omit it. */
  favorite: Schema.optionalKey(Schema.Boolean),
  /** Square icon, shown in the list and the page header. */
  artwork: Schema.NullOr(Schema.String),
  /** The icon was chosen by the user rather than found in the game. Older libraries omit it. */
  customIcon: Schema.optionalKey(Schema.Boolean),
  /** Wide image across the page header; without one, the header uses a blur of the icon. */
  banner: Schema.optionalKey(Schema.NullOr(Schema.String)),
  runtime: Schema.NullOr(Schema.String),
  flags: Schema.Array(Schema.String),
  addedAt: Schema.String,
  lastPlayed: Schema.NullOr(Schema.String),
  /** Launches started, kept apart from the launch history, which only holds the latest 100. */
  plays: Schema.optionalKey(Schema.Int),
  /** Seconds played across finished launches, kept apart from the launch history like `plays`. */
  playtime: Schema.optionalKey(Schema.Number),
  removed: Schema.Boolean,
  // Windows games run through CrossOver; Mac games are app bundles. Older libraries omit these.
  kind: Schema.optionalKey(Schema.Literals(["nwjs", "windows", "mac", "renpy", "rgss"])),
  executable: Schema.optionalKey(Schema.NullOr(Schema.String)),
  /** CrossOver bottle for this game; unset uses the library's default bottle. */
  bottle: Schema.optionalKey(Schema.NullOr(Schema.String)),
  /** A game installed with Steam inside a CrossOver bottle, which that bottle's Steam starts. */
  steam: Schema.optionalKey(SteamInstallSchema),
  /** Runs a Windows game in CrossOver's high resolution (Retina) mode. */
  highResolution: Schema.optionalKey(Schema.Boolean),
  /** Adds Aperto's getPixel fix to an RPG Maker game at launch. Unset means on. */
  pixelFix: Schema.optionalKey(Schema.Boolean),
  /**
   * The game's F95zone thread, Steam app, and itch.io page, which itch.io links keep as an address
   * without the scheme. Tags, banners, and update checks come from them.
   * Older libraries have a single `source` instead, moved here on load by `migrateLibrary`.
   */
  links: Schema.optionalKey(
    Schema.Struct({
      f95: Schema.optionalKey(LinkSchema),
      steam: Schema.optionalKey(LinkSchema),
      itch: Schema.optionalKey(LinkSchema),
    }),
  ),
  /** The newest version on the game's F95zone thread and the version of this copy, read from its folder or name. */
  update: Schema.optionalKey(
    Schema.Struct({
      installed: Schema.NullOr(Schema.String),
      latest: Schema.String,
      checkedAt: Schema.String,
    }),
  ),
  /** Runs the game in Aperto's macOS sandbox. Unset means on; only `false` turns it off. */
  sandbox: Schema.optionalKey(Schema.Boolean),
});
export type Game = typeof GameSchema.Type;
/** The sites a game is linked to, in the order banners are taken from them: Steam's are largest. */
export const linkedSites = (game: Pick<Game, "links">) =>
  (["steam", "f95", "itch"] as const).filter((site) => game.links?.[site]);

/**
 * Brings a library written by an older Aperto up to date before it is decoded: the single
 * `source` link and the F95zone thread that update checks kept become `links`.
 */
export function migrateLibrary(data: unknown): unknown {
  if (!data || typeof data !== "object" || !Array.isArray((data as { games?: unknown }).games))
    return data;
  const library = data as { games: Record<string, unknown>[] };
  return {
    ...library,
    games: library.games.map((game) => {
      const { source, ...rest } = game as {
        source?: { site: MetadataSite; id: string; title: string };
        update?: { thread?: string; title?: string };
        links?: Partial<Record<MetadataSite, Link>>;
      };
      const thread = rest.update?.thread;
      if (!source && !thread) return game;
      const links = { ...rest.links };
      if (source) links[source.site] ??= { id: source.id, title: source.title };
      if (thread) links.f95 ??= { id: thread, title: rest.update?.title ?? "" };
      return { ...rest, links };
    }),
  };
}
export const gameKind = (game: Pick<Game, "kind">) => game.kind ?? "nwjs";
/** Games Aperto starts itself can run in its sandbox; Mac apps open through macOS, Windows games through CrossOver. */
export const sandboxable = (game: Pick<Game, "kind">) =>
  ["nwjs", "renpy", "rgss"].includes(gameKind(game));
export const RuntimeSchema = Schema.Struct({
  version: Schema.String,
  installedAt: Schema.String,
  sha256: Schema.String,
});
export type Runtime = typeof RuntimeSchema.Type;
export const LaunchSchema = Schema.Struct({
  id: Schema.String,
  gameId: Schema.String,
  runtime: Schema.String,
  startedAt: Schema.String,
  flags: Schema.Array(Schema.String),
  /** Ran in Aperto's sandbox. Older launches omit it. */
  sandboxed: Schema.optionalKey(Schema.Boolean),
  endedAt: Schema.NullOr(Schema.String),
  outcome: Schema.Literals(["running", "ended", "failed", "stopped", "interrupted"]),
  detail: Schema.String,
  log: Schema.String,
});
export type Launch = typeof LaunchSchema.Type;
export const BackupSchema = Schema.Struct({
  gameId: Schema.String,
  original: Schema.String,
  lastWritten: Schema.String,
  pending: Schema.NullOr(Schema.String),
});
/** Colors a tag can have; tags without one are gray. */
export const tagColorNames = [
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "violet",
  "pink",
] as const;
export type TagColor = (typeof tagColorNames)[number];
export const LibrarySchema = Schema.Struct({
  version: Schema.Literal(1),
  games: Schema.Array(GameSchema),
  runtimes: Schema.Array(RuntimeSchema),
  launches: Schema.Array(LaunchSchema),
  backups: Schema.Array(BackupSchema),
  // Folder scanned for games on startup, on focus, and on request. Older libraries omit it.
  gamesFolder: Schema.optionalKey(Schema.NullOr(Schema.String)),
  defaultBottle: Schema.optionalKey(Schema.NullOr(Schema.String)),
  /** Bundle ID of the terminal that opens game folders; unset picks one automatically. */
  terminal: Schema.optionalKey(Schema.NullOr(Schema.String)),
  /** When linked games were last checked for updates. */
  updatesCheckedAt: Schema.optionalKey(Schema.String),
  /** Tags removed from every game and never added again. Older libraries omit it. */
  blockedTags: Schema.optionalKey(Schema.Array(Schema.String)),
  /** The itch.io account signed in with an API key, which is kept in the Keychain. */
  itchUser: Schema.optionalKey(Schema.Struct({ id: Schema.String, name: Schema.String })),
  /** Colors chosen for tags, by tag. Older libraries omit it. */
  tagColors: Schema.optionalKey(Schema.Record(Schema.String, Schema.Literals(tagColorNames))),
});
export type Library = typeof LibrarySchema.Type;
export type Snapshot = Library & {
  missing: string[];
  running: string[];
  downloads: { version: string; detail: string }[];
  scanning: boolean;
  lastScan: ScanReport | null;
  /** itch.io games downloading into the games folder, by itch.io game ID. */
  itchDownloads: { gameId: string; title: string; detail: string }[];
  /** How far the running update check has got, or null when none is running. */
  checkingUpdates: { checked: number; total: number } | null;
  /** CrossOver bottles, or null when CrossOver is not installed. */
  bottles: string[] | null;
  /** Coding agents the user's shell can run, which open in a game's folder from its page. */
  agents: Agent[];
  /** Supported terminals installed on this Mac, the automatic choice first. */
  terminals: { id: string; name: string }[];
};
export type Candidate = {
  kind: "nwjs" | "windows" | "mac" | "renpy" | "rgss";
  /**
   * The Windows .exe, the Mac .app, a Ren'Py game's launcher script, or an RPG Maker XP–VX Ace
   * game's .ini; null for NW.js games, which launch their root.
   */
  executable: string | null;
  folder: string;
  root: string;
  name: string;
  /** NW.js or RPG Maker files corroborate the manifest, or the entry is an HTML page. */
  confirmed: boolean;
  artwork: string | null;
  steam?: typeof SteamInstallSchema.Type;
};
export type ScanReport = {
  folder: string;
  finishedAt: string;
  /** Started by the user rather than on launch or focus. */
  requested: boolean;
  added: string[];
  /** Games whose folders were deleted, taken out of the list. */
  removed: string[];
  /** Copies of a game already in the library or found earlier in the same scan. */
  duplicates: { folder: string; of: string }[];
  problems: string[];
};
export type Plugin = { name: string; description: string; enabled: boolean; missing: boolean };
export type PluginList = {
  hash: string;
  plugins: Plugin[];
  canRestore: boolean;
  conflict: boolean;
  /** The cheat menu plugin is in the list and on. */
  cheatMenu: boolean;
};
/** Plugins Aperto adds for its own switches; the plugin list leaves them out. */
export const managedPlugins = ["Aperto_PixelFix", "Cheat_Menu"];
/** A game on F95zone, Steam, or itch.io that may be the library game being tagged. */
export type MetadataMatch = {
  site: MetadataSite;
  id: string;
  title: string;
  /** Developer and version on F95zone. */
  detail: string;
  /** The current version on F95zone; Steam does not publish versions. */
  version: string | null;
  cover: string | null;
  /**
   * A wide image for the page header: F95zone's cover at full size. Steam's banner comes with the
   * game's details instead.
   */
  banner: string | null;
};
/** A coding agent's command and name, such as `claude` for Claude Code. */
export type Agent = { id: string; name: string };
export type ItchPlatform = "mac" | "windows" | "linux" | "web";
/** A game the itch.io account bought or claimed. */
export type ItchGame = {
  /** The download key that proves the purchase. */
  keyId: string;
  gameId: string;
  title: string;
  /** The game's page without the scheme, as itch.io links keep it. */
  page: string;
  cover: string | null;
  author: string;
  platforms: ItchPlatform[];
};
/** A game's page on F95zone, Steam, or itch.io. */
export const sourceUrl = (site: MetadataSite, id: string) =>
  site === "f95"
    ? `https://f95zone.to/threads/${id}/`
    : site === "steam"
      ? `https://store.steampowered.com/app/${id}/`
      : `https://${id}`;
export type MetadataDetails = { tags: string[]; banner: string | null };
export type AutoTagReport = { tagged: string[]; unmatched: string[]; banners: string[] };
/** A download Aperto keeps besides NW.js runtimes, needed by games of one kind. */
export type Component = {
  id: string;
  name: string;
  kind: NonNullable<Game["kind"]>;
  /** Bytes on disk. */
  size: number;
};
export type Release = { version: string; chromium: string; node: string };

const id = { id: Schema.String };
export const CommandSchema = Schema.Union([
  Schema.Struct({ action: Schema.Literal("snapshot") }),
  Schema.Struct({ action: Schema.Literal("addGames") }),
  Schema.Struct({ action: Schema.Literal("chooseGamesFolder") }),
  Schema.Struct({ action: Schema.Literal("clearGamesFolder") }),
  Schema.Struct({ action: Schema.Literal("scan") }),
  Schema.Struct({ action: Schema.Literal("setTerminal"), terminal: Schema.NullOr(Schema.String) }),
  Schema.Struct({
    action: Schema.Literal("setDefaultBottle"),
    bottle: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    action: Schema.Literal("update"),
    ...id,
    // Each setting saves on its own, so only the fields being changed are sent.
    name: Schema.optionalKey(Schema.String),
    runtime: Schema.optionalKey(Schema.NullOr(Schema.String)),
    bottle: Schema.optionalKey(Schema.NullOr(Schema.String)),
    highResolution: Schema.optionalKey(Schema.Boolean),
    flags: Schema.optionalKey(Schema.String),
    sandbox: Schema.optionalKey(Schema.Boolean),
  }),
  Schema.Struct({
    action: Schema.Literal("artwork"),
    ...id,
    slot: Schema.Literals(["icon", "banner"]),
    /** Downloads the image from this address instead of asking for a file. */
    url: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({ action: Schema.Literal("clearBanner"), ...id }),
  /** Removes a chosen icon and goes back to the one found in the game. */
  Schema.Struct({ action: Schema.Literal("resetIcon"), ...id }),
  Schema.Struct({ action: Schema.Literal("setTags"), ...id, tags: Schema.Array(Schema.String) }),
  /** Renames a tag on every game; renaming to an existing tag merges the two. */
  Schema.Struct({ action: Schema.Literal("renameTag"), from: Schema.String, to: Schema.String }),
  Schema.Struct({ action: Schema.Literal("deleteTag"), tag: Schema.String }),
  /** Replaces the blocked tags and removes them from every game. */
  Schema.Struct({ action: Schema.Literal("setBlockedTags"), tags: Schema.Array(Schema.String) }),
  /** Searches F95zone, Steam, and itch.io, or only `site`, for a game, by its name unless a query is given. */
  Schema.Struct({
    action: Schema.Literal("findMetadata"),
    ...id,
    query: Schema.optionalKey(Schema.String),
    site: Schema.optionalKey(SiteSchema),
  }),
  Schema.Struct({
    action: Schema.Literal("metadataDetails"),
    site: SiteSchema,
    matchId: Schema.String,
  }),
  /** Links a game to a chosen match and adds the match's tags. */
  Schema.Struct({
    action: Schema.Literal("applyMetadata"),
    ...id,
    site: SiteSchema,
    matchId: Schema.String,
    title: Schema.String,
    tags: Schema.Array(Schema.String),
    /** Replaces the game's banner with this image. */
    banner: Schema.optionalKey(Schema.String),
  }),
  /**
   * Tags every unlinked game whose title clearly matches one on F95zone, Steam, or itch.io, and linked games
   * without tags from their page.
   */
  Schema.Struct({ action: Schema.Literal("autoTag") }),
  /** Reads the newest version of every game from its F95zone thread. */
  Schema.Struct({ action: Schema.Literal("checkUpdates") }),
  /** Opens a game's linked F95zone thread or Steam page in the browser. */
  Schema.Struct({
    action: Schema.Literal("openSource"),
    ...id,
    site: SiteSchema,
  }),
  /** Forgets a game's link to a site; unlinking F95zone also forgets the update it found. */
  Schema.Struct({
    action: Schema.Literal("unlink"),
    ...id,
    site: SiteSchema,
  }),
  /** Signs in to itch.io with an API key from the account's API keys page. */
  Schema.Struct({ action: Schema.Literal("itchSignIn"), key: Schema.String }),
  Schema.Struct({ action: Schema.Literal("itchSignOut") }),
  /** Opens itch.io's API keys page, where the user makes the key to sign in with. */
  Schema.Struct({ action: Schema.Literal("itchKeysPage") }),
  /** The games the itch.io account owns. */
  Schema.Struct({ action: Schema.Literal("itchGames") }),
  /** Downloads an owned itch.io game into the games folder, adds it, and links it. */
  Schema.Struct({ action: Schema.Literal("itchDownload"), keyId: Schema.String }),
  Schema.Struct({ action: Schema.Literal("itchCancel"), gameId: Schema.String }),
  Schema.Struct({
    action: Schema.Literal("setTagColor"),
    tag: Schema.String,
    color: Schema.NullOr(Schema.Literals(tagColorNames)),
  }),
  Schema.Struct({ action: Schema.Literal("setFavorite"), ...id, favorite: Schema.Boolean }),
  Schema.Struct({
    action: Schema.Literal("remove"),
    ...id,
    deleteData: Schema.Boolean,
    /** Also moves the game's folder to the Trash. */
    trashFolder: Schema.optionalKey(Schema.Boolean),
  }),
  /** The folder that removing the game with `trashFolder` would move to the Trash. */
  Schema.Struct({ action: Schema.Literal("folderToTrash"), ...id }),
  Schema.Struct({ action: Schema.Literal("relink"), ...id }),
  Schema.Struct({ action: Schema.Literal("plugins"), ...id }),
  /** The engine of a Windows or Mac game, for its known launch switches. */
  Schema.Struct({ action: Schema.Literal("engine"), ...id }),
  Schema.Struct({
    action: Schema.Literal("togglePlugin"),
    ...id,
    hash: Schema.String,
    index: Schema.Int,
    enabled: Schema.Boolean,
  }),
  Schema.Struct({ action: Schema.Literal("restorePlugins"), ...id, hash: Schema.String }),
  Schema.Struct({
    action: Schema.Literal("setCheatMenu"),
    ...id,
    hash: Schema.String,
    enabled: Schema.Boolean,
  }),
  Schema.Struct({ action: Schema.Literal("setPixelFix"), ...id, enabled: Schema.Boolean }),
  Schema.Struct({ action: Schema.Literal("releases") }),
  Schema.Struct({ action: Schema.Literal("components") }),
  /** Disk space taken by the games' folders, in bytes. */
  Schema.Struct({ action: Schema.Literal("librarySize") }),
  Schema.Struct({ action: Schema.Literal("removeComponent"), id: Schema.String }),
  Schema.Struct({ action: Schema.Literal("installRuntime"), version: Schema.String }),
  Schema.Struct({ action: Schema.Literal("cancelDownload"), version: Schema.String }),
  Schema.Struct({ action: Schema.Literal("removeRuntime"), version: Schema.String }),
  /** Moves every game on runtime `from` to the newer installed runtime `to`. */
  Schema.Struct({
    action: Schema.Literal("updateRuntime"),
    from: Schema.String,
    to: Schema.String,
  }),
  Schema.Struct({ action: Schema.Literal("launch"), ...id }),
  Schema.Struct({ action: Schema.Literal("stop"), ...id }),
  Schema.Struct({ action: Schema.Literal("reveal"), ...id }),
  Schema.Struct({ action: Schema.Literal("openTerminal"), ...id }),
  /** Opens a coding agent in the game's folder, told where the game is and how it runs. */
  Schema.Struct({ action: Schema.Literal("openAgent"), ...id, agent: Schema.String }),
  Schema.Struct({ action: Schema.Literal("revealPluginBackup"), ...id }),
]);
export type Command = typeof CommandSchema.Type;
/** What each command returns besides the library snapshot most of them answer with. */
type Results = {
  plugins: PluginList | null;
  togglePlugin: PluginList;
  restorePlugins: PluginList;
  setCheatMenu: PluginList;
  setPixelFix: PluginList | null;
  releases: Release[];
  folderToTrash: string;
  engine: Engine | null;
  components: Component[];
  librarySize: number;
  removeComponent: Component[];
  findMetadata: MetadataMatch[];
  metadataDetails: MetadataDetails;
  autoTag: AutoTagReport;
  itchGames: ItchGame[];
};
export type ResultFor<C extends Command> = C["action"] extends keyof Results
  ? Results[C["action"]]
  : Snapshot;
export interface DesktopApi {
  request<C extends Command>(command: C): Promise<ResultFor<C>>;
  onChange(listener: () => void): () => void;
}

/** A size in bytes as megabytes, or gigabytes from 1 GB. */
export const formatSize = (bytes: number) =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;

/** Lowercased, distinct tags. Text with commas counts as several tags. */
export function normalizeTags(input: string | readonly string[]): string[] {
  return [
    ...new Set(
      (typeof input === "string" ? [input] : input)
        .flatMap((text) => text.split(","))
        .map((tag) => tag.trim().replace(/\s+/g, " ").toLocaleLowerCase())
        .filter(Boolean),
    ),
  ];
}

/**
 * A library name as a search query: without versions, bracketed notes, and release words such as
 * "Steam", "Uncensored", or "Full Version" that store titles leave out.
 */
export function searchName(name: string): string {
  return name
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/(?<![\p{L}\p{N}])v?\d{4}-\d{2}-\d{2}(?![\p{L}\p{N}])/giu, " ")
    .replace(/(?<![\p{L}\p{N}])(?:v|ver|version|build)\s?\.?\d[\w.]*/giu, " ")
    .replace(/(?<![\p{L}\p{N}])dlc\s?\d*(?![\p{L}\p{N}])/giu, " ")
    .replace(/(?<![\p{L}\p{N}])\d+(?:\.\d+)+[a-z]?(?![\p{L}\p{N}])/giu, " ")
    .replace(
      /(?<![\p{L}\p{N}])(?:steam|r18|en|eng|english|uncensored|decensored|censored|full version|patched|pc|final|compressed)(?![\p{L}\p{N}])/giu,
      " ",
    )
    .replace(/[\s\-–~:]+$/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

const comparable = (title: string) =>
  searchName(title)
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");

// The part before a subtitle, as in "Nightmare Knight ~Sacred Maiden~" or "Academy Love Saga: …".
export const mainTitle = (title: string) => title.split(/\s*[~:–—]\s*|\s+-\s+/)[0]!;

/**
 * Whether a store title clearly names the same game, as automatic tagging requires: the same
 * words, or a store title with a subtitle the library name leaves out. A store title without the
 * library name's subtitle may be another game in the series, so it does not count.
 */
export function titleMatches(name: string, title: string): boolean {
  const a = comparable(name);
  const b = comparable(title);
  if (a.length < 3 || b.length < 3) return false;
  if (a === b) return true;
  const short = comparable(mainTitle(searchName(title)));
  return short === a && short.length >= 6;
}

/**
 * The version-like part of a version label: "v1.18c" is 1.18c, "Ch.3 v0.5" is 0.5, and a date such
 * as "2026-01-31" counts as 2026.01.31. Null for labels without digits, such as "Final".
 */
function versionParts(label: string): (number | string)[] | null {
  const date = /(\d{4})-(\d{2})-(\d{2})/.exec(label);
  const tokens = date ? [date.slice(1).join(".")] : label.match(/\d+(?:\.\d+)*[a-z]?/gi);
  if (!tokens) return null;
  // The token with the most parts; the last of equals, as in "Season 2 v1.4".
  const token = tokens.reduce((best, item) =>
    item.split(".").length >= best.split(".").length ? item : best,
  );
  return token
    .toLowerCase()
    .split(/\.|(?<=\d)(?=[a-z])/)
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part));
}

/** Compares two game version labels; null when either has no version number in it. */
export function compareGameVersions(a: string, b: string): number | null {
  const left = versionParts(a);
  const right = versionParts(b);
  if (!left || !right) return null;
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const x = left[index];
    const y = right[index];
    // A label with more parts is newer: 1.0.1 after 1.0, 1.0b after 1.0.
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x - y;
    return String(x).localeCompare(String(y));
  }
  return 0;
}

/** The linked F95zone thread has a newer version than this copy. */
export function updateAvailable(game: Pick<Game, "update">): boolean {
  const update = game.update;
  return !!update?.installed && (compareGameVersions(update.latest, update.installed) ?? 0) > 0;
}

/** Every tag in the library with how many games carry it, most used first. */
export function tagCounts(games: readonly Game[]): [tag: string, count: number][] {
  const counts = new Map<string, number>();
  for (const game of games)
    for (const tag of game.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** Times the game was launched. Older libraries count from the launch history they still hold. */
export const playCount = (game: Game, launches: readonly Pick<Launch, "gameId">[]) =>
  game.plays ?? launches.filter((launch) => launch.gameId === game.id).length;

/** Seconds a launch ran, or 0 while it runs or when Aperto missed its end. */
export const launchSeconds = (launch: Pick<Launch, "startedAt" | "endedAt" | "outcome">) =>
  launch.endedAt && launch.outcome !== "interrupted"
    ? Math.max(0, (Date.parse(launch.endedAt) - Date.parse(launch.startedAt)) / 1000)
    : 0;

/** Seconds the game was played. Older libraries count from the launch history they still hold. */
export const playtime = (
  game: Game,
  launches: readonly Pick<Launch, "gameId" | "startedAt" | "endedAt" | "outcome">[],
) =>
  game.playtime ??
  launches
    .filter((launch) => launch.gameId === game.id)
    .reduce((total, launch) => total + launchSeconds(launch), 0);

export const sortOrders = {
  name: "Name",
  plays: "Times played",
  lastPlayed: "Last played",
  added: "Date added",
} as const;
export type SortOrder = keyof typeof sortOrders;
/** How each order reads by default and reversed. */
export const sortDirections: Record<SortOrder, [string, string]> = {
  name: ["A–Z", "Z–A"],
  plays: ["Most first", "Fewest first"],
  lastPlayed: ["Newest first", "Oldest first"],
  added: ["Newest first", "Oldest first"],
};
export type Sort = { order: SortOrder; reversed: boolean };
export const defaultSort: Sort = { order: "name", reversed: false };
/**
 * Favorites first, then by the chosen order: A–Z, most played, most recently played, or newest
 * first, unless reversed. Never-played games stay last under Last played either way, and ties
 * fall back to the name.
 */
export function sortGames(
  games: readonly Game[],
  { order, reversed }: Sort,
  launches: readonly Pick<Launch, "gameId">[],
): Game[] {
  const key = (game: Game) => {
    switch (order) {
      case "name":
        return 0;
      case "plays":
        return playCount(game, launches);
      case "lastPlayed":
        return game.lastPlayed ? Date.parse(game.lastPlayed) : null;
      case "added":
        return Date.parse(game.addedAt);
    }
  };
  const keys = new Map(games.map((game) => [game.id, key(game)]));
  const direction = reversed ? -1 : 1;
  return [...games].sort((a, b) => {
    const left = keys.get(a.id)!;
    const right = keys.get(b.id)!;
    const name = a.name.localeCompare(b.name);
    return (
      Number(!!b.favorite) - Number(!!a.favorite) ||
      Number(left === null) - Number(right === null) ||
      (left === null || right === null ? 0 : (right - left) * direction) ||
      (order === "name" ? name * direction : name)
    );
  });
}

export const kindFilters = {
  nwjs: "NW.js",
  rgss: "RPG Maker XP–VX Ace",
  renpy: "Ren'Py",
  windows: "Windows",
  mac: "Mac",
} as const;
export const statusFilters = {
  favorite: "Favorites",
  running: "Running",
  recent: "Played in the last 2 weeks",
  unplayed: "Never played",
  missing: "Missing files",
  update: "Update available",
} as const;
export type GameKind = keyof typeof kindFilters;
export type GameStatus = keyof typeof statusFilters;
/**
 * Library filters. A game must carry every chosen tag and match every chosen status. Types
 * match any one, since a game has only one.
 */
export type Filters = {
  tags: string[];
  /** Games with any of these tags are hidden. */
  excludedTags: string[];
  kinds: GameKind[];
  statuses: GameStatus[];
};
export const noFilters: Filters = { tags: [], excludedTags: [], kinds: [], statuses: [] };
/** Type and status filters, which the filter button counts; tags have their own button. */
export const filterCount = (filters: Filters) => filters.kinds.length + filters.statuses.length;

const tagSearch = /(?:^|\s)tag:(?:"([^"]*)"?|(\S*))/gi;
/** Splits search text into `tag:name` or `tag:"two words"` terms and the words left for the name. */
export function parseSearch(text: string): { name: string; tags: string[] } {
  const tags: string[] = [];
  const name = text.replace(tagSearch, (_, quoted?: string, bare?: string) => {
    tags.push(...normalizeTags(quoted ?? bare ?? ""));
    return " ";
  });
  return { name: name.trim().replace(/\s+/g, " ").toLocaleLowerCase(), tags };
}

export function matchesGame(
  game: Game,
  filters: Filters,
  search: string,
  state: Pick<Snapshot, "running" | "missing">,
  now = Date.now(),
): boolean {
  const query = parseSearch(search);
  if (query.name && !game.name.toLocaleLowerCase().includes(query.name)) return false;
  // Search terms may be partial while typing, so they match the start of a tag.
  if (!query.tags.every((term) => game.tags.some((tag) => tag.startsWith(term)))) return false;
  if (!filters.tags.every((tag) => game.tags.includes(tag))) return false;
  if (filters.excludedTags.some((tag) => game.tags.includes(tag))) return false;
  if (filters.kinds.length && !filters.kinds.includes(gameKind(game))) return false;
  return filters.statuses.every((status) => {
    switch (status) {
      case "favorite":
        return !!game.favorite;
      case "running":
        return state.running.includes(game.id);
      case "missing":
        return state.missing.includes(game.id);
      case "update":
        return updateAvailable(game);
      case "unplayed":
        return !game.lastPlayed;
      case "recent":
        return !!game.lastPlayed && now - Date.parse(game.lastPlayed) < 14 * 86_400_000;
    }
  });
}

export function compareVersions(left: string, right: string): number {
  const a = left.replace(/^v/, "").split(".").map(Number);
  const b = right.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

/** Arguments passed to a Windows game, one per line. CrossOver quotes each one. */
export function parseArguments(input: string): string[] {
  const values = input
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (values.some((value) => value.includes("\0") || value.length > 1000))
    throw new Error("Each argument must be one line of at most 1000 characters.");
  return values;
}

/** Engines with launch switches Aperto offers as controls. NW.js games are known by their kind. */
export type Engine = "unity";

/**
 * A launch setting backed by lines of the flags text, so the control and the text always agree.
 * The first choice adds no lines and leaves the setting to the game.
 */
export type LaunchOption = {
  id: string;
  label: string;
  hint: string;
  control: "select" | "switch";
  /** Switches the option owns. With `takesValue`, each is followed by its value on the next line. */
  switches: readonly string[];
  takesValue?: boolean;
  choices: readonly { label: string; lines: readonly string[] }[];
};

const unityDisplay: LaunchOption = {
  id: "unity-display",
  label: "Display",
  hint: "Unity games remember the last mode they ran in. This overrides it at launch.",
  control: "select",
  switches: ["-screen-fullscreen"],
  takesValue: true,
  choices: [
    { label: "Game's setting", lines: [] },
    { label: "Fullscreen", lines: ["-screen-fullscreen", "1"] },
    { label: "Windowed", lines: ["-screen-fullscreen", "0"] },
  ],
};

const unityGraphics: LaunchOption = {
  id: "unity-graphics",
  label: "Graphics API",
  hint: "Try another one if the game crashes at start or shows a black screen.",
  control: "select",
  switches: ["-force-d3d11", "-force-d3d12", "-force-vulkan", "-force-glcore"],
  choices: [
    { label: "Game's default", lines: [] },
    { label: "Direct3D 11", lines: ["-force-d3d11"] },
    { label: "Direct3D 12", lines: ["-force-d3d12"] },
    { label: "Vulkan", lines: ["-force-vulkan"] },
    { label: "OpenGL", lines: ["-force-glcore"] },
  ],
};

const nwjsSoftware: LaunchOption = {
  id: "nwjs-software",
  label: "Software rendering",
  hint: "Draws without the GPU. Slower, but can fix a black or flickering screen.",
  control: "switch",
  switches: ["--disable-gpu"],
  choices: [
    { label: "Off", lines: [] },
    { label: "On", lines: ["--disable-gpu"] },
  ],
};

/** The launch settings Aperto knows for a game, given its engine. */
export function launchOptions(game: Pick<Game, "kind">, engine: Engine | null): LaunchOption[] {
  const kind = gameKind(game);
  if (kind === "nwjs") return [nwjsSoftware];
  if (engine !== "unity") return [];
  // The graphics switches name Windows APIs; Mac builds only take the display one.
  return kind === "windows" ? [unityDisplay, unityGraphics] : [unityDisplay];
}

/** Indexes of the lines that belong to `option`, including malformed ones like "-switch value". */
function ownedLines(option: LaunchOption, lines: readonly string[]) {
  const owned = new Set<number>();
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.trim();
    if (option.switches.includes(line)) {
      owned.add(index);
      const value = lines[index + 1]?.trim();
      if (option.takesValue && value && !value.startsWith("-")) owned.add(++index);
    } else if (
      option.switches.some((name) => line.startsWith(`${name} `) || line.startsWith(`${name}=`))
    ) {
      owned.add(index);
    }
  }
  return owned;
}

/** The choice the flags text makes for `option`, or null when its lines match none of them. */
export function chosenOption(option: LaunchOption, text: string): number | null {
  const lines = text.split("\n");
  const owned = [...ownedLines(option, lines)].map((index) => lines[index]!.trim());
  const index = option.choices.findIndex(
    (choice) =>
      choice.lines.length === owned.length && choice.lines.every((line, at) => line === owned[at]),
  );
  return index === -1 ? null : index;
}

/** The flags text with `option` set to `choice`: its old lines go, the new ones are appended. */
export function chooseOption(option: LaunchOption, text: string, choice: number): string {
  const lines = text.split("\n");
  const owned = ownedLines(option, lines);
  const kept = lines.filter((_, index) => !owned.has(index));
  while (kept.length && !kept.at(-1)!.trim()) kept.pop();
  return [...kept, ...option.choices[choice]!.lines].join("\n");
}

export function parseFlags(input: string): string[] {
  const flags = input
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const keys = new Set<string>();
  for (const flag of flags) {
    if (!/^--[a-z][a-z0-9-]*(?:=[^\r\n\0]*)?$/.test(flag)) {
      throw new Error("Use one switch per line, such as --disable-gpu or --use-angle=metal.");
    }
    const key = flag.split("=")[0]!;
    if (
      [
        "--user-data-dir",
        "--nwapp",
        "--url",
        "--remote-debugging-port",
        "--remote-debugging-pipe",
      ].includes(key)
    ) {
      throw new Error(`${key} is controlled by Aperto.`);
    }
    if (keys.has(key)) throw new Error(`Specify ${key} only once.`);
    keys.add(key);
  }
  return flags;
}
