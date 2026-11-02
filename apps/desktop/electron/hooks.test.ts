import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runHook } from "./hooks";

let directory = "";
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "aperto-hooks-"));
});
afterEach(() => rm(directory, { recursive: true, force: true }));

describe("hooks", () => {
  it("runs the commands in the game's folder with what they are for", async () => {
    const problem = await runHook(
      "gameStart",
      'printf "%s|%s|%s" "$APERTO_HOOK" "$APERTO_GAME_NAME" "$PWD" > out.txt',
      { APERTO_GAME_NAME: "Ember", APERTO_GAME_FOLDER: directory },
      { wait: true },
    );
    expect(problem).toBeNull();
    const [hook, name, folder] = (await readFile(path.join(directory, "out.txt"), "utf8")).split(
      "|",
    );
    expect([hook, name]).toEqual(["gameStart", "Ember"]);
    expect(await realpath(folder!)).toBe(await realpath(directory));
  });
  it("reports commands that fail or hang, and skips empty ones", async () => {
    expect(await runHook("gameStart", "exit 3", {}, { wait: true })).toBe(
      "The “A game starts” hook exited with code 3.",
    );
    expect(await runHook("gameStart", "sleep 5", {}, { wait: true, timeout: 200 })).toMatch(
      /still running after 0.2s/,
    );
    expect(await runHook("gameEnd", "  \n", {})).toBeNull();
  });
});
