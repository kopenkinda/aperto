import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, open, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { OwnedGame, Platform } from "../src/model";
import { unpack } from "./itch";
import { crossoverWine, wineArgs } from "./windows";

const execute = promisify(execFile);

// GOG Galaxy's public client, which GOG's login page accepts for desktop apps; Heroic and
// lgogdownloader sign in with it too. Its secret is public, as any desktop app's is, and signs in
// no one by itself, so secret scanners are told to skip it.
const client = {
  id: "46899977096215655",
  secret: "9d85c43b1482497dbbce61f6e4aa173a433796eeae2ca8c5f6129f2dc4de46d9", // ggignore
};
/** Where GOG's login page sends the browser after signing in, with the code in the address. */
export const gogRedirect = "https://embed.gog.com/on_login_success?origin=client";
export const gogLoginUrl = `https://auth.gog.com/auth?client_id=${client.id}&redirect_uri=${encodeURIComponent(gogRedirect)}&response_type=code&layout=client2`;

export type GogTokens = { access: string; refresh: string; expiresAt: number };

/** Trades the code from the login page, or a refresh token, for an access token. */
export async function gogToken(grant: { code: string } | { refresh: string }): Promise<GogTokens> {
  const url = new URL("https://auth.gog.com/token");
  url.searchParams.set("client_id", client.id);
  url.searchParams.set("client_secret", client.secret);
  if ("code" in grant) {
    url.searchParams.set("grant_type", "authorization_code");
    url.searchParams.set("code", grant.code);
    url.searchParams.set("redirect_uri", gogRedirect);
  } else {
    url.searchParams.set("grant_type", "refresh_token");
    url.searchParams.set("refresh_token", grant.refresh);
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
  if (!response) throw new Error("GOG could not be reached. Try again.");
  const body = (await response.json().catch(() => null)) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  } | null;
  if (!response.ok || !body?.access_token || !body.refresh_token)
    throw new Error("GOG signed Aperto out. Sign in again in Settings.");
  return {
    access: body.access_token,
    refresh: body.refresh_token,
    // A minute early, so a token never runs out mid-request.
    expiresAt: Date.now() + ((body.expires_in ?? 3600) - 60) * 1000,
  };
}

async function call<T>(token: string, url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!response?.ok) throw new Error("GOG could not be reached. Try again.");
  return (await response.json()) as T;
}

export async function gogProfile(token: string) {
  const user = await call<{ username?: string; galaxyUserId?: string; userId?: string }>(
    token,
    "https://embed.gog.com/userData.json",
  );
  if (!user.username) throw new Error("GOG did not say who is signed in. Try again.");
  return { id: String(user.galaxyUserId ?? user.userId ?? user.username), name: user.username };
}

type Product = {
  id: number;
  title: string;
  image?: string;
  slug?: string;
  url?: string;
  worksOn?: { Windows?: boolean; Mac?: boolean; Linux?: boolean };
};

/** Games the account owns, in GOG's order. Movies are left out by asking for games only. */
export async function gogOwnedGames(token: string): Promise<OwnedGame[]> {
  const games: OwnedGame[] = [];
  for (let page = 1, pages = 1; page <= pages && page <= 100; page++) {
    const body = await call<{ totalPages?: number; products?: Product[] }>(
      token,
      `https://embed.gog.com/account/getFilteredProducts?mediaType=1&sortBy=title&page=${page}`,
    );
    pages = body.totalPages ?? 1;
    for (const product of body.products ?? []) {
      const slug = product.slug ?? product.url?.split("/").pop();
      if (!slug) continue;
      games.push({
        site: "gog",
        id: String(product.id),
        gameId: String(product.id),
        title: product.title,
        page: slug,
        cover: product.image ? `https:${product.image}_196.jpg` : null,
        author: "",
        platforms: [
          ...(product.worksOn?.Mac ? (["mac"] as const) : []),
          ...(product.worksOn?.Windows ? (["windows"] as const) : []),
          ...(product.worksOn?.Linux ? (["linux"] as const) : []),
        ],
      });
    }
  }
  return games;
}

type Installer = { manualUrl: string; name?: string; size?: string; version?: string | null };

/** "1.5 GB" as bytes, for progress across an installer's parts before each one starts. */
export function sizeOf(text = "") {
  const match = /([\d.]+)\s*(B|KB|MB|GB|TB)/i.exec(text);
  if (!match) return 0;
  const powers = { B: 0, KB: 1, MB: 2, GB: 3, TB: 4 } as const;
  return Number(match[1]) * 1024 ** powers[match[2]!.toUpperCase() as keyof typeof powers];
}

