import { randomUUID } from "node:crypto";
import { open, writeFile, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const RT_ICON = 3;
const RT_GROUP_ICON = 14;

type Section = { address: number; size: number; offset: number; rawSize: number };

/**
 * Pulls the application icon out of a Windows executable, as Explorer shows it: the first icon
 * group's largest, deepest image. Writes it to a temporary .png, or a one-image .ico for older
 * bitmap icons, and returns the path; the caller removes it. Returns null when the file has no
 * icon or is not a readable PE file.
 */
export async function extractExeIcon(file: string): Promise<string | null> {
  const handle = await open(file, "r").catch(() => null);
  if (!handle) return null;
  try {
    const icon = await readIcon(handle);
    if (!icon) return null;
    const png = icon.subarray(0, 8).equals(Buffer.from("\x89PNG\r\n\x1a\n", "latin1"));
    const output = path.join(tmpdir(), `aperto-icon-${randomUUID()}.${png ? "png" : "ico"}`);
    await writeFile(output, png ? icon : wrapIco(icon));
    return output;
  } catch {
    return null;
  } finally {
    await handle.close();
  }
}

async function read(handle: FileHandle, position: number, length: number) {
  // Resource data in game executables is small; anything larger is not an icon worth reading.
  if (length <= 0 || length > 16 * 1024 * 1024) throw new Error("Unexpected size");
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  if (bytesRead !== length) throw new Error("Truncated file");
  return buffer;
}

async function readIcon(handle: FileHandle): Promise<Buffer | null> {
  const dos = await read(handle, 0, 64);
  if (dos.toString("latin1", 0, 2) !== "MZ") return null;
  const pe = dos.readUInt32LE(0x3c);
  const header = await read(handle, pe, 24);
  if (header.toString("latin1", 0, 4) !== "PE\0\0") return null;
  const sectionCount = header.readUInt16LE(6);
  const optionalSize = header.readUInt16LE(20);
  const optional = await read(handle, pe + 24, optionalSize);
  const magic = optional.readUInt16LE(0);
  const directories = magic === 0x20b ? 112 : magic === 0x10b ? 96 : null;
  if (directories === null || optionalSize < directories + 24) return null;
  const resourceAddress = optional.readUInt32LE(directories + 16);
  if (!resourceAddress) return null;

  const table = await read(handle, pe + 24 + optionalSize, sectionCount * 40);
  const sections: Section[] = Array.from({ length: sectionCount }, (_, index) => ({
    size: table.readUInt32LE(index * 40 + 8),
    address: table.readUInt32LE(index * 40 + 12),
    rawSize: table.readUInt32LE(index * 40 + 16),
    offset: table.readUInt32LE(index * 40 + 20),
  }));
  const at = (address: number) => {
    const section = sections.find(
      (item) =>
        address >= item.address && address < item.address + Math.max(item.size, item.rawSize),
    );
    if (!section) throw new Error("Address outside every section");
    return section.offset + address - section.address;
  };
  const base = at(resourceAddress);

  /** Entries of the resource directory at `offset`, relative to the resource section. */
  const entries = async (offset: number) => {
    const directory = await read(handle, base + offset, 16);
    const count = directory.readUInt16LE(12) + directory.readUInt16LE(14);
    if (count > 4096) throw new Error("Implausible resource directory");
    if (!count) return [];
    const list = await read(handle, base + offset + 16, count * 8);
    return Array.from({ length: count }, (_, index) => {
      const name = list.readUInt32LE(index * 8);
      const target = list.readUInt32LE(index * 8 + 4);
      return {
        // Named entries have the high bit set; icons are looked up by numeric ID.
        id: name & 0x80000000 ? null : name,
        directory: (target & 0x80000000) !== 0,
        offset: target & 0x7fffffff,
      };
    });
  };
  /** The data of the first language under a type and name directory entry. */
  const data = async (entry: { directory: boolean; offset: number }) => {
    let current = entry;
    for (let depth = 0; current.directory; depth++) {
      if (depth > 2) throw new Error("Resource tree too deep");
      const [first] = await entries(current.offset);
      if (!first) return null;
      current = first;
    }
    const leaf = await read(handle, base + current.offset, 8);
    return read(handle, at(leaf.readUInt32LE(0)), leaf.readUInt32LE(4));
  };

  const types = await entries(0);
  const groups = types.find((type) => type.id === RT_GROUP_ICON && type.directory);
  const icons = types.find((type) => type.id === RT_ICON && type.directory);
  if (!groups || !icons) return null;
  const [group] = await entries(groups.offset);
  if (!group) return null;
  const directory = await data(group);
  if (!directory || directory.length < 6) return null;
  const count = Math.min(directory.readUInt16LE(4), Math.floor((directory.length - 6) / 14));
  const images = Array.from({ length: count }, (_, index) => {
    const entry = 6 + index * 14;
    return {
      // A width of 0 means 256 pixels.
      size: directory[entry]! || 256,
      depth: directory.readUInt16LE(entry + 6),
      id: directory.readUInt16LE(entry + 12),
    };
  }).sort((a, b) => b.size - a.size || b.depth - a.depth);
  const available = await entries(icons.offset);
  for (const image of images) {
    const entry = available.find((item) => item.id === image.id);
    if (entry) return data(entry);
  }
  return null;
}

/** Wraps one icon image, as stored in an executable, in an .ico file macOS can convert. */
function wrapIco(image: Buffer) {
  // Bitmap icons start with a BITMAPINFOHEADER whose height covers the image and its mask.
  const width = image.readInt32LE(4);
  const height = image.readInt32LE(8) / 2;
  const depth = image.readUInt16LE(14);
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header[6] = width >= 256 ? 0 : width;
  header[7] = height >= 256 ? 0 : height;
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(depth, 12);
  header.writeUInt32LE(image.length, 14);
  header.writeUInt32LE(22, 18);
  return Buffer.concat([header, image]);
}
