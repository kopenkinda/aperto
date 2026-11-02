import { execFile } from "node:child_process";
import { lstat, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import type { Component } from "../src/model";

const rtpNames: Record<string, string> = {
  Standard: "RPG Maker XP RTP",
  RPGVX: "RPG Maker VX RTP",
  RPGVXAce: "RPG Maker VX Ace RTP",
};

/** Total size of a folder's files, without following symlinks. */
async function size(target: string): Promise<number> {
  const info = await lstat(target).catch(() => null);
  if (!info) return 0;
  if (!info.isDirectory()) return info.size;
  const entries = await readdir(target).catch(() => [] as string[]);
  let total = 0;
  for (const entry of entries) total += await size(path.join(target, entry));
  return total;
}

/**
 * Disk space the folders take, measured by `du`, which is far faster than walking them here.
 * Folders inside another listed folder are counted once, and missing ones are skipped.
 */
export async function diskUsage(folders: readonly string[]): Promise<number> {
  const distinct = [...new Set(folders)].filter(
    (folder) => !folders.some((other) => other !== folder && folder.startsWith(`${other}/`)),
  );
  if (!distinct.length) return 0;
  // `du` exits with an error for an unreadable or missing folder but still lists the rest.
  const output = await new Promise<string>((resolve) =>
    execFile("/usr/bin/du", ["-sk", "--", ...distinct], { maxBuffer: 1 << 22 }, (_, stdout) =>
      resolve(String(stdout ?? "")),
    ),
  );
  return output
    .split("\n")
    .reduce((total, line) => total + (Number.parseInt(line, 10) || 0) * 1024, 0);
}

const subfolders = (folder: string) =>
  readdir(folder, { withFileTypes: true })
    .then((entries) =>
      entries
        .filter((entry) => entry.isDirectory() && !entry.name.includes(".partial"))
        .map((entry) => entry.name),
    )
    .catch(() => [] as string[]);

/**
 * What Aperto downloaded besides NW.js: Ren'Py releases, mkxp-z with its scripts and RTPs, the
 * cheat menu, and Legendary for Epic. Each is fetched again the next time it is needed, so all
 * can be removed.
 */
export async function findComponents(directory: string): Promise<Omit<Component, "size">[]> {
  const found: Omit<Component, "size">[] = [];
  for (const version of await subfolders(path.join(directory, "renpy"))) {
    // An empty marker records a release without an Apple Silicon build; nothing else is kept.
    const marker = await readFile(
      path.join(directory, "renpy", version, ".installed"),
      "utf8",
    ).catch(() => null);
    if (marker) found.push({ id: `renpy/${version}`, name: `Ren'Py ${version}`, kind: "renpy" });
  }
  const mkxp = path.join(directory, "mkxp-z");
  for (const folder of await subfolders(mkxp)) {
    if (folder === "app") found.push({ id: "mkxp-z/app", name: "mkxp-z", kind: "rgss" });
    if (folder === "kawariki")
      for (const commit of await subfolders(path.join(mkxp, "kawariki")))
        found.push({ id: `mkxp-z/kawariki/${commit}`, name: "Kawariki scripts", kind: "rgss" });
    if (folder === "rtp")
      for (const name of await subfolders(path.join(mkxp, "rtp")))
        found.push({
          id: `mkxp-z/rtp/${name}`,
          name: rtpNames[name] ?? `${name} RTP`,
          kind: "rgss",
        });
  }
  for (const commit of await subfolders(path.join(directory, "cheat-menu")))
    found.push({ id: `cheat-menu/${commit}`, name: "Cheat menu", kind: "nwjs" });
  for (const version of await subfolders(path.join(directory, "legendary-client")))
    found.push({ id: `legendary-client/${version}`, name: `Legendary ${version}`, kind: "epic" });
  return found;
}

/** The downloads with the space each takes. */
export async function listComponents(directory: string): Promise<Component[]> {
  return Promise.all(
    (await findComponents(directory)).map(async (item) => ({
      ...item,
      size: await size(path.join(directory, item.id)),
    })),
  );
}

/** Removes one listed component. Only ids `listComponents` can return are accepted. */
export async function removeComponent(directory: string, id: string) {
  if (!(await findComponents(directory)).some((item) => item.id === id))
    throw new Error("That download is no longer there.");
  await rm(path.join(directory, id), { recursive: true, force: true });
}
