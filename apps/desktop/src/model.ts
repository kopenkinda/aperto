import { Schema } from "effect";

export const GameSchema = Schema.Struct({
  id: Schema.String,
  folder: Schema.String,
  root: Schema.String,
  name: Schema.String,
  tags: Schema.Array(Schema.String),
  /** Square icon, shown in the list and the page header. */
  artwork: Schema.NullOr(Schema.String),
  /** Wide image across the page header; without one, the header uses a blur of the icon. */
  banner: Schema.optionalKey(Schema.NullOr(Schema.String)),
  runtime: Schema.NullOr(Schema.String),
  flags: Schema.Array(Schema.String),
  addedAt: Schema.String,
  lastPlayed: Schema.NullOr(Schema.String),
  removed: Schema.Boolean,
  // Windows games run through CrossOver; Mac games are app bundles. Older libraries omit these.
  kind: Schema.optionalKey(Schema.Literals(["nwjs", "windows", "mac"])),
  executable: Schema.optionalKey(Schema.NullOr(Schema.String)),
  /** CrossOver bottle for this game; unset uses the library's default bottle. */
  bottle: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
export type Game = typeof GameSchema.Type;
export const gameKind = (game: Pick<Game, "kind">) => game.kind ?? "nwjs";
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
};
export type Candidate = {
  kind: "nwjs" | "windows" | "mac";
  /** The Windows .exe or the Mac .app; null for NW.js games, which launch their root. */
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
};
export type Release = { version: string; chromium: string; node: string };

const id = { id: Schema.String };
export const CommandSchema = Schema.Union([
  Schema.Struct({ action: Schema.Literal("snapshot") }),
  Schema.Struct({ action: Schema.Literal("addGames") }),
  Schema.Struct({ action: Schema.Literal("chooseGamesFolder") }),
  Schema.Struct({ action: Schema.Literal("clearGamesFolder") }),
  Schema.Struct({ action: Schema.Literal("scan") }),
  Schema.Struct({
    action: Schema.Literal("setDefaultBottle"),
    bottle: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    action: Schema.Literal("update"),
    ...id,
    name: Schema.String,
    tags: Schema.String,
    runtime: Schema.NullOr(Schema.String),
    bottle: Schema.NullOr(Schema.String),
    flags: Schema.String,
  }),
  Schema.Struct({
    action: Schema.Literal("artwork"),
    ...id,
    slot: Schema.Literals(["icon", "banner"]),
  }),
  Schema.Struct({ action: Schema.Literal("clearBanner"), ...id }),
  Schema.Struct({ action: Schema.Literal("remove"), ...id, deleteData: Schema.Boolean }),
  Schema.Struct({ action: Schema.Literal("relink"), ...id }),
  Schema.Struct({ action: Schema.Literal("plugins"), ...id }),
  Schema.Struct({
    action: Schema.Literal("togglePlugin"),
    ...id,
    hash: Schema.String,
    index: Schema.Int,
    enabled: Schema.Boolean,
  }),
  Schema.Struct({ action: Schema.Literal("restorePlugins"), ...id, hash: Schema.String }),
  Schema.Struct({ action: Schema.Literal("releases") }),
  Schema.Struct({ action: Schema.Literal("installRuntime"), version: Schema.String }),
  Schema.Struct({ action: Schema.Literal("cancelDownload"), version: Schema.String }),
  Schema.Struct({ action: Schema.Literal("removeRuntime"), version: Schema.String }),
  Schema.Struct({ action: Schema.Literal("launch"), ...id }),
  Schema.Struct({ action: Schema.Literal("stop"), ...id }),
  Schema.Struct({ action: Schema.Literal("reveal"), ...id }),
  Schema.Struct({ action: Schema.Literal("revealPluginBackup"), ...id }),
]);
export type Command = typeof CommandSchema.Type;
export type ResultFor<C extends Command> = C["action"] extends
  | "plugins"
  | "togglePlugin"
  | "restorePlugins"
  ? PluginList
  : C["action"] extends "releases"
    ? Release[]
    : Snapshot;
export interface DesktopApi {
  request<C extends Command>(command: C): Promise<ResultFor<C>>;
  onChange(listener: () => void): () => void;
}

export function normalizeTags(input: string): string[] {
  return [
    ...new Set(
      input
        .split(",")
        .map((tag) => tag.trim().toLocaleLowerCase())
        .filter(Boolean),
    ),
  ];
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
