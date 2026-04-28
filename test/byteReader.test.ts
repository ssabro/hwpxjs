import { describe, expect, it } from "vitest";
import { ByteReader } from "../src/lib/hwp/byteReader.js";

describe("ByteReader", () => {
  it("reads u8/u16/u32 little-endian", () => {
    const data = new Uint8Array([0x42, 0x34, 0x12, 0x78, 0x56, 0x34, 0x12]);
    const r = new ByteReader(data);
    expect(r.readU8()).toBe(0x42);
    expect(r.readU16()).toBe(0x1234);
    expect(r.readU32()).toBe(0x12345678);
    expect(r.isEmpty()).toBe(true);
  });

  it("reads signed integers", () => {
    // -100 (i16 LE) = 0xFF9C → bytes 9C FF
    // -7200 (i32 LE) = 0xFFFFE3E0 → bytes E0 E3 FF FF
    const data = new Uint8Array([0x9c, 0xff, 0xe0, 0xe3, 0xff, 0xff]);
    const r = new ByteReader(data);
    expect(r.readI16()).toBe(-100);
    expect(r.readI32()).toBe(-7200);
  });

  it("reads HWP string (u16 charCount + UTF-16LE)", () => {
    // "한글" → 2 chars, U+D55C U+AE00
    const data = new Uint8Array([0x02, 0x00, 0x5c, 0xd5, 0x00, 0xae]);
    const r = new ByteReader(data);
    expect(r.readHwpString()).toBe("한글");
  });

  it("reads empty HWP string", () => {
    const r = new ByteReader(new Uint8Array([0x00, 0x00]));
    expect(r.readHwpString()).toBe("");
  });

  it("reads UTF-16 string of given char count", () => {
    // "ABC" UTF-16LE
    const data = new Uint8Array([0x41, 0x00, 0x42, 0x00, 0x43, 0x00]);
    const r = new ByteReader(data);
    expect(r.readUtf16(3)).toBe("ABC");
  });

  it("readBytes returns a copy that does not alias source buffer", () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const r = new ByteReader(data);
    const out = r.readBytes(3);
    expect(Array.from(out)).toEqual([1, 2, 3]);
    out[0] = 99;
    expect(data[0]).toBe(1); // 원본 불변
  });

  it("position/remaining advance correctly", () => {
    const r = new ByteReader(new Uint8Array(10));
    expect(r.position()).toBe(0);
    expect(r.remaining()).toBe(10);
    r.readU16();
    expect(r.position()).toBe(2);
    expect(r.remaining()).toBe(8);
  });

  it("throws on out-of-bounds reads", () => {
    const r = new ByteReader(new Uint8Array([1, 2]));
    r.readU16();
    expect(() => r.readU8()).toThrowError(/not enough bytes/);
  });
});
