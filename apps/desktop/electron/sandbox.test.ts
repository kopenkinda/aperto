import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { sandboxed } from "./sandbox";

const run = promisify(execFile);

describe.runIf(process.platform === "darwin")("sandbox", () => {
  it("lets a game write its folder but not start programs, read or write personal files", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "aperto-sandbox-"));
    const game = path.join(directory, "game");
    await mkdir(game);
    const outside = path.join(homedir(), `.aperto-sandbox-test-${process.pid}`);
    try {
      const [command, args] = await sandboxed(
        "/bin/sh",
        [
          "-c",
          [
            `echo saved > "${game}/save.txt"`,
            `echo escaped > "${outside}" 2>/dev/null && echo wrote-home`,
            `echo x > "${game}/run.command" 2>/dev/null && echo wrote-launchable`,
            `/usr/bin/true 2>/dev/null && echo ran-program`,
            `ls "${homedir()}" >/dev/null 2>&1 && echo listed-home`,
            "echo done",
          ].join("; "),
        ],
        { run: ["/bin"], read: [], write: [game] },
      );
      const { stdout } = await run(command, args);
      expect(stdout.trim().split("\n")).toEqual(["done"]);
      expect(await readFile(path.join(game, "save.txt"), "utf8")).toBe("saved\n");
    } finally {
      await rm(outside, { force: true });
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("lets a game kept inside an app bundle write its saves", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "aperto-sandbox-"));
    const game = path.join(
      directory,
      "Game [MacOS]",
      "Game.app",
      "Contents",
      "Resources",
      "app.nw",
    );
    await mkdir(path.join(game, "save"), { recursive: true });
    try {
      const [command, args] = await sandboxed(
        "/bin/sh",
        [
          "-c",
          [
            `echo saved > "${game}/save/config.rpgsave"`,
            `mkdir "${game}/Other.app" 2>/dev/null && echo wrote-launchable`,
            "echo done",
          ].join("; "),
        ],
        { run: ["/bin"], read: [], write: [game] },
      );
      const { stdout } = await run(command, args);
      expect(stdout.trim().split("\n")).toEqual(["done"]);
      expect(await readFile(path.join(game, "save", "config.rpgsave"), "utf8")).toBe("saved\n");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
