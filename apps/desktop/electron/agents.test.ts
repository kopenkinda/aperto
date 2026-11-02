import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { agentScript } from "./agents";

const run = promisify(execFile);

describe.runIf(process.platform === "darwin")("coding agents", () => {
  it("starts the agent in the game folder with Aperto's notes, then removes the script", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "aperto-agent-"));
    try {
      const bin = path.join(directory, "bin");
      const game = path.join(directory, "It's a [Game]");
      await mkdir(bin);
      await mkdir(game);
      // A stand-in for Qwen Code, which is not installed here, so the login shell cannot find a
      // real one first. It records where it ran and what it was given.
      await writeFile(
        path.join(bin, "qwen"),
        `#!/bin/sh\npwd > "${directory}/pwd"\nprintf '%s\\n' "$@" > "${directory}/args"\n`,
      );
      await chmod(path.join(bin, "qwen"), 0o755);
      const script = await agentScript(directory, "qwen", game, 'Game: It\'s "quoted"\nLine 2');
      const started = run(script, [], {
        env: { ...process.env, SHELL: "/bin/sh", PATH: `${bin}:${process.env.PATH}` },
      });
      // The shell left open after the agent reads input; ending it lets the script finish.
      started.child.stdin?.end();
      await started;
      expect((await readFile(path.join(directory, "pwd"), "utf8")).trim()).toMatch(
        /It's a \[Game\]$/,
      );
      expect(await readFile(path.join(directory, "args"), "utf8")).toBe(
        `-i\nGame: It's "quoted"\nLine 2\n\nReply only with a one-line summary of the game, then wait for my request.\n`,
      );
      await expect(readFile(script)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
