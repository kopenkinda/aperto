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

async function searchF95(query: string): Promise<MetadataMatch[]> {
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
    cover: thread.cover || null,
    // Search results link a 400-pixel preview; the same path on the attachments host is the
    // full image, often AVIF, which Aperto converts like other artwork.
    banner: thread.cover?.startsWith("https://preview.f95zone.to/")
      ? thread.cover.replace("https://preview.f95zone.to/", "https://attachments.f95zone.to/")
      : null,
    url: `https://f95zone.to/threads/${thread.thread_id}/`,
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
      cover: item.tiny_image ?? null,
      banner: null,
      url: `https://store.steampowered.com/app/${item.id}/`,
    }));
}

/** Games on F95zone and Steam whose titles match the query, F95zone first. */
export async function searchMetadata(query: string): Promise<MetadataMatch[]> {
  if (!query.trim()) return [];
  const [f95, steam] = await Promise.all([searchF95(query), searchSteam(query)]);
  // A word spelled differently there finds nothing, so the main title alone is tried as well.
  const short = mainTitle(query);
  const more = !f95.length && short !== query ? await searchF95(short) : [];
  return [...f95, ...more, ...steam];
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
 * A game's tags on F95zone or Steam, most relevant first and normalized like library tags, and
 * Steam's wide library banner. F95zone's banner comes with its search result.
 */
export async function metadataDetails(site: MetadataSite, id: string): Promise<MetadataDetails> {
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
