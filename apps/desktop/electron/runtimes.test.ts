import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { archiveDigest, extractRuntime, validVersion, verifyManifest } from "./runtimes";

const execute = promisify(execFile);
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "aperto-archive-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("runtime integrity", () => {
  it("selects the exact artifact checksum and rejects missing or ambiguous entries", () => {
    const filename = "nwjs-v0.100.0-osx-arm64.zip";
    const line = `${"a".repeat(64)}  ${filename}`;
    expect(archiveDigest(line, filename)).toBe("a".repeat(64));
    expect(() => archiveDigest(`${line}\n${line}`, filename)).toThrow("exactly one");
    expect(() => archiveDigest(line, `sdk-${filename}`)).toThrow("exactly one");
    expect(() => validVersion("../../other")).toThrow();
    expect(() => validVersion("0.76.0")).toThrow();
  });
  it("refuses unsigned or invalid release metadata", async () => {
    await expect(verifyManifest("checksum", "not a signature")).rejects.toThrow();
  });
  it("extracts files and internal framework symlinks", async () => {
    const source = path.join(directory, "source");
    await mkdir(path.join(source, "Framework", "Versions", "A"), { recursive: true });
    await writeFile(path.join(source, "Framework", "Versions", "A", "binary"), "fixture binary");
    await symlink("A", path.join(source, "Framework", "Versions", "Current"));
    const archive = path.join(directory, "valid.zip");
    await execute("/usr/bin/zip", ["-qry", archive, "Framework"], { cwd: source });
    const output = path.join(directory, "output");
    await extractRuntime(archive, output);
    expect(
      await readFile(path.join(output, "Framework", "Versions", "Current", "binary"), "utf8"),
    ).toBe("fixture binary");
  });
  it("rejects traversal and symlinks that escape extraction", async () => {
    const source = path.join(directory, "source");
    await mkdir(source);
    await writeFile(path.join(directory, "outside.txt"), "unchanged");
    const traversal = path.join(directory, "traversal.zip");
    await execute("/usr/bin/zip", ["-q", traversal, "../outside.txt"], { cwd: source });
    await expect(extractRuntime(traversal, path.join(directory, "bad1"))).rejects.toThrow();
    await symlink("../outside.txt", path.join(source, "escape"));
    const links = path.join(directory, "links.zip");
    await execute("/usr/bin/zip", ["-qy", links, "escape"], { cwd: source });
    await expect(extractRuntime(links, path.join(directory, "bad2"))).rejects.toThrow("escapes");
    expect(await readFile(path.join(directory, "outside.txt"), "utf8")).toBe("unchanged");
  });
});
