import { titleMatches, type CrossoverRating } from "../src/model";

const site = "https://www.codeweavers.com";
const headers = { "User-Agent": "Mozilla/5.0 (Macintosh; Apple Silicon Mac OS X) Aperto" };

const decode = (text: string) =>
  text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

/** Each app on CodeWeavers' compatibility search page, with its Mac rating out of five stars. */
export function parseCrossoverRatings(html: string): CrossoverRating[] {
  const ratings: CrossoverRating[] = [];
  for (const [, row] of html.matchAll(/<tr id="key_\d+">([\s\S]*?)<\/tr>/g)) {
    const link = /href="(\/compatibility\/crossover\/[^"]+)">([^<]+)<\/a>/.exec(row!);
    const stars = /<ul class="star-rating-table">([\s\S]*?)<\/ul>/.exec(row!);
    if (!link || !stars) continue;
    ratings.push({
      title: decode(link[2]!.trim()),
      url: site + link[1],
      stars: stars[1]!.split('class="active"').length - 1,
    });
  }
  return ratings;
}

/**
 * How well CrossOver runs the game, as CodeWeavers' compatibility database rates it: the entry
 * named the same, or else one whose title clearly names it. Null when none is rated; throws when
 * the database cannot be reached, so that is not remembered as no rating.
 */
export async function crossoverRating(name: string): Promise<CrossoverRating | null> {
  const response = await fetch(
    `${site}/compatibility?name=${encodeURIComponent(name)}&search=app`,
    { headers, signal: AbortSignal.timeout(20_000) },
  );
  if (!response.ok) throw new Error(`CodeWeavers answered ${response.status}.`);
  const rated = parseCrossoverRatings(await response.text()).filter((item) => item.stars > 0);
  const same = (title: string) =>
    title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "") ===
    name.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  return (
    rated.find((item) => same(item.title)) ??
    rated.find((item) => titleMatches(name, item.title)) ??
    null
  );
}
