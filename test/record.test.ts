import { describe, expect, it } from "vitest";
import { readAllRecords, RecordError } from "../src/lib/hwp/record.js";
import { HWPTAG_PARA_HEADER, HWPTAG_PARA_TEXT, HWPTAG_DOCUMENT_PROPERTIES } from "../src/lib/hwp/tags.js";

function makeRecord(tagId: number, level: number, payload: Uint8Array): Uint8Array {
  const size = payload.byteLength;
  if (size >= 0xfff) throw new Error("use makeExtendedRecord for large payloads");
  const header = (tagId & 0x3ff) | ((level & 0x3ff) << 10) | (size << 20);
  const out = new Uint8Array(4 + size);
  new DataView(out.buffer).setUint32(0, header, true);
  out.set(payload, 4);
  return out;
}

function makeExtendedRecord(tagId: number, level: number, payload: Uint8Array): Uint8Array {
  const size = payload.byteLength;
  const header = (tagId & 0x3ff) | ((level & 0x3ff) << 10) | (0xfff << 20);
  const out = new Uint8Array(8 + size);
  const v = new DataView(out.buffer);
  v.setUint32(0, header, true);
  v.setUint32(4, size, true);
  out.set(payload, 8);
  return out;
}

describe("readAllRecords", () => {
  it("parses a single small record", () => {
    const data = makeRecord(HWPTAG_PARA_HEADER, 0, new Uint8Array([1, 2, 3, 4]));
    const recs = readAllRecords(data);
    expect(recs).toHaveLength(1);
    expect(recs[0].tagId).toBe(HWPTAG_PARA_HEADER);
    expect(recs[0].level).toBe(0);
    expect(recs[0].size).toBe(4);
    expect(Array.from(recs[0].data)).toEqual([1, 2, 3, 4]);
  });

  it("parses multiple records preserving order and level", () => {
    const a = makeRecord(HWPTAG_PARA_HEADER, 0, new Uint8Array([1, 2]));
    const b = makeRecord(HWPTAG_PARA_TEXT, 1, new Uint8Array([3, 4, 5]));
    const data = new Uint8Array(a.byteLength + b.byteLength);
    data.set(a, 0);
    data.set(b, a.byteLength);
    const recs = readAllRecords(data);
    expect(recs).toHaveLength(2);
    expect(recs[0].tagId).toBe(HWPTAG_PARA_HEADER);
    expect(recs[0].level).toBe(0);
    expect(recs[1].tagId).toBe(HWPTAG_PARA_TEXT);
    expect(recs[1].level).toBe(1);
  });

  it("handles extended-size records (size > 4095)", () => {
    const big = new Uint8Array(5000).fill(0xaa);
    const data = makeExtendedRecord(HWPTAG_PARA_TEXT, 0, big);
    const recs = readAllRecords(data);
    expect(recs).toHaveLength(1);
    expect(recs[0].size).toBe(5000);
    expect(recs[0].data.byteLength).toBe(5000);
  });

  it("returns empty array for empty input", () => {
    expect(readAllRecords(new Uint8Array(0))).toHaveLength(0);
  });

  it("handles zero-size record", () => {
    const data = makeRecord(HWPTAG_DOCUMENT_PROPERTIES, 0, new Uint8Array(0));
    const recs = readAllRecords(data);
    expect(recs).toHaveLength(1);
    expect(recs[0].size).toBe(0);
  });

  it("throws on truncated payload", () => {
    // 헤더는 100바이트라고 선언하지만 실제로는 2바이트만
    const header = (HWPTAG_PARA_TEXT & 0x3ff) | (100 << 20);
    const out = new Uint8Array(4 + 2);
    new DataView(out.buffer).setUint32(0, header, true);
    out[4] = 1;
    out[5] = 2;
    expect(() => readAllRecords(out)).toThrow(RecordError);
  });
});
