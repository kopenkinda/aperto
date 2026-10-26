import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { extractExeIcon } from "./exe-icon";

/** A minimal 64-bit PE file whose resources hold one icon group with the given images. */
function executable(images: { size: number; data: Buffer }[]) {
  const rsrc = Buffer.alloc(4096);
  const directory = (offset: number, entries: [id: number, target: number][]) => {
    rsrc.writeUInt16LE(entries.length, offset + 14);
    entries.forEach(([id, target], index) => {
      rsrc.writeUInt32LE(id, offset + 16 + index * 8);
      rsrc.writeUInt32LE(target >>> 0, offset + 20 + index * 8);
    });
  };
  const sub = (offset: number) => (offset | 0x80000000) >>> 0;
  const rva = 0x1000;
  // Types, then names, then languages, then data entries, then data.
  directory(0, [
    [3, sub(32)],
    [14, sub(32 + 16 + images.length * 8)],
  ]);
  directory(
    32,
    images.map((_, index) => [index + 1, sub(256 + index * 24)]),
  );
  directory(32 + 16 + images.length * 8, [[1, sub(232)]]);
  let data = 1024;
  const leaf = (directoryOffset: number, entryOffset: number, bytes: Buffer) => {
    directory(directoryOffset, [[0x409, entryOffset]]);
    rsrc.writeUInt32LE(rva + data, entryOffset);
    rsrc.writeUInt32LE(bytes.length, entryOffset + 4);
    bytes.copy(rsrc, data);
    data += bytes.length;
  };
  const group = Buffer.alloc(6 + images.length * 14);
  group.writeUInt16LE(1, 2);
  group.writeUInt16LE(images.length, 4);
  images.forEach((image, index) => {
    group[6 + index * 14] = image.size === 256 ? 0 : image.size;
    group.writeUInt16LE(32, 6 + index * 14 + 6);
    group.writeUInt16LE(index + 1, 6 + index * 14 + 12);
  });
  leaf(232, 600, group);
  images.forEach((image, index) => leaf(256 + index * 24, 608 + index * 8, image.data));

  const headers = Buffer.alloc(0x200);
  headers.write("MZ", 0, "latin1");
  headers.writeUInt32LE(64, 0x3c);
  headers.write("PE\0\0", 64, "latin1");
  headers.writeUInt16LE(1, 64 + 6);
  headers.writeUInt16LE(240, 64 + 20);
  headers.writeUInt16LE(0x20b, 88);
  headers.writeUInt32LE(rva, 88 + 128);
  headers.writeUInt32LE(rsrc.length, 88 + 132);
  headers.write(".rsrc", 328, "latin1");
  headers.writeUInt32LE(rsrc.length, 328 + 8);
  headers.writeUInt32LE(rva, 328 + 12);
  headers.writeUInt32LE(rsrc.length, 328 + 16);
  headers.writeUInt32LE(0x200, 328 + 20);
  return Buffer.concat([headers, rsrc]);
}

const png = (marker: string) =>
  Buffer.concat([Buffer.from("\x89PNG\r\n\x1a\n", "latin1"), Buffer.from(marker)]);

describe("executable icons", () => {
  let directory: string;
  afterEach(() => rm(directory, { recursive: true, force: true }));

  it("extracts the largest image of the first icon group", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "aperto-exe-"));
    const file = path.join(directory, "Game.exe");
    await writeFile(
      file,
      executable([
        { size: 32, data: png("small") },
        { size: 256, data: png("large") },
      ]),
    );
    const icon = await extractExeIcon(file);
    expect(icon).toMatch(/\.png$/);
    expect((await readFile(icon!)).subarray(8).toString()).toBe("large");
    await rm(icon!);
  });
  it("returns null for files that are not executables", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "aperto-exe-"));
    const file = path.join(directory, "Game.exe");
    await writeFile(file, "not a program");
    expect(await extractExeIcon(file)).toBeNull();
  });
});
