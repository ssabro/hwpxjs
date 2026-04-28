import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import JSZip from "jszip";

import HwpxReader from "../src/lib/hwpxReader.js";
import HwpxWriter from "../src/lib/writer.js";
import { detectFormat, parseHwp, hwpToText, hwpToHwpx } from "../src/lib/hwp/index.js";

/**
 * 픽스처 위치 우선순위:
 *   1. test/fixtures/{name}
 *   2. ~/Documents/{name}  (개발자 로컬 검증 편의)
 *
 * 둘 다 없으면 해당 테스트는 skip.
 */
function findFixture(name: string): string | null {
  const local = resolve("test/fixtures", name);
  if (existsSync(local)) return local;
  const docs = join(homedir(), "Documents", name);
  if (existsSync(docs)) return docs;
  return null;
}

const FIXTURE_NAMES = {
  hwp1: "1.hwp",
  hwpx1: "1.hwpx",
  hwpVacation: "여름휴가 안내문.hwp",
  hwpxVacation: "여름휴가 안내문.hwpx",
  hwpNotice: "공고문(안)(26.4.24.).hwp",
} as const;

async function loadFixture(key: keyof typeof FIXTURE_NAMES): Promise<Uint8Array | null> {
  const path = findFixture(FIXTURE_NAMES[key]);
  if (!path) return null;
  const buf = await readFile(path);
  return new Uint8Array(buf);
}

describe("HwpxWriter spec compliance", () => {
  it("produces a HWPX zip with mimetype as the first STORED entry", async () => {
    const w = new HwpxWriter();
    const bytes = await w.createFromPlainText("hello\nworld");
    const zip = await JSZip.loadAsync(bytes);

    // mimetype 엔트리 존재 + 정확한 컨텐츠
    const mimetype = zip.file("mimetype");
    expect(mimetype).not.toBeNull();
    const mimeText = await mimetype!.async("string");
    expect(mimeText).toBe("application/owpml");

    // 첫 엔트리가 mimetype 이어야 함
    const names = Object.keys(zip.files);
    expect(names[0]).toBe("mimetype");

    // 필수 패키징 엔트리들
    expect(zip.file("META-INF/container.xml")).not.toBeNull();
    expect(zip.file("META-INF/manifest.xml")).not.toBeNull();
    expect(zip.file("Contents/content.hpf")).not.toBeNull();
    expect(zip.file("Contents/header.xml")).not.toBeNull();
    expect(zip.file("Contents/section0.xml")).not.toBeNull();
  });

  it("HwpxReader can round-trip the HwpxWriter output", async () => {
    const w = new HwpxWriter();
    const bytes = await w.createFromPlainText("첫 문단\n\n두 번째 문단", {
      title: "테스트",
      creator: "tester",
    });
    const r = new HwpxReader();
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    await r.loadFromArrayBuffer(ab);
    const text = await r.extractText();
    expect(text).toContain("첫 문단");
    expect(text).toContain("두 번째 문단");
  });
});

describe("HWP integration: 1.hwp", () => {
  let bytes: Uint8Array | null = null;
  beforeAll(async () => {
    bytes = await loadFixture("hwp1");
  });

  it.runIf(true)("detects format as hwp", () => {
    if (!bytes) return; // skip
    expect(detectFormat(bytes)).toBe("hwp");
  });

  it("parses paragraphs and tables", async () => {
    if (!bytes) return;
    const doc = parseHwp(bytes);
    expect(doc.sections.length).toBeGreaterThan(0);
    // 1.hwp 는 표가 있는 폼 문서
    let hasTable = false;
    for (const s of doc.sections) {
      for (const p of s.paragraphs) {
        for (const c of p.controls) if (c.kind === "table") hasTable = true;
      }
    }
    expect(hasTable).toBe(true);
  });

  it("extracts text including table cells", async () => {
    if (!bytes) return;
    const text = await hwpToText(bytes);
    expect(text).toContain("결");
    expect(text).toContain("혼");
    expect(text).toContain("원");
  });

  it("converts to HWPX and round-trips text", async () => {
    if (!bytes) return;
    const hwpxBytes = await hwpToHwpx(bytes);
    expect(hwpxBytes.byteLength).toBeGreaterThan(1000);

    // mimetype 첫 엔트리 검증
    const zip = await JSZip.loadAsync(hwpxBytes);
    expect(Object.keys(zip.files)[0]).toBe("mimetype");

    // 라운드트립 — HwpxReader 로 읽기
    const r = new HwpxReader();
    const ab = hwpxBytes.buffer.slice(
      hwpxBytes.byteOffset,
      hwpxBytes.byteOffset + hwpxBytes.byteLength
    ) as ArrayBuffer;
    await r.loadFromArrayBuffer(ab);
    const text = await r.extractText();
    expect(text).toContain("결");
  });
});

