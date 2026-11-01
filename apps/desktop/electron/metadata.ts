import {
  mainTitle,
  normalizeTags,
  type MetadataDetails,
  type MetadataMatch,
  type MetadataSite,
} from "../src/model";

// F95zone answers searches and shows threads without an account; a browser-like user agent avoids
// its bot page. Steam's store APIs are public too.
const headers = { "User-Agent": "Mozilla/5.0 (Macintosh; Apple Silicon Mac OS X) Aperto" };

async function json(url: string) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) }).catch(
    () => null,
  );
  if (!response?.ok) return null;
  return response.json().catch(() => null) as Promise<unknown>;
}

const decode = (text: string) =>
  text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

// F95zone's search is a full-text search: a word shorter than three letters, a stopword, or
// punctuation makes it give up and list its most popular games instead. Its MySQL stopwords:
const stopwords = new Set(
  "a about an are as at be by com de en for from how i in is it la of on or that the this to was what when where who will with und www".split(
    " ",
  ),
);
const f95Query = (query: string) => {
  const words = query
    .replace(/['’]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 3 && !stopwords.has(word.toLowerCase()));
  return words.slice(0, 5).join(" ");
};

async function queryF95(query: string): Promise<MetadataMatch[]> {
  if (!f95Query(query)) return [];
  const url = new URL("https://f95zone.to/sam/latest_alpha/latest_data.php");
  url.search = new URLSearchParams({
    cmd: "list",
    cat: "games",
    page: "1",
    search: f95Query(query),
    sort: "likes",
    rows: "8",
  }).toString();
  const body = (await json(url.href)) as {
    status?: string;
    msg?: {
      data?: {
        thread_id: number;
        title: string;
        creator?: string;
        version?: string;
        cover?: string;
      }[];
      pagination?: { total?: number };
    };
  } | null;
  // Hundreds of pages means F95zone ignored the query and listed popular games.
  if (body?.status !== "ok" || (body.msg?.pagination?.total ?? 0) > 20) return [];
  return (body.msg?.data ?? []).map((thread) => ({
    site: "f95",
    id: String(thread.thread_id),
    title: decode(thread.title),
    detail: [thread.creator, thread.version]
      .filter(Boolean)
      .map((item) => decode(item!))
      .join(" · "),
    version: thread.version ? decode(thread.version) : null,
    cover: thread.cover || null,
    // Search results link a 400-pixel preview; the same path on the attachments host is the
    // full image, often AVIF, which Aperto converts like other artwork.
    banner: thread.cover?.startsWith("https://preview.f95zone.to/")
      ? thread.cover.replace("https://preview.f95zone.to/", "https://attachments.f95zone.to/")
      : null,
  }));
}

async function searchSteam(query: string): Promise<MetadataMatch[]> {
  const url = new URL("https://store.steampowered.com/api/storesearch/");
  url.search = new URLSearchParams({ term: query, l: "english", cc: "US" }).toString();
  const body = (await json(url.href)) as {
    items?: { type: string; id: number; name: string; tiny_image?: string }[];
  } | null;
  return (body?.items ?? [])
    .filter((item) => item.type === "app")
    .slice(0, 5)
    .map((item) => ({
      site: "steam",
      id: String(item.id),
      title: item.name,
      detail: "Steam",
      version: null,
      cover: item.tiny_image ?? null,
      banner: null,
    }));
}

/** A game page's address without the scheme, which is how links to itch.io keep a game. */
export const itchPage = /^[a-z0-9-]+\.itch\.io\/[a-z0-9_-]+$/i;

/** itch.io's search, read from its results page; it lists adult games without an account. */
async function searchItch(query: string): Promise<MetadataMatch[]> {
  const url = new URL("https://itch.io/search");
  url.searchParams.set("q", query);
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) }).catch(
    () => null,
  );
  if (!response?.ok) return [];
  const page = await response.text();
  return page
    .split(/<div class="game_cell\b/)
    .slice(1)
    .flatMap((cell) => {
      const title =
        /<a[^>]*class="title game_link"[^>]*href="https:\/\/([^"]+)"[^>]*>([^<]+)/.exec(cell) ??
        /<a[^>]*href="https:\/\/([^"]+)"[^>]*class="title game_link"[^>]*>([^<]+)/.exec(cell);
      if (!title || !itchPage.test(title[1]!)) return [];
      const author = /<div class="game_author"><a[^>]*>([^<]+)/.exec(cell)?.[1];
      return [
        {
          site: "itch" as const,
          id: title[1]!,
          title: decode(title[2]!.trim()),
          detail: author ? decode(author) : "",
          version: null,
          cover: /data-lazy_src="([^"]+)"/.exec(cell)?.[1] ?? null,
          banner: null,
        },
      ];
    })
    .slice(0, 6);
}

/**
 * F95zone threads matching a query. A word spelled differently there finds nothing, so the main
 * title alone is tried when the whole query finds nothing.
 */
export async function searchF95(query: string): Promise<MetadataMatch[]> {
  const found = await queryF95(query);
  const short = mainTitle(query);
  return found.length || short === query ? found : queryF95(short);
}

