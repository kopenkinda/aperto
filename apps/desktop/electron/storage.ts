import { createHash, randomUUID } from "node:crypto";
import { watch } from "node:fs";
import { copyFile, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { Schema } from "effect";
import { gameKind, LibrarySchema, migrateLibrary, type Game, type Library } from "../src/model";

export const digest = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
export const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
export const exists = async (file: string) =>
  stat(file).then(
    () => true,
    () => false,
  );

export async function atomicWrite(
  file: string,
  data: string | Buffer,
  mode = 0o600,
  beforeRename?: () => Promise<void>,
) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, "wx", mode);
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await beforeRename?.();
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

export function ownedPath(base: string, category: string, id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid game identity.");
  return path.join(base, category, id);
}

/** The folders apps are installed in, where games are found by their App Store category. */
export const applicationFolders = ["/Applications", path.join(homedir(), "Applications")];

/**
 * Where the copy of custom artwork lives: `.aperto` inside the game's folder. A Mac game's folder
 * is its app bundle, and writing inside would break its signature, so its copy sits next to the
 * bundle instead.
 */
export function artworkCopy(game: Game, slot: "icon" | "banner", dataDirectory: string) {
  const mac = gameKind(game) === "mac";
  // Apps installed in an Applications folder, or a folder inside one, keep their copies in
  // Aperto's data instead.
  const parent = path.dirname(game.folder);
  if (mac && [parent, path.dirname(parent)].some((folder) => applicationFolders.includes(folder)))
    return { directory: ownedPath(dataDirectory, "artwork", game.id), name: slot };
  return {
    directory: path.join(mac ? path.dirname(game.folder) : game.folder, ".aperto"),
    name: mac ? `${path.basename(game.folder, path.extname(game.folder))}-${slot}` : slot,
  };
}

/** The address scheme for game images kept as files, which the main process serves. */
export const imageScheme = "aperto-image";
const inlineImage = /^data:image\/(png|jpeg|webp);base64,/;
const imageAddress = /^\/(icon|banner)\.(png|jpg|webp)$/;
const slots = ["icon", "banner"] as const;
const slotImage = (game: Game, slot: (typeof slots)[number]) =>
  (slot === "icon" ? game.artwork : game.banner) ?? null;

/**
 * Keeps the library small. Icons and banners arrive as data URLs; each is written beside the
 * game's custom artwork copy, as `icon-display.png` or `banner-display.png`, and the library holds
 * its `aperto-image://<game>/<slot>.<extension>?v=<hash>` address instead. Inline, a library of
 * banners ran to a hundred megabytes, rewritten and sent to the window on every change.
 */
export class LibraryStore {
  private state: Library = { version: 1, games: [], runtimes: [], launches: [], backups: [] };
  private queue: Promise<unknown> = Promise.resolve();
  readonly file: string;
  // What Aperto last read or wrote, so its own writes are not mistaken for outside edits.
  private written: string | null = null;

  constructor(
    readonly directory: string,
    private readonly changed: () => void = () => {},
  ) {
    this.file = path.join(directory, "library.json");
  }

