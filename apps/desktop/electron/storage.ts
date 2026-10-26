import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Schema } from "effect";
import { LibrarySchema, type Library } from "../src/model";

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

export class LibraryStore {
  private state: Library = { version: 1, games: [], runtimes: [], launches: [], backups: [] };
  private queue: Promise<unknown> = Promise.resolve();
  readonly file: string;

  constructor(
    readonly directory: string,
    private readonly changed: () => void = () => {},
  ) {
    this.file = path.join(directory, "library.json");
  }

  async load() {
    await mkdir(this.directory, { recursive: true });
    try {
      this.state = Schema.decodeUnknownSync(LibrarySchema)(
        JSON.parse(await readFile(this.file, "utf8")),
      );
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
  }

  get value(): Library {
    return this.state;
  }

  update(change: (current: Library) => Library): Promise<void> {
    const task = this.queue.then(async () => {
      const next = Schema.decodeUnknownSync(LibrarySchema)(change(this.state));
      await atomicWrite(`${this.file}.previous`, JSON.stringify(this.state));
      await atomicWrite(this.file, JSON.stringify(next, null, 2));
      this.state = next;
      this.changed();
    });
    this.queue = task.catch(() => {});
    return task;
  }
}
