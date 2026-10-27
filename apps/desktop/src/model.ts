import { Schema } from "effect";

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
  removed: Schema.Boolean,
  // Windows games run through CrossOver; Mac games are app bundles. Older libraries omit these.
  kind: Schema.optionalKey(Schema.Literals(["nwjs", "windows", "mac", "renpy"])),
  executable: Schema.optionalKey(Schema.NullOr(Schema.String)),
  /** CrossOver bottle for this game; unset uses the library's default bottle. */
  bottle: Schema.optionalKey(Schema.NullOr(Schema.String)),
  /** Runs a Windows game in CrossOver's high resolution (Retina) mode. */
  highResolution: Schema.optionalKey(Schema.Boolean),
  /** Adds Aperto's getPixel fix to an RPG Maker game at launch. Unset means on. */
  pixelFix: Schema.optionalKey(Schema.Boolean),
  /** Runs the game in Aperto's macOS sandbox. Unset means on; only `false` turns it off. */
  sandbox: Schema.optionalKey(Schema.Boolean),
});
export type Game = typeof GameSchema.Type;
export const gameKind = (game: Pick<Game, "kind">) => game.kind ?? "nwjs";
/** Games Aperto starts itself can run in its sandbox; Mac apps open through macOS, Windows games through CrossOver. */
export const sandboxable = (game: Pick<Game, "kind">) =>
  gameKind(game) === "nwjs" || gameKind(game) === "renpy";
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
});
export type Library = typeof LibrarySchema.Type;
export type Snapshot = Library & {
  missing: string[];
  running: string[];
  downloads: { version: string; detail: string }[];
  scanning: boolean;
  lastScan: ScanReport | null;
  /** CrossOver bottles, or null when CrossOver is not installed. */
  bottles: string[] | null;
  /** Supported terminals installed on this Mac, the automatic choice first. */
  terminals: { id: string; name: string }[];
};
export type Candidate = {
  kind: "nwjs" | "windows" | "mac" | "renpy";
  /**
   * The Windows .exe, the Mac .app, or a Ren'Py game's launcher script; null for NW.js games,
   * which launch their root.
   */
  executable: string | null;
  folder: string;
  root: string;
  name: string;
  /** NW.js or RPG Maker files corroborate the manifest, or the entry is an HTML page. */
  confirmed: boolean;
  artwork: string | null;
};
export type ScanReport = {
  folder: string;
  finishedAt: string;
  /** Started by the user rather than on launch or focus. */
  requested: boolean;
  added: string[];
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
  Schema.Struct({ action: Schema.Literal("installRuntime"), version: Schema.String }),
  Schema.Struct({ action: Schema.Literal("cancelDownload"), version: Schema.String }),
  Schema.Struct({ action: Schema.Literal("removeRuntime"), version: Schema.String }),
  Schema.Struct({ action: Schema.Literal("launch"), ...id }),
  Schema.Struct({ action: Schema.Literal("stop"), ...id }),
  Schema.Struct({ action: Schema.Literal("reveal"), ...id }),
  Schema.Struct({ action: Schema.Literal("openTerminal"), ...id }),
  Schema.Struct({ action: Schema.Literal("revealPluginBackup"), ...id }),
]);
export type Command = typeof CommandSchema.Type;
export type ResultFor<C extends Command> = C["action"] extends "plugins"
  ? PluginList | null
  : C["action"] extends "togglePlugin" | "restorePlugins" | "setCheatMenu"
    ? PluginList
    : C["action"] extends "setPixelFix"
      ? PluginList | null
      : C["action"] extends "releases"
        ? Release[]
        : C["action"] extends "folderToTrash"
          ? string
          : C["action"] extends "engine"
            ? Engine | null
            : Snapshot;
export interface DesktopApi {
  request<C extends Command>(command: C): Promise<ResultFor<C>>;
  onChange(listener: () => void): () => void;
}

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
} as const;
export type GameKind = keyof typeof kindFilters;
export type GameStatus = keyof typeof statusFilters;
/**
 * Library filters. A game must carry every chosen tag and match every chosen status. Types
 * match any one, since a game has only one.
 */
export type Filters = { tags: string[]; kinds: GameKind[]; statuses: GameStatus[] };
export const noFilters: Filters = { tags: [], kinds: [], statuses: [] };
export const filterCount = (filters: Filters) =>
  filters.tags.length + filters.kinds.length + filters.statuses.length;

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
  if (filters.kinds.length && !filters.kinds.includes(gameKind(game))) return false;
  return filters.statuses.every((status) => {
    switch (status) {
      case "favorite":
        return !!game.favorite;
      case "running":
        return state.running.includes(game.id);
      case "missing":
        return state.missing.includes(game.id);
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
