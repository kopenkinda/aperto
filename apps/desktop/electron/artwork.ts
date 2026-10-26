import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

export const MAX_ARTWORK_BYTES = 24 * 1024 * 1024;

/** The file extension for PNG, JPEG, or WebP data, judged by its first bytes. */
export function imageExtension(data: Uint8Array): "png" | "jpg" | "webp" | null {
  const ascii = (start: number, end: number) =>
    Buffer.from(data.subarray(start, end)).toString("latin1");
  if (data[0] === 0x89 && ascii(1, 4) === "PNG") return "png";
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "jpg";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  return null;
}

/** Downloads an image to a temporary file and returns its path. The caller removes the file. */
export async function downloadImage(url: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error("Enter a full image address, starting with https://.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
    throw new Error("Enter a full image address, starting with https://.");
  const response = await fetch(parsed, { signal: AbortSignal.timeout(30_000) }).catch(() => {
    throw new Error("The image could not be downloaded. Check the address and your connection.");
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`The image server returned HTTP ${response.status}.`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The image server sent an empty response.");
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MAX_ARTWORK_BYTES) throw new Error("The image is larger than 24 MB.");
      parts.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const data = Buffer.concat(parts);
  const file = path.join(
    tmpdir(),
    `aperto-artwork-${randomUUID()}.${imageExtension(data) ?? "download"}`,
  );
  await writeFile(file, data);
  return file;
}

/**
 * Returns the image as a PNG, JPEG, or WebP file. Other formats, such as the AVIF that some
 * servers send even for `.jpeg` addresses, are converted to a temporary PNG with macOS `sips`,
 * which the caller removes. Returns null when the file is not an image macOS can read.
 */
export async function readableImage(
  file: string,
): Promise<{ file: string; temporary: boolean } | null> {
  const head = await readFile(file).then((data) => data.subarray(0, 16));
  const extension = imageExtension(head);
  if (extension && path.extname(file).slice(1).toLowerCase().replace("jpeg", "jpg") === extension)
    return { file, temporary: false };
  const output = path.join(tmpdir(), `aperto-artwork-${randomUUID()}.png`);
  try {
    await execute("/usr/bin/sips", ["-s", "format", "png", file, "--out", output]);
    return { file: output, temporary: true };
  } catch {
    await rm(output, { force: true });
    return null;
  }
}
