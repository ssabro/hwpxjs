import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import JSZip from "jszip";

import {
  detectFormat,
  parseHwp,
  hwpToText,
  hwpToHwpx,
  HwpInvalidFormatError,
  HwpUnsupportedError,
} from "../src/lib/hwp/index.js";
import HwpxReader from "../src/lib/hwpxReader.js";
import { readAllRecords } from "../src/lib/hwp/record.js";

function findFixture(name: string): string | null {
  const local = resolve("test/fixtures", name);
  if (existsSync(local)) return local;
  const docs = join(homedir(), "Documents", name);
  if (existsSync(docs)) return docs;
  return null;
}

describe("Robustness — malformed input", () => {
  it("rejects empty buffer", () => {
    expect(() => parseHwp(new Uint8Array(0))).toThrow();
  });

  it("rejects 1-byte buffer", () => {
    expect(() => parseHwp(new Uint8Array([0x42]))).toThrow();
  });

  it("rejects truncated CFB header", () => {
    // CFB 시그니처는 있지만 그 외 데이터 없음
    const data = new Uint8Array(64);
    data.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
    expect(() => parseHwp(data)).toThrow();
  });

  it("rejects HWP 3.0 with friendly message", () => {
    const data = new Uint8Array(512);
    data.set(new TextEncoder().encode("HWP Document File V3.00 "), 0);
    expect(() => parseHwp(data)).toThrow(HwpUnsupportedError);
    try {
      parseHwp(data);
    } catch (e) {
      expect((e as Error).message).toContain("HWP 3.0");
      expect((e as Error).message).toContain("HWP 5.0");
    }
  });

  it("classifies unknown format consistently", () => {
    expect(detectFormat(new Uint8Array(0))).toBe("unknown");
    expect(detectFormat(new Uint8Array([0xff, 0xff, 0xff, 0xff]))).toBe("unknown");
    expect(detectFormat(new TextEncoder().encode("plain text content"))).toBe("unknown");
  });

  it("readAllRecords handles trailing partial bytes (< 4)", () => {
    // 정상 레코드 1개 + 3바이트 패딩 — 정상 종료해야 함
    const head = new Uint8Array(4);
    new DataView(head.buffer).setUint32(0, 0x010, true); // tag=16, level=0, size=0
    const data = new Uint8Array(head.byteLength + 3);
    data.set(head, 0);
    data.set([0xab, 0xcd, 0xef], head.byteLength);
    const recs = readAllRecords(data);
    expect(recs).toHaveLength(1);
  });
});

describe("Robustness — HwpxReader with malformed/non-existent input", () => {
  it("getDocumentInfo throws HwpxNotLoadedError before load", async () => {
    const r = new HwpxReader();
    await expect(r.getDocumentInfo()).rejects.toThrow(/로드되지 않았/);
  });

  it("loadFromArrayBuffer rejects non-zip data", async () => {
    const r = new HwpxReader();
    const bad = new Uint8Array([1, 2, 3, 4, 5]).buffer as ArrayBuffer;
    await expect(r.loadFromArrayBuffer(bad)).rejects.toThrow();
  });
});

describe("Performance & scale (use large fixture if present)", () => {
  it("parses a >400KB HWP within 5s", async () => {
    const path = findFixture("여름휴가 안내문.hwp");
    if (!path) {
      // Skip silently
      return;
    }
    const buf = await readFile(path);
    const u8 = new Uint8Array(buf);
    const t0 = Date.now();
    const doc = parseHwp(u8);
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(5000);
    expect(doc.sections.length).toBeGreaterThan(0);
  });

  it("converts a >400KB HWP to HWPX in reasonable time", async () => {
    const path = findFixture("여름휴가 안내문.hwp");
    if (!path) return;
    const buf = await readFile(path);
    const t0 = Date.now();
    const out = await hwpToHwpx(new Uint8Array(buf));
    const elapsed = Date.now() - t0;
    expect(out.byteLength).toBeGreaterThan(10_000);
    expect(elapsed).toBeLessThan(10_000);
  });
});

describe("HWPX HTML round-trip with table merges", () => {
  it("preserves rowspan/colspan in HTML output", async () => {
    const path = findFixture("공고문(안)(26.4.24.).hwp");
    if (!path) return;
    const buf = await readFile(path);
    const hwpxBytes = await hwpToHwpx(new Uint8Array(buf));
    const r = new HwpxReader();
    const ab = hwpxBytes.buffer.slice(
      hwpxBytes.byteOffset,
      hwpxBytes.byteOffset + hwpxBytes.byteLength
    ) as ArrayBuffer;
    await r.loadFromArrayBuffer(ab);
    const html = await r.extractHtml({ embedImages: false });
    // 운행정지명령일 (rs=2/3) + 운행정지사유 (rs=5)
    expect(html).toMatch(/rowspan="2"/);
    expect(html).toMatch(/rowspan="3"/);
    expect(html).toMatch(/rowspan="5"/);
  });
});

describe("CFB BinData files round-trip via Map", () => {
  it("HwpDocument.binData has accessible bytes for each entry", async () => {
    const path = findFixture("여름휴가 안내문.hwp");
    if (!path) return;
    const buf = await readFile(path);
    const doc = parseHwp(new Uint8Array(buf));
    expect(doc.binData.size).toBeGreaterThan(0);
    for (const [, { data, extension }] of doc.binData) {
      expect(data.byteLength).toBeGreaterThan(0);
      expect(["png", "jpg", "jpeg", "gif", "bmp", "webp"]).toContain(extension);
    }
  });

  it("exported HWPX retains BinData files with correct mime in manifest", async () => {
    const path = findFixture("여름휴가 안내문.hwp");
    if (!path) return;
    const buf = await readFile(path);
    const hwpxBytes = await hwpToHwpx(new Uint8Array(buf));
    const zip = await JSZip.loadAsync(hwpxBytes);
    const manifest = await zip.file("META-INF/manifest.xml")!.async("string");
    const binPaths = Object.keys(zip.files).filter((p) => p.startsWith("BinData/") && !p.endsWith("/"));
    expect(binPaths.length).toBeGreaterThan(0);
    for (const p of binPaths) {
      expect(manifest).toContain(p);
      // mime 추정 (확장자 기반)
      const ext = p.split(".").pop()!.toLowerCase();
      const expectedMime =
        ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : null;
      if (expectedMime) {
        expect(manifest).toContain(expectedMime);
      }
    }
  });
});

describe("HwpInvalidFormatError typing", () => {
  it("error name matches", () => {
    try {
      parseHwp(new Uint8Array(512));
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(HwpInvalidFormatError);
      expect((e as Error).name).toBe("HwpInvalidFormatError");
    }
  });
});