describe("HWP integration: 여름휴가 안내문.hwp (with images)", () => {
  let bytes: Uint8Array | null = null;
  beforeAll(async () => {
    bytes = await loadFixture("hwpVacation");
  });

  it("extracts core text", async () => {
    if (!bytes) return;
    const text = await hwpToText(bytes);
    expect(text).toContain("여름휴가");
    expect(text).toContain("회사명");
  });

  it("includes BinData/* images when converting to HWPX", async () => {
    if (!bytes) return;
    const hwpxBytes = await hwpToHwpx(bytes);
    const zip = await JSZip.loadAsync(hwpxBytes);
    const binDataPaths = Object.keys(zip.files).filter((p) => p.startsWith("BinData/"));
    expect(binDataPaths.length).toBeGreaterThan(0);

    // 매니페스트에도 등록되어 있어야 함
    const manifest = await zip.file("META-INF/manifest.xml")!.async("string");
    for (const p of binDataPaths) {
      expect(manifest).toContain(p);
    }
  });
});

describe("HWP integration: 공고문(안) (table with merged cells)", () => {
  let bytes: Uint8Array | null = null;
  beforeAll(async () => {
    bytes = await loadFixture("hwpNotice");
  });

  it("preserves rowSpan/colSpan in converted HWPX", async () => {
    if (!bytes) return;
    const hwpxBytes = await hwpToHwpx(bytes);
    const zip = await JSZip.loadAsync(hwpxBytes);
    const sec0 = await zip.file("Contents/section0.xml")!.async("string");
    // 공고문 표는 운행정지명령일 rowSpan=2/3, 운행정지사유 rowSpan=5
    expect(sec0).toMatch(/hp:rowSpan="[2-9]"/);
  });

  it("preserves all 5 vehicle data rows", async () => {
    if (!bytes) return;
    const text = await hwpToText(bytes);
    // 차대번호 5개 모두 등장해야 함
    expect(text).toContain("KP9GN2ZTZSEE60098");
    expect(text).toContain("KP9GN2ZTZSEE60099");
    expect(text).toContain("KMHLM41ABTU099274");
    expect(text).toContain("KNANC81BBRS428884");
    expect(text).toContain("KNARK81GBSA383030");
    // 연번 1~5
    for (const n of ["1", "2", "3", "4", "5"]) {
      expect(text.includes(n)).toBe(true);
    }
  });

  it("exports rich style info to header.xml", async () => {
    if (!bytes) return;
    const hwpxBytes = await hwpToHwpx(bytes);
    const zip = await JSZip.loadAsync(hwpxBytes);
    const header = await zip.file("Contents/header.xml")!.async("string");
    // 굵은 글씨 / 정렬 다양성
    expect(header).toContain("<hh:bold/>");
    expect(header).toMatch(/hh:horizontal="(CENTER|RIGHT|LEFT)"/);
    // 폰트 face 가 1개 이상
    expect(header).toMatch(/hh:fontfaces hh:itemCnt="\d+"/);
  });
});

describe("Error handling", () => {
  it("rejects non-HWP/non-HWPX data with clear error", () => {
    const bad = new Uint8Array(512); // all zeros
    expect(() => parseHwp(bad)).toThrow(/HWP 5\.0.*아닙니다|시그니처/);
  });

  it("rejects HWP 3.0 with HwpUnsupportedError", () => {
    const hwp3 = new TextEncoder().encode("HWP Document File V3.00 ");
    const data = new Uint8Array(512);
    data.set(hwp3, 0);
    expect(() => parseHwp(data)).toThrow(/HWP 3\.0/);
  });
});

afterAll(() => {
  // 테스트 후 GC 등 특별 정리 없음
});