  async load() {
    await mkdir(this.directory, { recursive: true });
    try {
      const text = await readFile(this.file, "utf8");
      this.state = Schema.decodeUnknownSync(LibrarySchema)(migrateLibrary(JSON.parse(text)));
      this.written = text;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error(
          `The library could not be read. It has not been replaced. Your recovery copy is ${this.file}.previous. ${message(error)}`,
        );
      }
    }
    if (this.state.launches.some((launch) => launch.outcome === "running")) {
      await this.update((state) => ({
        ...state,
        launches: state.launches.map((launch) =>
          launch.outcome === "running"
            ? {
                ...launch,
                outcome: "interrupted" as const,
                endedAt: new Date().toISOString(),
                detail: "Aperto closed before it observed this session ending.",
              }
            : launch,
        ),
      }));
    }
    // Libraries from before image files hold every image inline; saving moves them out.
    if (
      this.state.games.some((game) =>
        slots.some((slot) => inlineImage.test(slotImage(game, slot) ?? "")),
      )
    )
      await this.update((state) => state);
  }

  /** The file behind an image address, for the game it names, or null for any other address. */
  imageFile(url: string, game?: Game): string | null {
    const { protocol, host, pathname } = new URL(url);
    const match = imageAddress.exec(pathname);
    game ??= this.state.games.find((item) => item.id === host);
    if (protocol !== `${imageScheme}:` || !match || game?.id !== host) return null;
    const { directory, name } = artworkCopy(game, match[1] as "icon" | "banner", this.directory);
    return path.join(directory, `${name}-display.${match[2]}`);
  }

  /**
   * Writes the next library's inline images to files, removes the files of images it no longer
   * shows, and moves those of a game whose folder changed. An image that cannot be written, as on
   * a read-only drive, stays inline.
   */
  private async storeImages(previous: Library, next: Library): Promise<Library> {
    const before = new Map(previous.games.map((game) => [game.id, game]));
    const games = await Promise.all(
      next.games.map(async (game) => {
        let current = game;
        for (const slot of slots) {
          const old = before.get(game.id);
          const was = old && slotImage(old, slot);
          const from = was?.startsWith(`${imageScheme}:`) ? this.imageFile(was, old) : null;
          const image = slotImage(game, slot);
          const inline = image && inlineImage.exec(image);
          if (inline) {
            const data = Buffer.from(image.slice(inline[0].length), "base64");
            const extension = inline[1] === "jpeg" ? "jpg" : inline[1]!;
            const address = `${imageScheme}://${game.id}/${slot}.${extension}?v=${digest(data).slice(0, 16)}`;
            const file = this.imageFile(address, game)!;
            try {
              await atomicWrite(file, data, 0o644);
            } catch {
              continue;
            }
            if (from && from !== file) await rm(from, { force: true });
            current =
              slot === "icon" ? { ...current, artwork: address } : { ...current, banner: address };
          } else if (from && image && image === was) {
            const file = this.imageFile(image, game);
            if (file && file !== from)
              await mkdir(path.dirname(file), { recursive: true })
                .then(() => copyFile(from, file))
                .then(() => rm(from, { force: true }))
                .catch(() => {});
          } else if (from) await rm(from, { force: true });
        }
        return current;
      }),
    );
    return { ...next, games };
  }

  /**
   * Takes up edits made to library.json outside Aperto, such as a coding agent changing a game's
   * launch arguments. A file that is not a valid library, as in the middle of an edit, is ignored
   * until it is.
   */
  async reloadIfEdited() {
    const task = this.queue.then(async () => {
      const text = await readFile(this.file, "utf8").catch(() => null);
      if (text === null || text === this.written) return false;
      try {
        this.state = Schema.decodeUnknownSync(LibrarySchema)(migrateLibrary(JSON.parse(text)));
      } catch {
        return false;
      }
      this.written = text;
      this.changed();
      return true;
    });
    this.queue = task.catch(() => {});
    return task;
  }

  /** Reloads library.json when it changes outside Aperto. Returns a function that stops watching. */
  watch() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const watcher = watch(this.directory, (_, name) => {
      if (name !== "library.json") return;
      clearTimeout(timer);
      timer = setTimeout(() => void this.reloadIfEdited(), 300);
    });
    return () => {
      clearTimeout(timer);
      watcher.close();
    };
  }

  get value(): Library {
    return this.state;
  }

  update(change: (current: Library) => Library): Promise<void> {
    const task = this.queue.then(async () => {
      const next = await this.storeImages(
        this.state,
        Schema.decodeUnknownSync(LibrarySchema)(change(this.state)),
      );
      await atomicWrite(`${this.file}.previous`, JSON.stringify(this.state));
      const text = JSON.stringify(next, null, 2);
      this.written = text;
      await atomicWrite(this.file, text);
      this.state = next;
      this.changed();
    });
    this.queue = task.catch(() => {});
    return task;
  }
}
