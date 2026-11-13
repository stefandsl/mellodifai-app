import {
  chmodSync,
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { crc32, inflateRawSync } from "node:zlib";

/** Minimal reader for the stored and deflated zip archives the manifest pins.
 * It exists so extraction can refuse hostile entry names before a single byte
 * is written, and so no unverified third-party extractor runs on a download.
 */
export interface ZipEntry {
  name: string;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  offset: number;
  mode: number;
  directory: boolean;
}

export interface ExtractOptions {
  /** Leading path segments to drop, like tar --strip-components. */
  strip?: number;
  /** Keep only paths equal to an item or below an item ending in "/". */
  include?: string[];
  /** Drop paths equal to an item or below an item ending in "/". */
  exclude?: string[];
}

const MAX_ENTRY_BYTES = 1024 ** 3;
const EOCD = 0x06054b50;
const EOCD64_LOCATOR = 0x07064b50;
const EOCD64 = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

function read(fd: number, position: number, length: number): Buffer {
  const buffer = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const count = readSync(fd, buffer, done, length - done, position + done);
    if (count === 0) throw new Error("Truncated zip archive");
    done += count;
  }
  return buffer;
}

function safeNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Zip archive is too large");
  return Number(value);
}

export function readZipEntries(fd: number): ZipEntry[] {
  const size = fstatSync(fd).size;
  const tailLength = Math.min(size, 22 + 0xffff);
  const tail = read(fd, size - tailLength, tailLength);
  let at = -1;
  for (let index = tail.length - 22; index >= 0; index--)
    if (tail.readUInt32LE(index) === EOCD) {
      at = index;
      break;
    }
  if (at < 0) throw new Error("Not a zip archive");
  let count = tail.readUInt16LE(at + 10);
  let directorySize = tail.readUInt32LE(at + 12);
  let directoryOffset = tail.readUInt32LE(at + 16);
  if (
    count === 0xffff ||
    directorySize === 0xffffffff ||
    directoryOffset === 0xffffffff
  ) {
    const locatorAt = size - tailLength + at - 20;
    if (locatorAt < 0) throw new Error("Invalid zip64 archive");
    const locator = read(fd, locatorAt, 20);
    if (locator.readUInt32LE(0) !== EOCD64_LOCATOR)
      throw new Error("Invalid zip64 archive");
    const record = read(fd, safeNumber(locator.readBigUInt64LE(8)), 56);
    if (record.readUInt32LE(0) !== EOCD64)
      throw new Error("Invalid zip64 archive");
    count = safeNumber(record.readBigUInt64LE(32));
    directorySize = safeNumber(record.readBigUInt64LE(40));
    directoryOffset = safeNumber(record.readBigUInt64LE(48));
  }
  if (directoryOffset + directorySize > size)
    throw new Error("Invalid zip central directory");
  const directory = read(fd, directoryOffset, directorySize);
  const entries: ZipEntry[] = [];
  let cursor = 0;
  for (let index = 0; index < count; index++) {
    if (
      cursor + 46 > directory.length ||
      directory.readUInt32LE(cursor) !== CENTRAL
    )
      throw new Error("Invalid zip central directory");
    const madeBy = directory.readUInt16LE(cursor + 4);
    const flags = directory.readUInt16LE(cursor + 8);
    const nameLength = directory.readUInt16LE(cursor + 28);
    const extraLength = directory.readUInt16LE(cursor + 30);
    const commentLength = directory.readUInt16LE(cursor + 32);
    const attributes = directory.readUInt32LE(cursor + 38);
    let compressedSize = directory.readUInt32LE(cursor + 20);
    let fullSize = directory.readUInt32LE(cursor + 24);
    let offset = directory.readUInt32LE(cursor + 42);
    const nameEnd = cursor + 46 + nameLength;
    const name = directory
      .subarray(cursor + 46, nameEnd)
      .toString(flags & 0x800 ? "utf8" : "latin1");
    const extraEnd = nameEnd + extraLength;
    for (let extra = nameEnd; extra + 4 <= extraEnd; ) {
      const id = directory.readUInt16LE(extra);
      const length = directory.readUInt16LE(extra + 2);
      if (id === 1) {
        let field = extra + 4;
        const next = () => {
          const value = safeNumber(directory.readBigUInt64LE(field));
          field += 8;
          return value;
        };
        if (fullSize === 0xffffffff) fullSize = next();
        if (compressedSize === 0xffffffff) compressedSize = next();
        if (offset === 0xffffffff) offset = next();
      }
      extra += 4 + length;
    }
    if (flags & 1) throw new Error("Encrypted zip entries are refused");
    entries.push({
      name,
      method: directory.readUInt16LE(cursor + 10),
      crc: directory.readUInt32LE(cursor + 16),
      compressedSize,
      size: fullSize,
      offset,
      mode: madeBy >>> 8 === 3 ? attributes >>> 16 : 0,
      directory: name.endsWith("/") || name.endsWith("\\"),
    });
    cursor = extraEnd + commentLength;
  }
  return entries;
}

