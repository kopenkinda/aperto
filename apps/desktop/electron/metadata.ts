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

/** A game's slug in GOG's store addresses, which is how links to GOG keep a game. */
export const gogSlug = /^[a-z0-9_]+$/;

type GogProduct = {
  id: string;
  slug: string;
  title: string;
  productType?: string;
  developers?: string[];
  coverHorizontal?: string | null;
  genres?: { name: string }[];
  tags?: { name: string }[];
};

/** Games, packs, and DLC in GOG's public catalog whose titles match a query, best match first. */
async function gogCatalog(query: string): Promise<GogProduct[]> {
  const url = new URL("https://catalog.gog.com/v1/catalog");
  url.searchParams.set("limit", "12");
  url.searchParams.set("query", `like:${query}`);
  url.searchParams.set("productType", "in:game,pack,dlc");
  url.searchParams.set("locale", "en-US");
  const body = (await json(url.toString())) as { products?: GogProduct[] } | null;
  return (body?.products ?? []).filter((product) => gogSlug.test(product.slug));
}

async function searchGog(query: string): Promise<MetadataMatch[]> {
  return (await gogCatalog(query))
    .filter((product) => product.productType !== "dlc")
    .slice(0, 6)
    .map((product) => ({
      site: "gog" as const,
      id: product.slug,
      title: product.title,
      detail: product.developers?.join(", ") ?? "",
      version: null,
      cover: product.coverHorizontal ?? null,
      banner: null,
    }));
}

/**
 * A GOG game's genres and tags and its wide background. The catalog, which has all of a game's
 * tags, cannot find one by slug, and an old slug can outlive its title, so the store page gives
 * the game's id and title to search the catalog with; its own five tags are the fallback.
 */
async function gogDetails(slug: string): Promise<MetadataDetails> {
  if (!gogSlug.test(slug)) throw new Error("Invalid game reference.");
  const response = await fetch(`https://www.gog.com/en/game/${slug}`, {
    headers,
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!response?.ok) throw new Error("GOG could not be reached. Try again.");
  const page = await response.text();
  const pageTags = [
    ...page.matchAll(
      /class="details__link details__link--tag"><span class="details__link-text">([^<]+)</g,
    ),
  ].map((match) => decode(match[1]!.trim()));
  const id = /card-product="(\d+)"/.exec(page)?.[1];
  const product = id
    ? ((await json(`https://api.gog.com/v2/games/${id}?locale=en-US`)) as {
        _links?: Record<string, { href?: string } | undefined>;
        _embedded?: { product?: { title?: string } };
      } | null)
    : null;
  const title = product?._embedded?.product?.title;
  const listed = title ? (await gogCatalog(title)).find((item) => item.id === id) : undefined;
  const tags = [...(listed?.genres ?? []), ...(listed?.tags ?? [])].map((tag) => tag.name);
  return {
    tags: normalizeTags(tags.length ? tags : pageTags),
    banner:
      product?._links?.galaxyBackgroundImage?.href ??
      product?._links?.backgroundImage?.href ??
      /<meta property="og:image" content="([^"]+)"/.exec(page)?.[1] ??
      null,
  };
}

/** A DLsite work number: RJ for doujin works, VJ for commercial ones, BJ for books. */
export const dlsiteWork = /^[RVB]J\d{6,8}$/;
/** The part of DLsite a work number belongs to, which its API and pages are under. */
export const dlsiteFloor = (work: string) =>
  work.startsWith("VJ") ? "pro" : work.startsWith("BJ") ? "books" : "maniax";

export type DlsiteProduct = {
  workno: string;
  /** Three letters for the kind of work: RPG, ACN, and the like for games, MNG for manga. */
  work_type?: string;
  /** How the work is delivered: EXE for Windows programs, HTI or HTE for browser games. */
  file_type?: string;
  work_name?: string;
  maker_name?: string;
  genres?: { name?: string }[];
  image_main?: { url?: string };
};

/** One DLsite work's details in English where DLsite has them; null when it is not found. */
export async function dlsiteProduct(work: string): Promise<DlsiteProduct | null> {
  if (!dlsiteWork.test(work)) return null;
  const body = await json(
    `https://www.dlsite.com/${dlsiteFloor(work)}/api/=/product.json?workno=${work}&locale=en_US`,
  );
  return (Array.isArray(body) ? (body[0] as DlsiteProduct | undefined) : undefined) ?? null;
}

/**
 * DLsite's doujin and commercial works matching a query. The store search answers with its
 * results page, from which the work numbers are read, then each work's details.
 */
async function searchDlsite(query: string): Promise<MetadataMatch[]> {
  const keyword = encodeURIComponent(query.trim().replace(/\s+/g, "+")).replace(/%2B/g, "+");
  const pages = await Promise.all(
    ["maniax", "pro"].map((floor) =>
      json(`https://www.dlsite.com/${floor}/fsr/ajax/=/language/jp/keyword/${keyword}/`),
    ),
  );
  const works = [
    ...new Set(
      pages.flatMap((page) => [
        ...String((page as { search_result?: string } | null)?.search_result ?? "").matchAll(
          /data-list_item_product_id="([RVB]J\d{6,8})"/g,
        ),
      ]),
    ),
  ]
    .map((match) => match[1]!)
    .slice(0, 6);
  const products = await Promise.all(works.map((work) => dlsiteProduct(work).catch(() => null)));
  return products.flatMap((product) =>
    product?.work_name
      ? [
          {
            site: "dlsite" as const,
            id: product.workno,
            title: decode(product.work_name),
            detail: product.maker_name ? decode(product.maker_name) : "",
            version: null,
            cover: product.image_main?.url ? `https:${product.image_main.url}` : null,
            banner: null,
          },
        ]
      : [],
  );
}

/** A DLsite work's genres as tags. Its main image is a cover, not a wide banner. */
async function dlsiteDetails(work: string): Promise<MetadataDetails> {
  if (!dlsiteWork.test(work)) throw new Error("Invalid game reference.");
  const product = await dlsiteProduct(work);
  if (!product) throw new Error("DLsite could not be reached or no longer lists this work.");
  return {
    tags: normalizeTags(
      (product.genres ?? []).flatMap((genre) => (genre.name ? [genre.name] : [])),
    ),
    banner: null,
  };
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
  gog: searchGog,
  dlsite: searchDlsite,
  itch: searchItch,
};

/** Games on F95zone, Steam, GOG, DLsite, and itch.io, or only `site`, whose titles match the query, in that order. */
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
  if (site === "gog") return gogDetails(id);
  if (site === "dlsite") return dlsiteDetails(id);
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
