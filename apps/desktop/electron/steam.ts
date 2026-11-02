import { readFile } from "node:fs/promises";
import path from "node:path";
import type { OwnedGame, Platform } from "../src/model";
import { steamValues } from "./windows";

/** Steam's store login, which sends the browser to the account page once signed in. */
export const steamLoginUrl = "https://store.steampowered.com/login/?redir=account%2F";
export const steamRedirect = "https://store.steampowered.com/account";
/** The persistent session the Steam store's sign-in cookies live in. */
export const steamSession = "persist:steam-store";
/** The store's own list of the signed-in account's apps, read with the session's cookies. */
export const steamUserData = "https://store.steampowered.com/dynamicstore/userdata/";

/** The owned app IDs in the store's user data; null when the session is signed out. */
export function ownedAppIds(text: string | null): number[] | null {
  const body = (() => {
    try {
      return JSON.parse(text ?? "") as { rgOwnedApps?: number[]; rgOwnedPackages?: number[] };
    } catch {
      return null;
    }
  })();
  // Signed out, the store answers with empty lists, as no account owns nothing at all.
  if (!body?.rgOwnedApps?.length && !body?.rgOwnedPackages?.length) return null;
  return body.rgOwnedApps ?? [];
}

/** The signed-in account's Steam ID, which starts the store's login cookie. */
export const steamIdFromCookie = (value: string) =>
  /^(\d{17})/.exec(decodeURIComponent(value))?.[1];

/** A Steam profile's public name, or null when the profile cannot be read. */
export async function steamPersona(steamId: string) {
  const response = await fetch(`https://steamcommunity.com/profiles/${steamId}/?xml=1`, {
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  const text = response?.ok ? await response.text() : "";
  return /<steamID><!\[CDATA\[(.*?)\]\]><\/steamID>/.exec(text)?.[1] ?? null;
}

type StoreItem = {
  appid?: number;
  id?: number;
  name?: string;
  type?: number;
  visible?: boolean;
  platforms?: { windows?: boolean; mac?: boolean; steamos_linux?: boolean };
  assets?: { asset_url_format?: string; header?: string; small_capsule?: string };
};

/**
 * Owned apps as games, with names, platforms, and capsule art from Steam's public store API,
 * a hundred at a time. Soundtracks, tools, and other apps that are not games are left out.
 */
export async function steamOwnedGames(appIds: number[]): Promise<OwnedGame[]> {
  const games: OwnedGame[] = [];
  for (let start = 0; start < appIds.length; start += 100) {
    const url = new URL("https://api.steampowered.com/IStoreBrowseService/GetItems/v1/");
    url.searchParams.set(
      "input_json",
      JSON.stringify({
        ids: appIds.slice(start, start + 100).map((appid) => ({ appid })),
        context: { language: "english", country_code: "US" },
        data_request: { include_assets: true, include_platforms: true },
      }),
    );
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
    if (!response?.ok) throw new Error("Steam could not be reached. Try again.");
    const body = (await response.json()) as { response?: { store_items?: StoreItem[] } };
    for (const item of body.response?.store_items ?? []) {
      const id = item.appid ?? item.id;
      // Type 0 is a game; DLC, soundtracks, and software have other types.
      if (!id || !item.name || item.type !== 0) continue;
      const art = item.assets?.small_capsule ?? item.assets?.header;
      games.push({
        site: "steam",
        id: String(id),
        gameId: String(id),
        title: item.name,
        page: String(id),
        cover:
          art && item.assets?.asset_url_format
            ? `https://shared.akamai.steamstatic.com/store_item_assets/${item.assets.asset_url_format.replace("${FILENAME}", art)}`
            : null,
        author: "",
        platforms: [
          ...(item.platforms?.mac ? (["mac"] as Platform[]) : []),
          ...(item.platforms?.windows ? (["windows"] as Platform[]) : []),
          ...(item.platforms?.steamos_linux ? (["linux"] as Platform[]) : []),
        ],
      });
    }
  }
  return games.sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * How far Steam has got installing an app, from its manifest in any of the libraries: null
 * before Steam starts, else whether it is done and the bytes downloaded of the total.
 */
export async function steamInstallState(libraries: readonly string[], appId: string) {
  for (const library of libraries) {
    const text = await readFile(
      path.join(library, "steamapps", `appmanifest_${appId}.acf`),
      "utf8",
    ).catch(() => null);
    if (text === null) continue;
    const values = steamValues(text);
    const number = (key: string) => Number(values.get(key)?.[0] ?? 0) || 0;
    const flags = number("stateflags");
    const total = number("bytestodownload");
    // Flag 4 is fully installed; flag 1024 is an update or download still running.
    return {
      done: (flags & 4) !== 0 && (flags & 1024) === 0,
      received: number("bytesdownloaded"),
      total: total || null,
    };
  }
  return null;
}