/**
 * The installer files to download for a game, in English when GOG has it, else the first
 * language: the Mac installer when there is one, else the Windows one, which runs in CrossOver.
 * Big Windows installers come in parts that must sit side by side.
 */
export async function gogInstaller(
  token: string,
  game: OwnedGame,
  windows: boolean,
): Promise<{ platform: Platform; files: Installer[] }> {
  const details = await call<{
    downloads?: [string, Partial<Record<"mac" | "windows" | "linux", Installer[]>>][];
  }>(token, `https://embed.gog.com/account/gameDetails/${game.id}.json`);
  const languages = details.downloads ?? [];
  const chosen = (languages.find(([language]) => /english/i.test(language)) ?? languages[0])?.[1];
  if (chosen?.mac?.length) return { platform: "mac", files: chosen.mac };
  if (chosen?.windows?.length) {
    if (!windows)
      throw new Error(
        `${game.title} only has a Windows installer on GOG, which needs CrossOver and a default bottle in Settings.`,
      );
    return { platform: "windows", files: chosen.windows };
  }
  throw new Error(`${game.title} has no Mac or Windows installer on GOG.`);
}

/**
 * Downloads one installer file into `folder`, named as GOG's download server names it, reporting
 * the bytes received.
 */
export async function gogDownload(
  token: string,
  installer: Installer,
  folder: string,
  signal: AbortSignal,
  progress: (received: number) => void,
) {
  const response = await fetch(`https://embed.gog.com${installer.manualUrl}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  }).catch((error: unknown) => {
    if (signal.aborted) throw error;
    return null;
  });
  if (!response?.ok || !response.body)
    throw new Error("GOG could not send the installer. Try again.");
  const name =
    decodeURIComponent(path.basename(new URL(response.url).pathname)) ||
    path.basename(installer.manualUrl);
  const file = path.join(folder, path.basename(name));
  const handle = await open(file, "wx", 0o600);
  let received = 0;
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      received += chunk.length;
      await handle.writeFile(chunk);
      progress(received);
    }
  } finally {
    await handle.close();
  }
  return file;
}

/** Mac apps under `folder`, shallowest first, without looking inside an app. */
async function appsIn(folder: string, depth = 0): Promise<string[]> {
  if (depth > 6) return [];
  const found: string[] = [];
  const deeper: string[] = [];
  for (const entry of await readdir(folder, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue;
    const location = path.join(folder, entry.name);
    if (/\.app$/i.test(entry.name)) found.push(location);
    else deeper.push(location);
  }
  for (const location of deeper) found.push(...(await appsIn(location, depth + 1)));
  return found;
}

/**
 * Installs a downloaded GOG game into `destination`. Mac installers are packages, expanded
 * without running them, so nothing needs an administrator and nothing lands in /Applications;
 * the game's app moves in. Windows installers run silently in a CrossOver bottle and install
 * into the folder through the bottle's Z: drive, which is the Mac's whole disk.
 */
export async function gogInstall(
  platform: Platform,
  files: string[],
  destination: string,
  bottle: string | null,
) {
  const first = files[0]!;
  await mkdir(destination, { recursive: true });
  if (platform === "mac") {
    if (!/\.pkg$/i.test(first)) return unpack(first, destination);
    const expanded = await mkdtemp(path.join(path.dirname(first), "pkg-"));
    try {
      await rm(expanded, { recursive: true, force: true });
      await execute("/usr/sbin/pkgutil", ["--expand-full", first, expanded], {
        maxBuffer: 16 * 1024 ** 2,
      });
      const apps = await appsIn(expanded);
      if (!apps.length) throw new Error("The GOG installer held no Mac app.");
      // A game ships as one app; a second is usually a GOG helper beside it.
      for (const app of apps.slice(0, 1))
        await rename(app, path.join(destination, path.basename(app)));
    } finally {
      await rm(expanded, { recursive: true, force: true });
    }
    return;
  }
  if (!bottle) throw new Error("Choose a default CrossOver bottle in Settings first.");
  const setup = files.find((file) => /\.exe$/i.test(file));
  if (!setup) throw new Error("The GOG installer has no setup program.");
  // GOG's installers are Inno Setup, which takes these switches to install without asking.
  const args = [
    setup,
    "/VERYSILENT",
    "/SUPPRESSMSGBOXES",
    "/NORESTART",
    "/SP-",
    "/NOICONS",
    `/DIR=Z:${destination.replace(/\//g, "\\")}`,
  ];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(crossoverWine, wineArgs(bottle, args, "game"), { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`The GOG installer stopped with code ${code} in CrossOver.`)),
    );
  });
}
