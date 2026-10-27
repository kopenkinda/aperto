import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { digest } from "./storage";

const running = new Map<string, Promise<unknown>>();

/** Runs `work` once per key at a time; callers that ask while it runs share its result. */
export function shared<T>(key: string, work: () => Promise<T>): Promise<T> {
  let task = running.get(key) as Promise<T> | undefined;
  if (!task) {
    task = work().finally(() => running.delete(key));
    running.set(key, task);
  }
  return task;
}

/**
 * Installs a download into `folder` once and returns what its build recorded in the folder's
 * `.installed` marker. The build fills a temporary folder that replaces `folder` only when it
 * finishes, so an interrupted download never looks installed. Concurrent requests share a build.
 */
export function installOnce(
  folder: string,
  build: (partial: string) => Promise<string | void>,
): Promise<string> {
  return shared(folder, async () => {
    const installed = await readFile(path.join(folder, ".installed"), "utf8").catch(() => null);
    if (installed !== null) return installed;
    const partial = `${folder}.${randomUUID()}.partial`;
    try {
      const record = (await build(partial)) ?? "";
      await mkdir(partial, { recursive: true });
      await writeFile(path.join(partial, ".installed"), record);
      await rm(folder, { recursive: true, force: true });
      await rename(partial, folder);
      return record;
    } finally {
      await rm(partial, { recursive: true, force: true });
    }
  });
}

/** Downloads a file pinned to a SHA-256 hash, refusing anything else. */
export async function fetchPinned(url: string, hash: string, label: string): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
  if (!response?.ok) throw new Error(`The ${label} could not be downloaded. Try again.`);
  const data = Buffer.from(await response.arrayBuffer());
  if (digest(data) !== hash)
    throw new Error(`The downloaded ${label} did not match the expected file.`);
  return data;
}
