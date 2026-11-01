import { execFile } from "node:child_process";
import { mkdir, mkdtemp, open, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { ItchGame, ItchPlatform } from "../src/model";

const execute = promisify(execFile);
const api = "https://api.itch.io";

/**
 * A call to itch.io's API with the user's API key, which itch.io issues on its API keys page and
 * which reads the account's purchases. An invalid key is reported as signed out.
 */
async function call<T>(key: string, pathname: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${api}${pathname}`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: signal ?? AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!response) throw new Error("itch.io could not be reached. Try again.");
  const body = (await response.json().catch(() => null)) as { errors?: string[] } | null;
  if (body?.errors?.includes("invalid key"))
    throw new Error("itch.io did not accept the API key. Sign in again with a new key.");
  if (!response.ok || !body || body.errors)
    throw new Error(body?.errors?.[0] ?? "itch.io could not be reached. Try again.");
  return body as T;
}

export async function itchProfile(key: string) {
  const { user } = await call<{ user: { id: number; username: string; display_name?: string } }>(
    key,
    "/profile",
  );
  return { id: String(user.id), name: user.display_name || user.username };
}

type ApiGame = {
  id: number;
  title: string;
  url: string;
  cover_url?: string | null;
  classification?: string;
  user?: { username: string; display_name?: string };
  traits?: string[];
};

/** A game's platforms, from the traits of newer API answers or the flags of older ones. */
function platforms(item: { traits?: string[] } & Record<string, unknown>): ItchPlatform[] {
  const traits = new Set(item.traits ?? []);
  const has = (name: string) => traits.has(name) || item[name] === true;
  return [
    ...(has("p_osx") ? (["mac"] as const) : []),
    ...(has("p_windows") ? (["windows"] as const) : []),
    ...(has("p_linux") ? (["linux"] as const) : []),
    ...(item.type === "html" ? (["web"] as const) : []),
  ];
}

/** Games the account bought or claimed, newest first. Tools, books, and soundtracks are left out. */
export async function ownedGames(key: string): Promise<ItchGame[]> {
  const games: ItchGame[] = [];
  for (let page = 1; page <= 50; page++) {
    const body = await call<{
      owned_keys?: { id: number; game: ApiGame & Record<string, unknown> }[];
      per_page?: number;
    }>(key, `/profile/owned-keys?page=${page}`);
    const keys = body.owned_keys ?? [];
    for (const owned of keys) {
      const game = owned.game;
      if (game.classification && game.classification !== "game") continue;
      games.push({
        keyId: String(owned.id),
        gameId: String(game.id),
        title: game.title,
        page: game.url.replace(/^https?:\/\//, "").replace(/\/$/, ""),
        cover: game.cover_url ?? null,
        author: game.user?.display_name || game.user?.username || "",
        platforms: platforms(game),
      });
    }
    if (keys.length < (body.per_page ?? 50) || !keys.length) break;
  }
  return games;
}

type Upload = {
  id: number;
  filename: string;
  size?: number;
  type?: string;
  demo?: boolean;
  traits?: string[];
} & Record<string, unknown>;

/**
 * The file to download for a game: a Mac build when there is one, or else a Windows build, which
 * runs in CrossOver, or else a web build, which runs like an NW.js game. Demos, soundtracks, and
 * other extras are skipped.
 */
export async function chooseUpload(key: string, game: ItchGame): Promise<Upload> {
  const { uploads = [] } = await call<{ uploads?: Upload[] }>(
    key,
    `/games/${game.gameId}/uploads?download_key_id=${game.keyId}`,
  );
  const usable = uploads.filter(
    (upload) =>
      !upload.demo &&
      !upload.traits?.includes("demo") &&
      (!upload.type || upload.type === "default" || upload.type === "html"),
  );
  const pick = (platform: ItchPlatform) =>
    usable.find((upload) => platforms(upload).includes(platform));
  const upload = pick("mac") ?? pick("windows") ?? pick("web");
  if (!upload) throw new Error(`${game.title} has no Mac, Windows, or web download on itch.io.`);
  return upload;
}

/** Downloads an upload to `file`, reporting the bytes received. */
export async function downloadUpload(
  key: string,
  game: ItchGame,
  upload: Upload,
  file: string,
  signal: AbortSignal,
  progress: (received: number, total: number | null) => void,
) {
  const response = await fetch(
    `${api}/uploads/${upload.id}/download?download_key_id=${game.keyId}`,
    { headers: { Authorization: `Bearer ${key}` }, signal },
  ).catch((error: unknown) => {
    if (signal.aborted) throw error;
    return null;
  });
  if (!response?.ok || !response.body)
    throw new Error(`${game.title} could not be downloaded from itch.io. Try again.`);
  const total = Number(response.headers.get("content-length")) || upload.size || null;
  const handle = await open(file, "wx", 0o600);
  let received = 0;
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      received += chunk.length;
      await handle.writeFile(chunk);
      progress(received, total);
    }
  } finally {
    await handle.close();
  }
}

/**
 * Unpacks a download into `destination`: zip files with ditto, which keeps Mac apps intact, disk
 * images by copying their contents, and other archives with tar, which reads 7z and RAR too. A
 * file that is not an archive, such as a lone .exe, is moved in as it is.
 */
export async function unpack(file: string, destination: string) {
  await mkdir(destination, { recursive: true });
  const name = path.basename(file).toLowerCase();
  if (name.endsWith(".zip")) {
    await execute("/usr/bin/ditto", ["-x", "-k", file, destination]);
  } else if (name.endsWith(".dmg")) {
    const mount = await mkdtemp(path.join(path.dirname(file), "mount-"));
    await execute("/usr/bin/hdiutil", [
      "attach",
      "-nobrowse",
      "-readonly",
      "-noautoopen",
      "-mountpoint",
      mount,
      file,
    ]);
    try {
      for (const entry of await readdir(mount, { withFileTypes: true })) {
        // Disk images often hold a shortcut to /Applications beside the app.
        if (entry.isSymbolicLink() || entry.name.startsWith(".")) continue;
        await execute("/usr/bin/ditto", [
          path.join(mount, entry.name),
          path.join(destination, entry.name),
        ]);
      }
    } finally {
      await execute("/usr/bin/hdiutil", ["detach", mount, "-force"]).catch(() => {});
      await rm(mount, { recursive: true, force: true });
    }
  } else if (/\.(7z|rar|tar|tgz|tbz2?|txz|tar\.(gz|bz2|xz))$/.test(name)) {
    await execute("/usr/bin/tar", ["-xf", file, "-C", destination]);
  } else {
    await rename(file, path.join(destination, path.basename(file)));
  }
}