/** One F95zone thread, found again by searching its title; null when the search misses it. */
export async function findF95Thread(id: string, title: string) {
  const threads = await queryF95(title);
  return (
    threads.find((thread) => thread.id === id) ??
    (await queryF95(mainTitle(title))).find((thread) => thread.id === id) ??
    null
  );
}

const searches: Record<MetadataSite, (query: string) => Promise<MetadataMatch[]>> = {
  f95: searchF95,
  steam: searchSteam,
  itch: searchItch,
};

/** Games on F95zone, Steam, and itch.io, or only `site`, whose titles match the query, in that order. */
export async function searchMetadata(query: string, site?: MetadataSite): Promise<MetadataMatch[]> {
  if (!query.trim()) return [];
  const sites = site ? [site] : (Object.keys(searches) as MetadataSite[]);
  return (await Promise.all(sites.map((item) => searches[item](query)))).flat();
}

let steamTagNames: Promise<Map<number, string>> | null = null;
function steamTags() {
  steamTagNames ??= json(
    "https://api.steampowered.com/IStoreService/GetTagList/v1/?language=english",
  )
    .then((body) => {
      const tags = (body as { response?: { tags?: { tagid: number; name: string }[] } } | null)
        ?.response?.tags;
      if (!tags) throw new Error("Steam's tag list could not be read.");
      return new Map(tags.map((tag) => [tag.tagid, tag.name]));
    })
    .catch((error: unknown) => {
      steamTagNames = null;
      throw error;
    });
  return steamTagNames;
}

/**
 * A game's tags on F95zone, Steam, or itch.io, most relevant first and normalized like library
 * tags, and a wide banner from Steam or itch.io. F95zone's banner comes with its search result.
 */
export async function metadataDetails(site: MetadataSite, id: string): Promise<MetadataDetails> {
  if (site === "itch") return itchDetails(id);
  if (!/^\d+$/.test(id)) throw new Error("Invalid game reference.");
  if (site === "f95") {
    const response = await fetch(`https://f95zone.to/threads/${id}/`, {
      headers,
      signal: AbortSignal.timeout(20_000),
    }).catch(() => null);
    if (!response?.ok) throw new Error("F95zone could not be reached. Try again.");
    const page = await response.text();
    const tags = [
      ...page.matchAll(
        /<a href="\/tags\/[^"]+"[^>]*class="tagItem[^"]*"[^>]*>\s*([^<]+?)\s*<\/a>/g,
      ),
    ];
    return { tags: normalizeTags(tags.map((match) => decode(match[1]!))), banner: null };
  }
  const url = new URL("https://api.steampowered.com/IStoreBrowseService/GetItems/v1/");
  url.searchParams.set(
    "input_json",
    JSON.stringify({
      ids: [{ appid: Number(id) }],
      context: { language: "english", country_code: "US" },
      data_request: { include_tag_count: 20, include_assets: true },
    }),
  );
  const body = (await json(url.href)) as {
    response?: {
      store_items?: {
        tags?: { tagid: number; weight: number }[];
        assets?: Record<string, string>;
      }[];
    };
  } | null;
  const item = body?.response?.store_items?.[0];
  if (!item) throw new Error("Steam could not be reached. Try again.");
  const names = await steamTags();
  const assets = item.assets ?? {};
  const hero = assets.library_hero_2x ?? assets.library_hero ?? assets.header;
  return {
    tags: normalizeTags(
      [...(item.tags ?? [])]
        .sort((a, b) => b.weight - a.weight)
        .map((tag) => names.get(tag.tagid))
        .filter((name): name is string => !!name),
    ),
    banner:
      hero && assets.asset_url_format
        ? `https://shared.akamai.steamstatic.com/store_item_assets/${assets.asset_url_format.replace("${FILENAME}", hero)}`
        : null,
  };
}

/**
 * A game's genre and tags from its itch.io page, and a banner: its first screenshot, which is
 * usually wide, or else the page's header image, often only a title, or else its cover.
 */
async function itchDetails(id: string): Promise<MetadataDetails> {
  if (!itchPage.test(id)) throw new Error("Invalid game reference.");
  const response = await fetch(`https://${id}`, {
    headers,
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!response?.ok) throw new Error("itch.io could not be reached. Try again.");
  const page = await response.text();
  const tags = [
    ...page.matchAll(/<a href="https:\/\/itch\.io\/games\/(?:genre|tag)-[^"]+">([^<]+)<\/a>/g),
  ]
    .map((match) => decode(match[1]!))
    // itch.io lists its AI disclosure among the tags.
    .filter((tag) => !/generative AI/i.test(tag));
  const banner =
    /screenshot_list"><a href="([^"]+)"/.exec(page)?.[1] ??
    /id="header"[^>]*>\s*(?:<a[^>]*>\s*)?<img[^>]*src="([^"]+)"/.exec(page)?.[1] ??
    /og:image" content="([^"]+)"/.exec(page)?.[1] ??
    null;
  return { tags: normalizeTags(tags), banner };
}
