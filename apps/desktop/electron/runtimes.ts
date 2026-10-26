import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { chmod, mkdir, open, realpath, rename, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Schema } from "effect";
import * as openpgp from "openpgp";
import yauzl from "yauzl";
import { compareVersions, type Release } from "../src/model";
import { exists, LibraryStore } from "./storage";
import { releaseKey } from "./nwjs-key";

const execute = promisify(execFile);
const IndexSchema = Schema.Struct({
  versions: Schema.Array(
    Schema.Struct({
      version: Schema.String,
      files: Schema.Array(Schema.String),
      flavors: Schema.Array(Schema.String),
      components: Schema.Struct({ chromium: Schema.String, node: Schema.String }),
    }),
  ),
});
const allowedHosts = new Set(["nwjs.io", "dl.nwjs.io", "dl.node-webkit.org"]);
export function validVersion(version: string) {
  if (!/^0\.\d+\.\d+$/.test(version) || compareVersions(version, "0.77.0") < 0)
    throw new Error("Choose an official macOS ARM64 release, version 0.77 or newer.");
  return version;
}

async function responseFor(url: string, signal: AbortSignal): Promise<Response> {
  for (let redirects = 0; redirects < 6; redirects++) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !allowedHosts.has(parsed.hostname))
      throw new Error("The runtime server redirected to an unsupported source.");
    const response = await fetch(url, { signal, redirect: "manual" });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error("The runtime server returned an invalid redirect.");
      url = new URL(location, url).href;
      continue;
    }
    if (!response.ok)
      throw new Error(
        `NW.js download server returned HTTP ${response.status}. Try again later; installed runtimes are unchanged.`,
      );
    return response;
  }
  throw new Error("Too many runtime download redirects.");
}

async function fetchText(url: string, signal: AbortSignal) {
  const response = await responseFor(url, signal);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty server response.");
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 16 * 1024 * 1024) throw new Error("Runtime metadata is too large.");
      parts.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(parts).toString("utf8");
}

export async function getReleases(): Promise<Release[]> {
  const index = Schema.decodeUnknownSync(IndexSchema)(
    JSON.parse(await fetchText("https://nwjs.io/versions.json", AbortSignal.timeout(30000))),
  );
  return index.versions
    .filter(
      (entry) =>
        /^v0\.\d+\.\d+$/.test(entry.version) &&
        compareVersions(entry.version, "0.77.0") >= 0 &&
        entry.files.includes("osx-arm64") &&
        entry.flavors.includes("normal"),
    )
    .map((entry) => ({ version: entry.version.slice(1), ...entry.components }))
    .sort((a, b) => compareVersions(b.version, a.version));
}

export async function verifyManifest(text: string, signature: string): Promise<void> {
  const key = await openpgp.readKey({ armoredKey: releaseKey });
  if (key.getFingerprint().toUpperCase() !== "1E8BEE8D5B0C4CBCD6D19E2678680FA9E21BB40A")
    throw new Error("Unexpected NW.js signing key.");
  const result = await openpgp.verify({
    message: await openpgp.createMessage({ binary: Buffer.from(text, "utf8") }),
    signature: await openpgp.readSignature({ armoredSignature: signature }),
    verificationKeys: key,
  });
  if (!result.signatures.length) throw new Error("The runtime checksum manifest is not signed.");
  await result.signatures[0]!.verified;
}

export function archiveDigest(manifest: string, filename: string): string {
  const matches = manifest
    .split(/\r?\n/)
    .map((line) => /^([a-fA-F0-9]{64})\s+\*?(.+)$/.exec(line))
    .filter((entry) => entry?.[2] === filename);
  if (matches.length !== 1)
    throw new Error("The signed manifest does not contain exactly one checksum for this runtime.");
  return matches[0]![1]!.toLowerCase();
}

export async function extractRuntime(zipFile: string, destination: string) {
  await mkdir(destination, { recursive: true });
  destination = await realpath(destination);
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.open(
      zipFile,
      { lazyEntries: true, autoClose: false, strictFileNames: true },
      (error, value) => (error ? reject(error) : resolve(value!)),
    ),
  );
  const links: { file: string; target: string }[] = [];
  const names = new Set<string>();
  let total = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      zip.on("error", reject);
      zip.on("end", resolve);
      zip.on("entry", (entry: yauzl.Entry) => {
        const extract = async () => {
          total += entry.uncompressedSize;
          if (total > 3 * 1024 ** 3 || names.size > 100000)
            throw new Error("Runtime archive exceeds extraction limits.");
          const name = entry.fileName;
          const file = path.resolve(destination, name);
          const normalized = name.replace(/\/$/, "").normalize("NFC").toLowerCase();
          if (!file.startsWith(`${destination}${path.sep}`) || names.has(normalized))
            throw new Error("Runtime archive contains conflicting or escaping paths.");
          names.add(normalized);
          const mode = entry.externalFileAttributes >>> 16;
          const kind = mode & 0o170000;
          if (name.endsWith("/")) {
            await mkdir(file, { recursive: true });
            return;
          }
          if (kind && kind !== 0o100000 && kind !== 0o120000)
            throw new Error("Unsupported runtime archive entry.");
          await mkdir(path.dirname(file), { recursive: true });
          const stream = await new Promise<NodeJS.ReadableStream>((resolveStream, rejectStream) =>
            zip.openReadStream(entry, (error, value) =>
              error ? rejectStream(error) : resolveStream(value!),
            ),
          );
          if (kind === 0o120000) {
            if (entry.uncompressedSize > 4096) throw new Error("Invalid runtime symlink.");
            const chunks: Buffer[] = [];
            for await (const chunk of stream) chunks.push(Buffer.from(chunk));
            const target = Buffer.concat(chunks).toString("utf8");
            const resolved = path.resolve(path.dirname(file), target);
            if (path.isAbsolute(target) || !resolved.startsWith(`${destination}${path.sep}`))
              throw new Error("Runtime symlink escapes its installation.");
            links.push({ file, target });
          } else {
            await pipeline(
              stream,
              createWriteStream(file, { flags: "wx", mode: mode & 0o111 ? 0o755 : 0o644 }),
            );
          }
        };
        void extract().then(() => zip.readEntry(), reject);
      });
      zip.readEntry();
    });
    for (const link of links) await symlink(link.target, link.file);
    for (const link of links) {
      if (!(await realpath(link.file)).startsWith(`${destination}${path.sep}`))
        throw new Error("Runtime symlink escapes its installation.");
    }
  } finally {
    zip.close();
  }
}

