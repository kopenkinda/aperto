import { execFile } from "node:child_process";
import { mkdir, open, rename } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { OwnedGame } from "../src/model";
import { unpack } from "./itch";
import { dlsiteFloor, dlsiteProduct, dlsiteWork } from "./metadata";
import { exists } from "./storage";

const execute = promisify(execFile);

/** The persistent session DLsite's sign-in cookies live in. */
export const dlsiteSession = "persist:dlsite";
/** DLsite Play's sign-in, which goes through DLsite's own login page and back. */
export const dlsiteLoginUrl = "https://play.dlsite.com/login/";
/** DLsite Play's list of the account's purchases, which answers 401 until signed in. */
export const dlsitePurchases = "https://play.dlsite.com/api/v3/content/sales?last=0";

/** Fetches with the DLsite session; Aperto's native layer supplies it. */
export type SessionFetch = (url: string, signal?: AbortSignal) => Promise<Response>;

// DLsite's work types for games. Manga, CG, voice, music, video, and tools are left out.
const gameTypes = new Set([
  "ACN",
  "QIZ",
  "ADV",
  "RPG",
  "TBL",
  "DNV",
  "SLN",
  "TYP",
  "STG",
  "PZL",
  "ETC",
]);

/** The work numbers in DLsite Play's purchase list, whichever shape it answers in. */
export function purchasedWorks(body: unknown): string[] {
  const items = Array.isArray(body)
    ? body
    : ((body as { works?: unknown[]; sales?: unknown[] } | null)?.works ??
      (body as { sales?: unknown[] } | null)?.sales ??
      []);
  return [
    ...new Set(
      items
        .map((item) => (typeof item === "string" ? item : (item as { workno?: string })?.workno))
        .filter((work): work is string => typeof work === "string" && dlsiteWork.test(work)),
    ),
  ];
}

/**
 * The games among the account's DLsite purchases, with titles, makers, and covers from DLsite's
 * public product API, eight at a time.
 */
export async function dlsiteOwnedGames(fetch: SessionFetch): Promise<OwnedGame[]> {
  const response = await fetch(dlsitePurchases);
  if (response.status === 401)
    throw new Error("DLsite signed Aperto out. Sign in again in Settings.");
  if (!response.ok) throw new Error("DLsite could not be reached. Try again.");
  const works = purchasedWorks(await response.json());
  const games: OwnedGame[] = [];
  for (let start = 0; start < works.length; start += 8) {
    const products = await Promise.all(
      works.slice(start, start + 8).map((work) => dlsiteProduct(work).catch(() => null)),
    );
    for (const product of products) {
      if (!product?.work_name || !gameTypes.has(product.work_type ?? "")) continue;
      games.push({
        site: "dlsite",
        id: product.workno,
        gameId: product.workno,
        title: product.work_name,
        page: product.workno,
        cover: product.image_main?.url ? `https:${product.image_main.url}` : null,
        author: product.maker_name ?? "",
        platforms: (product.file_type ?? "").startsWith("HT") ? ["web"] : ["windows"],
      });
    }
  }
  return games.sort((a, b) => a.title.localeCompare(b.title));
}

/** A download's file name, from its Content-Disposition header or else its address. */
function fileName(response: Response, fallback: string) {
  const disposition = response.headers.get("content-disposition") ?? "";
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const plain = /filename="?([^";]+)"?/i.exec(disposition)?.[1];
  const name = encoded
    ? decodeURIComponent(encoded)
    : (plain ?? path.basename(new URL(response.url).pathname));
  return path.basename(name || fallback);
}

async function save(
  response: Response,
  folder: string,
  fallback: string,
  progress: (received: number) => void,
) {
  if (!response.body) throw new Error("DLsite sent an empty download. Try again.");
  const file = path.join(folder, fileName(response, fallback));
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

/**
 * Downloads a work into `folder`. Small works come as one file; large ones come as numbered
 * parts listed on a split page, downloaded one after another. Returns the files in order.
 */
export async function dlsiteDownload(
  fetch: SessionFetch,
  work: string,
  folder: string,
  signal: AbortSignal,
  progress: (received: number, total: number | null) => void,
) {
  const base = `https://www.dlsite.com/${dlsiteFloor(work)}/download`;
  const first = await fetch(`${base}/=/product_id/${work}.html`, signal);
  if (!first.ok) throw new Error(`DLsite would not send ${work}. Check that you are signed in.`);
  // One file comes straight away; a split work answers with a page instead.
  if (!first.headers.get("content-type")?.includes("text/html")) {
    const total = Number(first.headers.get("content-length")) || null;
    return [await save(first, folder, `${work}.zip`, (received) => progress(received, total))];
  }
  await first.body?.cancel();
  const page = await (await fetch(`${base}/split/=/product_id/${work}.html`, signal)).text();
  const parts = [
    ...new Set([...page.matchAll(/\/number\/(\d+)\//g)].map((m) => Number(m[1]))),
  ].sort((a, b) => a - b);
  if (!parts.length) throw new Error(`DLsite did not offer a download for ${work}.`);
  const files: string[] = [];
  let done = 0;
  for (const part of parts) {
    const response = await fetch(`${base}/=/number/${part}/product_id/${work}.html`, signal);
    if (!response.ok) throw new Error(`DLsite would not send part ${part} of ${work}.`);
    files.push(
      await save(response, folder, `${work}.part${part}`, (received) =>
        progress(done + received, null),
      ),
    );
    done += Number(response.headers.get("content-length")) || 0;
  }
  return files;
}

// 7-Zip reads split RAR, self-extracting archives, and split ZIP files that tar cannot.
const sevenZip = [
  "/opt/homebrew/bin/7zz",
  "/opt/homebrew/bin/7z",
  "/usr/local/bin/7zz",
  "/usr/local/bin/7z",
];

/**
 * Unpacks a download into `destination`. One file unpacks as any download does. Parts need 7-Zip
 * from Homebrew, which reads from the first part on; without it, the parts are moved in as they
 * are, for the user to join.
 */
export async function unpackParts(files: string[], destination: string) {
  if (files.length === 1) return unpack(files[0]!, destination);
  await mkdir(destination, { recursive: true });
  for (const tool of sevenZip) {
    if (!(await exists(tool))) continue;
    await execute(tool, ["x", "-y", `-o${destination}`, files[0]!], { maxBuffer: 64 * 1024 ** 2 });
    return;
  }
  for (const file of files) await rename(file, path.join(destination, path.basename(file)));
}
