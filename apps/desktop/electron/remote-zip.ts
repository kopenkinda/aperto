import { Readable } from "node:stream";
import yauzl from "yauzl";

const chunkSize = 4 * 1024 * 1024;

/**
 * Reads a zip archive on a web server through HTTP range requests, so only the entries that are
 * extracted are downloaded. Reads go through 4 MB chunks, and the latest few are kept, since an
 * archive's entries are read in order and neighbouring small files share a chunk.
 */
class RangeReader extends yauzl.RandomAccessReader {
  private readonly chunks = new Map<number, Promise<Buffer>>();

  constructor(
    private readonly url: string,
    private readonly size: number,
    private readonly signal: AbortSignal,
  ) {
    super();
  }

  private chunk(index: number) {
    let chunk = this.chunks.get(index);
    if (chunk) {
      // Most recently used last, so the oldest is evicted first.
      this.chunks.delete(index);
    } else {
      const start = index * chunkSize;
      const end = Math.min(start + chunkSize, this.size) - 1;
      chunk = fetch(this.url, { headers: { Range: `bytes=${start}-${end}` }, signal: this.signal })
        .then(async (response) => {
          if (response.status !== 206)
            throw new Error(`The download server returned HTTP ${response.status}.`);
          const data = Buffer.from(await response.arrayBuffer());
          if (data.length !== end - start + 1) throw new Error("The download was cut short.");
          return data;
        })
        .catch((error: unknown) => {
          this.chunks.delete(index);
          throw error;
        });
    }
    this.chunks.set(index, chunk);
    while (this.chunks.size > 8) this.chunks.delete(this.chunks.keys().next().value!);
    return chunk;
  }

  private async *range(start: number, end: number) {
    for (let position = start; position < end;) {
      const index = Math.floor(position / chunkSize);
      const data = await this.chunk(index);
      const offset = position - index * chunkSize;
      const piece = data.subarray(offset, Math.min(data.length, offset + end - position));
      position += piece.length;
      yield piece;
    }
  }

  override _readStreamForRange(start: number, end: number) {
    return Readable.from(this.range(start, end));
  }
}

/** Opens a zip archive at an HTTPS address that supports range requests. */
export async function openRemoteZip(url: string, signal: AbortSignal): Promise<yauzl.ZipFile> {
  const head = await fetch(url, { method: "HEAD", signal });
  const size = Number(head.headers.get("content-length"));
  if (!head.ok || !Number.isSafeInteger(size) || size <= 0)
    throw new Error(`The download server returned HTTP ${head.status}.`);
  if (head.headers.get("accept-ranges") !== "bytes")
    throw new Error("The download server does not support partial downloads.");
  return new Promise((resolve, reject) =>
    yauzl.fromRandomAccessReader(
      new RangeReader(url, size, signal),
      size,
      { lazyEntries: true, autoClose: false, strictFileNames: true },
      (error, zip) => (error ? reject(error) : resolve(zip!)),
    ),
  );
}
