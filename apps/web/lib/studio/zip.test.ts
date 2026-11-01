import { describe, expect, it } from "vitest";

import { crc32, dosDateTime, zipStored } from "./zip";

const bytes = (text: string) => new TextEncoder().encode(text);

// Reads the archive back through its central directory, as an unzip tool does.
function unzip(archive: Uint8Array) {
  const view = new DataView(
    archive.buffer,
    archive.byteOffset,
    archive.byteLength,
  );
  const end = archive.byteLength - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files: { name: string; data: string; flags: number }[] = [];
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const offset = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(
      archive.subarray(at + 46, at + 46 + nameLength),
    );
    expect(method).toBe(0);
    expect(view.getUint32(offset, true)).toBe(0x04034b50);
    // The local header says the same as the central record.
    expect(view.getUint16(offset + 6, true)).toBe(flags);
    expect(view.getUint32(offset + 14, true)).toBe(crc);
    const start = offset + 30 + view.getUint16(offset + 26, true);
    const data = archive.subarray(start, start + size);
    expect(crc32(data)).toBe(crc);
    files.push({ name, data: new TextDecoder().decode(data), flags });
    at += 46 + nameLength;
  }
  return files;
}

describe("zip", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(bytes("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it("stores every file with its UTF-8 name, in order, readable back", () => {
    const files = unzip(
      zipStored([
        { name: "Solo un caffè - Voce.mp3", data: bytes("voce") },
        { name: "Batteria.mp3", data: bytes("batteria!") },
      ]),
    );
    expect(files.map((file) => [file.name, file.data])).toEqual([
      ["Solo un caffè - Voce.mp3", "voce"],
      ["Batteria.mp3", "batteria!"],
    ]);
    expect(files.every((file) => file.flags === 0x0800)).toBe(true);
  });

  it("writes an empty archive as just the end record", () => {
    expect(zipStored([]).byteLength).toBe(22);
  });

  it("encodes MS-DOS dates", () => {
    expect(dosDateTime(new Date(2026, 10, 1, 14, 30, 59))).toEqual({
      time: (14 << 11) | (30 << 5) | 29,
      date: ((2026 - 1980) << 9) | (11 << 5) | 1,
    });
    expect(dosDateTime(new Date(1975, 0, 1)).date >> 9).toBe(0);
  });
});
