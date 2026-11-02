import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Game } from "../src/model";

const execute = promisify(execFile);

/** Aperto's address scheme, which other apps, Spotlight, and shortcuts open games through. */
export const linkScheme = "aperto";
/** The address that starts a game. */
export const playLink = (id: string) => `${linkScheme}://play/${id}`;

/** What an `aperto://` address asks for, or null for one Aperto does not know. */
export function parseLink(url: string): { action: "play"; id: string } | null {
  const match = /^aperto:\/\/play\/([a-f0-9-]{36})\/?$/i.exec(url.trim());
  return match ? { action: "play", id: match[1]!.toLowerCase() } : null;
}

/** Where shortcuts go: an Applications folder, which Spotlight, Launchpad, and Raycast list. */
export const shortcutsFolder = path.join(homedir(), "Applications", "Aperto Games");

const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Converts an image to a macOS icon at every size the icon format holds. */
async function toIcns(image: string, icns: string) {
  const iconset = path.join(await mkdtemp(path.join(tmpdir(), "aperto-shortcut-")), "icon.iconset");
  await mkdir(iconset);
  try {
    for (const points of [16, 32, 128, 256, 512])
      for (const scale of [1, 2]) {
        const pixels = points * scale;
        const suffix = scale === 2 ? "@2x" : "";
        await execute("/usr/bin/sips", [
          "-s",
          "format",
          "png",
          "-z",
          String(pixels),
          String(pixels),
          image,
          "--out",
          path.join(iconset, `icon_${points}x${points}${suffix}.png`),
        ]);
      }
    await execute("/usr/bin/iconutil", ["-c", "icns", iconset, "-o", icns]);
  } finally {
    await rm(path.dirname(iconset), { recursive: true, force: true });
  }
}

/**
 * Makes a small app named after the game that starts it through Aperto, with the game's icon
 * when there is one. Its executable is a script, which macOS runs without a signature; opening
 * the link in the background leaves Aperto's window where it is. Replaces an earlier shortcut
 * of the same name.
 */
export async function createShortcut(
  game: Pick<Game, "id" | "name">,
  icon: string | null,
  folder = shortcutsFolder,
) {
  const name = game.name.replace(/[/:]/g, "-").replace(/^\.+/, "").trim() || "Game";
  const app = path.join(folder, `${name}.app`);
  await rm(app, { recursive: true, force: true });
  await mkdir(path.join(app, "Contents", "MacOS"), { recursive: true });
  await mkdir(path.join(app, "Contents", "Resources"), { recursive: true });
  const hasIcon = icon
    ? await toIcns(icon, path.join(app, "Contents", "Resources", "icon.icns")).then(
        () => true,
        () => false,
      )
    : false;
  await writeFile(
    path.join(app, "Contents", "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>${escape(name)}</string>
  <key>CFBundleDisplayName</key><string>${escape(game.name)}</string>
  <key>CFBundleIdentifier</key><string>com.aperto.shortcut.${game.id}</string>
  <key>CFBundleExecutable</key><string>play</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  ${hasIcon ? "<key>CFBundleIconFile</key><string>icon</string>" : ""}
  <key>LSUIElement</key><true/>
</dict>
</plist>
`,
  );
  await writeFile(
    path.join(app, "Contents", "MacOS", "play"),
    `#!/bin/sh\nexec /usr/bin/open -g "${playLink(game.id)}"\n`,
    { mode: 0o755 },
  );
  return app;
}
