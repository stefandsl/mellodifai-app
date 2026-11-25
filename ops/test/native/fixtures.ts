import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";
import { afterEach } from "vitest";
import { testTempBase } from "../temp-base.js";

const owned: string[] = [];
export function fixture(): string {
  const dir = mkdtempSync(join(testTempBase(), "native-test-"));
  owned.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of owned.splice(0)) {
    if (!resolve(dir).includes(`${sep}native-test-`))
      throw new Error("Not a test directory");
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Tiny independent ZIP fixture writer, including real zip64 records. */
export function zip(
  name: string,
  text: string,
  method = 0,
  zip64 = false,
): Buffer {
  const filename = Buffer.from(name);
  const data = Buffer.from(text);
  const packed = method === 8 ? deflateRawSync(data) : data;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(crc32(data), 14);
  local.writeUInt32LE(packed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(filename.length, 26);
  const extra = Buffer.alloc(zip64 ? 28 : 0);
  if (zip64) {
    extra.writeUInt16LE(1);
    extra.writeUInt16LE(24, 2);
    extra.writeBigUInt64LE(BigInt(data.length), 4);
    extra.writeBigUInt64LE(BigInt(packed.length), 12);
    extra.writeBigUInt64LE(0n, 20);
  }
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(crc32(data), 16);
  central.writeUInt32LE(zip64 ? 0xffffffff : packed.length, 20);
  central.writeUInt32LE(zip64 ? 0xffffffff : data.length, 24);
  central.writeUInt16LE(filename.length, 28);
  central.writeUInt16LE(extra.length, 30);
  central.writeUInt32LE(zip64 ? 0xffffffff : 0, 42);
  const offset = local.length + filename.length + packed.length;
  const size = central.length + filename.length + extra.length;
  const record = Buffer.alloc(zip64 ? 76 : 0);
  if (zip64) {
    record.writeUInt32LE(0x06064b50);
    record.writeBigUInt64LE(44n, 4);
    record.writeBigUInt64LE(1n, 24);
    record.writeBigUInt64LE(1n, 32);
    record.writeBigUInt64LE(BigInt(size), 40);
    record.writeBigUInt64LE(BigInt(offset), 48);
    record.writeUInt32LE(0x07064b50, 56);
    record.writeBigUInt64LE(BigInt(offset + size), 64);
    record.writeUInt32LE(1, 72);
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(zip64 ? 0xffff : 1, 8);
  end.writeUInt16LE(zip64 ? 0xffff : 1, 10);
  end.writeUInt32LE(zip64 ? 0xffffffff : size, 12);
  end.writeUInt32LE(zip64 ? 0xffffffff : offset, 16);
  return Buffer.concat([
    local,
    filename,
    packed,
    central,
    filename,
    extra,
    record,
    end,
  ]);
}
