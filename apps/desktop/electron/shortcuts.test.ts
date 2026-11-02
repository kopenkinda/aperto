import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createShortcut, parseLink, playLink } from "./shortcuts";

const id = "00000000-0000-4000-8000-000000000001";
// A 1×1 PNG, which sips scales up to every icon size.
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

describe("shortcuts", () => {
  it("reads play links and nothing else", () => {
    expect(parseLink(playLink(id))).toEqual({ action: "play", id });
    expect(parseLink(`aperto://play/${id}/`)).toEqual({ action: "play", id });
    expect(parseLink("aperto://play/not-a-game")).toBe(null);
    expect(parseLink(`https://example.com/play/${id}`)).toBe(null);
  });

  it.runIf(process.platform === "darwin")(
    "makes an app named after the game that opens its link, with its icon",
    async () => {
      const directory = await mkdtemp(path.join(tmpdir(), "aperto-shortcut-test-"));
      try {
        const icon = path.join(directory, "icon.png");
        await writeFile(icon, png);
        const app = await createShortcut({ id, name: "Fallout: New Vegas" }, icon, directory);
        expect(path.basename(app)).toBe("Fallout- New Vegas.app");
        const script = path.join(app, "Contents", "MacOS", "play");
        expect(await readFile(script, "utf8")).toContain(`open -g "aperto://play/${id}"`);
        expect((await stat(script)).mode & 0o111).toBeTruthy();
        const info = await readFile(path.join(app, "Contents", "Info.plist"), "utf8");
        expect(info).toContain("<string>Fallout: New Vegas</string>");
        expect(info).toContain("<key>CFBundleIconFile</key><string>icon</string>");
        expect(
          (await stat(path.join(app, "Contents", "Resources", "icon.icns"))).size,
        ).toBeGreaterThan(0);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});
