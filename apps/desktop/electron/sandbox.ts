import { realpath } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

/**
 * What a protected game may use besides the system: the programs it may start (its runtime), the
 * folders it may read in the home folder, and the folders it may write to.
 */
export type SandboxAccess = { run: string[]; read: string[]; write: string[] };

// macOS checks each rule against the operation it names, so an allow only lifts a deny of the same
// operation: reads are denied and allowed as `file-read-data`, writes as `file-write*`.
const profile = (access: SandboxAccess) => {
  const paths = (prefix: string, list: string[]) =>
    list.map((_, index) => `(subpath (param "${prefix}${index}"))`).join(" ");
  return `(version 1)
(allow default)
(deny network-outbound (remote ip))
(allow network-outbound (remote ip "localhost:*"))
(deny process-exec)
(allow process-exec ${paths("RUN", access.run)})
(deny appleevent-send)
(deny file-read-data (subpath (param "HOME")))
(allow file-read-data ${paths("RUN", access.run)} ${paths("READ", access.read)} ${paths("WRITE", access.write)})
(deny file-write*)
${writes(access.write)}
`;
};

/**
 * Lets the game write each folder, but not create launchable files in it. The launchable rule
 * looks only below the folder, so a game kept inside an app bundle, such as an NW.js game in
 * `Game.app`, can still write its saves. The last matching rule wins, so folders go from the
 * outermost in and the innermost folder holding a path decides.
 */
const writes = (folders: string[]) =>
  [...folders]
    .sort((a, b) => a.length - b.length)
    .map(
      (folder) =>
        `(allow file-write* (subpath "${quote(folder)}"))\n(deny file-write* (regex #"^${escape(folder)}/.*\\.(${launchable.join("|")})(/|$)"))`,
    )
    .join("\n");

/** A path as a sandbox string, and as a literal in a sandbox regex. */
const quote = (folder: string) => folder.replace(/["\\]/g, "\\$&");
const escape = (folder: string) => folder.replace(/[\\^$.|?*+()[\]{}"]/g, "\\$&");

// Files Finder would run or install when opened. A game asking macOS to open one would run it
// outside the sandbox, so it may not create them at all.
const launchable = [
  "app",
  "command",
  "tool",
  "terminal",
  "workflow",
  "action",
  "scpt",
  "scptd",
  "applescript",
  "osax",
  "pkg",
  "mpkg",
  "dmg",
  "fileloc",
  "inetloc",
  "webloc",
  "prefPane",
  "kext",
  "plugin",
  "bundle",
  "framework",
  "dylib",
  "so",
  "jar",
];

/**
 * Wraps a game's command in a macOS sandbox. The game gets no internet besides this Mac, cannot
 * start other programs or script other apps, cannot read personal files in the home folder, and
 * writes only to the given folders and temporary files. Paths are resolved first, since the
 * sandbox compares real paths.
 */
export async function sandboxed(
  executable: string,
  args: string[],
  access: SandboxAccess,
): Promise<[string, string[]]> {
  const resolve = (list: string[]) =>
    Promise.all(list.map((item) => realpath(item).catch(() => path.resolve(item))));
  const home = await resolve([homedir()]);
  const resolved: SandboxAccess = {
    run: await resolve(access.run),
    read: await resolve([...access.read, path.join(homedir(), "Library", "Fonts")]),
    // The per-user temporary and cache folders sit side by side under one parent.
    write: await resolve([...access.write, path.dirname(tmpdir()), "/private/tmp", "/dev"]),
  };
  const params = [
    ["HOME", home[0]!],
    ...(["run", "read", "write"] as const).flatMap((kind) =>
      resolved[kind].map((item, index) => [`${kind.toUpperCase()}${index}`, item]),
    ),
  ].flatMap(([name, value]) => ["-D", `${name}=${value}`]);
  return ["/usr/bin/sandbox-exec", ["-p", profile(resolved), ...params, executable, ...args]];
}
