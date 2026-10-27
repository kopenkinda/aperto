import { readFile } from "node:fs/promises";
import path from "node:path";
import { fetchPinned } from "./downloads";
import { atomicWrite, digest } from "./storage";

// emerladCoder's RPG Maker MV Cheat Menu. Its repository has no license, so Aperto downloads it
// when asked instead of shipping it, pinned to one commit and checked against these hashes.
const commit = "3e789f4d55846f8a4179e331397680d4165a4a21";
const files = {
  "Cheat_Menu.js": "bb2a0708e9020f7101246c0a42242d888d37477b2b2a404baa0316ecc5db648c",
  "Cheat_Menu.css": "f9a6000d16f11c00011d32014eadf5cedd49d02883b9c7b78bedc17276b992a9",
};
export const cheatMenuFiles = Object.keys(files);

/** The cheat menu's files, downloaded once into Aperto's data folder and verified each time. */
export async function cheatMenu(directory: string): Promise<Map<string, Buffer>> {
  const cache = path.join(directory, "cheat-menu", commit);
  const result = new Map<string, Buffer>();
  for (const [name, hash] of Object.entries(files)) {
    let data: Buffer | null = await readFile(path.join(cache, name)).catch(() => null);
    if (!data || digest(data) !== hash) {
      data = await fetchPinned(
        `https://raw.githubusercontent.com/emerladCoder/RPG-Maker-MV-Cheat-Menu-Plugin/${commit}/Cheat_Menu/www/js/plugins/${name}`,
        hash,
        "cheat menu",
      );
      await atomicWrite(path.join(cache, name), data, 0o644);
    }
    result.set(name, data);
  }
  return result;
}

/** Aperto's getPixel fix: non-finite coordinates read black instead of throwing. */
export const pixelFixSource = `// Added by Aperto. Newer Chromium throws when a game reads a pixel at a non-finite position,
// which some MV and MZ games do; such reads return black instead.
(() => {
  const getPixel = Bitmap.prototype.getPixel;
  Bitmap.prototype.getPixel = function (x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return "#000000";
    return getPixel.call(this, x, y);
  };
})();
`;