/** Relative target of an entry, or null when strip removes it entirely.
 * Refuses anything that could leave the extraction root on any platform:
 * absolute paths, drive letters, parent segments, NUL bytes and ":" (which
 * names an NTFS alternate data stream).
 */
export function safeEntryPath(name: string, strip = 0): string | null {
  const normalized = name.replaceAll("\\", "/");
  if (
    normalized.includes("\0") ||
    normalized.includes(":") ||
    normalized.startsWith("/")
  )
    throw new Error("Archive entry escapes the extraction root");
  const segments = normalized
    .split("/")
    .filter((part) => part !== "" && part !== ".");
  if (segments.some((part) => part === ".." || /[. ]$/.test(part)))
    throw new Error("Archive entry escapes the extraction root");
  const kept = segments.slice(strip);
  return kept.length ? kept.join("/") : null;
}

function selected(path: string, options: ExtractOptions): boolean {
  const matches = (rule: string) =>
    rule.endsWith("/") ? path.startsWith(rule) : path === rule;
  if (options.include && !options.include.some(matches)) return false;
  return !options.exclude?.some(matches);
}

function entryBytes(fd: number, entry: ZipEntry): Buffer {
  if (entry.size > MAX_ENTRY_BYTES || entry.compressedSize > MAX_ENTRY_BYTES)
    throw new Error("Zip entry exceeds the extraction size limit");
  const header = read(fd, entry.offset, 30);
  if (header.readUInt32LE(0) !== LOCAL)
    throw new Error("Invalid zip local header");
  const start =
    entry.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  const packed = read(fd, start, entry.compressedSize);
  let data: Buffer;
  if (entry.method === 0) data = packed;
  else if (entry.method === 8)
    // zlib refuses a zero output limit; the length check below still applies.
    data = inflateRawSync(packed, { maxOutputLength: Math.max(entry.size, 1) });
  else throw new Error("Unsupported zip compression method");
  if (data.length !== entry.size || crc32(data) !== entry.crc)
    throw new Error("Zip entry failed its integrity check");
  return data;
}

/** Extract into an existing, empty directory. Every entry name is validated
 * before anything is written; symbolic links are written as plain files.
 */
export function extractZip(
  archive: string,
  destination: string,
  options: ExtractOptions = {},
): string[] {
  const root = resolve(destination);
  const fd = openSync(archive, "r");
  try {
    const plan: { entry: ZipEntry; path: string }[] = [];
    for (const entry of readZipEntries(fd)) {
      const path = safeEntryPath(entry.name, options.strip);
      if (path === null || !selected(path, options)) continue;
      const target = resolve(root, path);
      const rel = relative(root, target);
      if (rel === "" || rel.startsWith(`..${sep}`) || isAbsolute(rel))
        throw new Error("Archive entry escapes the extraction root");
      plan.push({ entry, path });
    }
    const written: string[] = [];
    for (const { entry, path } of plan) {
      const target = join(root, path);
      if (entry.directory) {
        mkdirSync(target, { recursive: true });
        continue;
      }
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, entryBytes(fd, entry), { flag: "wx" });
      if (process.platform !== "win32" && entry.mode & 0o111)
        chmodSync(target, 0o755);
      written.push(path);
    }
    return written;
  } finally {
    closeSync(fd);
  }
}
