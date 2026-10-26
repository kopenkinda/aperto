import { execFile } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { exists } from "./storage";

const execute = promisify(execFile);

/**
 * Terminals that open a shell in a folder handed to them with `open`. macOS has no default
 * terminal setting, so a third-party one, which the user installed on purpose, wins over Terminal.
 */
const known = [
  { id: "com.mitchellh.ghostty", name: "Ghostty", bundle: "Ghostty.app" },
  { id: "com.googlecode.iterm2", name: "iTerm", bundle: "iTerm.app" },
  { id: "dev.warp.Warp-Stable", name: "Warp", bundle: "Warp.app" },
  { id: "com.apple.Terminal", name: "Terminal", bundle: "Utilities/Terminal.app" },
];
const folders = ["/Applications", path.join(homedir(), "Applications"), "/System/Applications"];

export async function installedTerminals(): Promise<{ id: string; name: string }[]> {
  const found = await Promise.all(
    known.map(async (terminal) => {
      for (const folder of folders)
        if (await exists(path.join(folder, terminal.bundle))) return terminal;
      return null;
    }),
  );
  return found.filter((item) => item !== null).map(({ id, name }) => ({ id, name }));
}

/** The chosen terminal while it is installed, else the first one found. */
export async function terminalFor(chosen: string | null | undefined) {
  const installed = await installedTerminals();
  const terminal = installed.find((item) => item.id === chosen) ?? installed[0];
  if (!terminal) throw new Error("No supported terminal was found.");
  return terminal;
}

export async function openInTerminal(id: string, folder: string) {
  await execute("/usr/bin/open", ["-b", id, folder]);
}