export function runtimeExecutable(directory: string, version: string) {
  return path.join(
    directory,
    "runtimes",
    validVersion(version),
    `nwjs-v${version}-osx-arm64`,
    "nwjs.app",
    "Contents",
    "MacOS",
    "nwjs",
  );
}

export class RuntimeManager {
  readonly downloads = new Map<string, { controller: AbortController; detail: string }>();
  constructor(
    private readonly store: LibraryStore,
    private readonly changed: () => void,
  ) {}

  async install(version: string) {
    validVersion(version);
    if (this.downloads.has(version)) throw new Error("This runtime is already downloading.");
    if (
      this.store.value.runtimes.some((runtime) => runtime.version === version) &&
      (await exists(runtimeExecutable(this.store.directory, version)))
    )
      return;
    const controller = new AbortController();
    const download = { controller, detail: "Checking signed release metadata…" };
    this.downloads.set(version, download);
    this.changed();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15 * 60 * 1000)]);
    const staging = path.join(this.store.directory, "downloads", randomUUID());
    try {
      await mkdir(staging, { recursive: true });
      const base = `https://dl.nwjs.io/v${version}`;
      const filename = `nwjs-v${version}-osx-arm64.zip`;
      const [manifest, signature] = await Promise.all([
        fetchText(`${base}/SHASUMS256.txt`, signal),
        fetchText(`${base}/SHASUMS256.txt.asc`, signal),
      ]);
      await verifyManifest(manifest, signature);
      const expected = archiveDigest(manifest, filename);
      const response = await responseFor(`${base}/${filename}`, signal);
      const reader = response.body?.getReader();
      if (!reader) throw new Error("The runtime download was empty.");
      const archive = path.join(staging, filename);
      const handle = await open(archive, "wx", 0o600);
      const hash = createHash("sha256");
      let received = 0;
      let lastUpdate = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.length;
          if (received > 1024 ** 3) throw new Error("Runtime download exceeds 1 GB.");
          hash.update(value);
          await handle.writeFile(value);
          if (received - lastUpdate > 1024 ** 2) {
            download.detail = `Downloading · ${Math.round(received / 1024 ** 2)} MB`;
            lastUpdate = received;
            this.changed();
          }
        }
      } finally {
        await handle.close();
        await reader.cancel();
      }
      if (hash.digest("hex") !== expected)
        throw new Error("Runtime checksum mismatch. The download was discarded.");
      download.detail = "Extracting and checking runtime…";
      this.changed();
      const extracted = path.join(staging, "extracted");
      await extractRuntime(archive, extracted);
      signal.throwIfAborted();
      const executable = path.join(
        extracted,
        `nwjs-v${version}-osx-arm64`,
        "nwjs.app",
        "Contents",
        "MacOS",
        "nwjs",
      );
      const architecture = await execute("/usr/bin/file", [executable]);
      if (!architecture.stdout.includes("arm64"))
        throw new Error("The downloaded runtime is not an ARM64 application.");
      const plist = path.join(path.dirname(executable), "..", "Info.plist");
      const minimum = await execute("/usr/libexec/PlistBuddy", [
        "-c",
        "Print :LSMinimumSystemVersion",
        plist,
      ]);
      const current = await execute("/usr/bin/sw_vers", ["-productVersion"]);
      if (compareVersions(current.stdout.trim(), minimum.stdout.trim()) < 0) {
        throw new Error(
          `This runtime requires macOS ${minimum.stdout.trim()}. Choose an older version.`,
        );
      }
      await chmod(executable, 0o755);
      const destination = path.join(this.store.directory, "runtimes", version);
      await mkdir(path.dirname(destination), { recursive: true });
      if (await exists(destination))
        throw new Error(
          "An unregistered runtime folder already exists. Remove it before reinstalling this version.",
        );
      await rename(extracted, destination);
      try {
        await this.store.update((state) => ({
          ...state,
          runtimes: [
            ...state.runtimes.filter((runtime) => runtime.version !== version),
            { version, installedAt: new Date().toISOString(), sha256: expected },
          ],
          games: state.games.map((game) =>
            !game.runtime && !game.removed ? { ...game, runtime: version } : game,
          ),
        }));
      } catch (error) {
        await rm(destination, { recursive: true, force: true });
        throw error;
      }
    } finally {
      await rm(staging, { recursive: true, force: true });
      this.downloads.delete(version);
      this.changed();
    }
  }
}
