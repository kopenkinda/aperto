import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dlsiteDownload, purchasedWorks, unpackParts } from "./dlsite";
import { exists } from "./storage";

const execute = promisify(execFile);
let directory = "";
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "aperto-dlsite-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const file = (body: string, name: string) =>
  new Response(body, {
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="${name}"`,
    },
  });

describe("DLsite", () => {
  it("reads work numbers from the purchase list in either shape", () => {
    expect(
      purchasedWorks([{ workno: "RJ01000001" }, { workno: "VJ012345" }, { workno: "x" }]),
    ).toEqual(["RJ01000001", "VJ012345"]);
    expect(purchasedWorks({ works: [{ workno: "RJ01000001" }, "RJ01000002"] })).toEqual([
      "RJ01000001",
      "RJ01000002",
    ]);
    expect(purchasedWorks(null)).toEqual([]);
  });

  it("downloads a work in one file, or each part of a split one in order", async () => {
    const single = await dlsiteDownload(
      async () => file("zip", "RJ01000001.zip"),
      "RJ01000001",
      directory,
      new AbortController().signal,
      () => {},
    );
    expect(single.map((item) => path.basename(item))).toEqual(["RJ01000001.zip"]);

    const asked: string[] = [];
    const split = await mkdir(path.join(directory, "split"), { recursive: true }).then(() =>
      dlsiteDownload(
        async (url) => {
          asked.push(url);
          if (url.endsWith("/download/=/product_id/RJ01000002.html"))
            return new Response("<html>", { headers: { "content-type": "text/html" } });
          if (url.includes("/split/"))
            return new Response(
              '<a href="/maniax/download/=/number/2/product_id/RJ01000002.html"></a><a href="/maniax/download/=/number/1/product_id/RJ01000002.html"></a>',
              { headers: { "content-type": "text/html" } },
            );
          const part = /number\/(\d+)/.exec(url)![1];
          return file(`part ${part}`, `RJ01000002.part${part}.rar`);
        },
        "RJ01000002",
        path.join(directory, "split"),
        new AbortController().signal,
        () => {},
      ),
    );
    expect(split.map((item) => path.basename(item))).toEqual([
      "RJ01000002.part1.rar",
      "RJ01000002.part2.rar",
    ]);
    expect(await readFile(split[1]!, "utf8")).toBe("part 2");
    expect(asked.at(-1)).toContain("/maniax/download/=/number/2/product_id/RJ01000002.html");
  });

  it.runIf(process.platform === "darwin")("joins split archives with 7-Zip", async () => {
    const sevenZip = (
      await Promise.all(
        ["/opt/homebrew/bin/7zz", "/opt/homebrew/bin/7z"].map(async (tool) =>
          (await exists(tool)) ? tool : null,
        ),
      )
    ).find(Boolean);
    if (!sevenZip) return;
    const source = path.join(directory, "Game");
    await mkdir(source);
    await writeFile(path.join(source, "Game.exe"), "x".repeat(4096));
    const parts = path.join(directory, "parts");
    await mkdir(parts);
    await execute(sevenZip, ["a", "-v2k", "-mx0", path.join(parts, "game.7z"), source]);
    const files = (await readdir(parts)).sort().map((name) => path.join(parts, name));
    expect(files.length).toBeGreaterThan(1);
    await unpackParts(files, path.join(directory, "out"));
    expect(await readFile(path.join(directory, "out", "Game", "Game.exe"), "utf8")).toHaveLength(
      4096,
    );
  });
});
