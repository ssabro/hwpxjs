/**
 * E2E 변환 파이프라인 테스트.
 *
 * 실제 사용자 작성 md(etc/e2emd.md)를 두 경로로 HWPX 변환하고,
 * 한컴 호환 패키지 구조 + 내용(제목/본문/표) 보존을 round-trip 으로 검증한다.
 *   1) md → hwpx (markdownToHwpx)
 *   2) md → html(marked) → hwpx (htmlToHwpx)
 *
 * 한글에서 실제 열리는지는 수동(hwp MCP)으로 별도 확인.
 * [shyang 2026-06-21]
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { marked } from "marked";
import JSZip from "jszip";

import HwpxReader from "../src/lib/hwpxReader.js";
import { markdownToHwpx, htmlToHwpx } from "../src/lib/hwp/index.js";

/** test/fixtures(커밋됨) 우선, 없으면 etc(개발 로컬) 폴백. */
function pickFixture(...candidates: string[]): string | null {
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

const MD_PATH = pickFixture(resolve("test/fixtures/e2emd.md"), resolve("etc/e2emd.md"));
const md = MD_PATH ? readFileSync(MD_PATH, "utf-8") : null;

const IMG_MD_PATH = pickFixture(resolve("test/fixtures/e2emd_img.md"), resolve("etc/e2emd_img.md"));
const imgMd = IMG_MD_PATH ? readFileSync(IMG_MD_PATH, "utf-8") : null;

async function roundTripText(bytes: Uint8Array): Promise<string> {
  const r = new HwpxReader();
  await r.loadFromArrayBuffer(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  );
  return await r.extractText();
}

/** 한컴 호환 패키지 공통 검증: mimetype, 속성 prefix 부재, secPr. */
async function assertHancomPackage(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  expect(await zip.file("mimetype")!.async("string")).toBe("application/hwp+zip");
  const sec = await zip.file("Contents/section0.xml")!.async("string");
  expect(sec).toContain("<hp:secPr");
  // xmlns 제외 후 prefix 붙은 속성이 없어야 함
  const stripped = sec.replace(/xmlns:[a-zA-Z0-9]+="[^"]*"/g, "");
  expect(/\s(hh|hp|hc):[a-zA-Z]+=/.test(stripped)).toBe(false);
  return sec;
}

describe("E2E: etc/e2emd.md", () => {
  it.runIf(md)("경로 1 — md → hwpx: 제목/본문/표 보존 + 한컴 호환", async () => {
    const bytes = await markdownToHwpx(md!);
    const sec = await assertHancomPackage(bytes);
    expect(sec).toContain("<hp:tbl");

    const text = await roundTripText(bytes);
    expect(text).toContain("테스트Md");
    expect(text).toContain("정상적으로");
    expect(text).toContain("테스트데이터");
    expect(text).toContain("코덱스");
    expect(text).toContain("opus 4.8");
  });

  it.runIf(md)("경로 2 — md → html(marked) → hwpx: 동일 내용 보존", async () => {
    const html = await marked.parse(md!);
    const bytes = await htmlToHwpx(html);
    const sec = await assertHancomPackage(bytes);
    expect(sec).toContain("<hp:tbl");

    const text = await roundTripText(bytes);
    expect(text).toContain("테스트Md");
    expect(text).toContain("테스트데이터");
    expect(text).toContain("코덱스");
    expect(text).toContain("opus 4.8");
  });

  it.runIf(imgMd)("data URI 이미지 md → hwpx: BinData 임베드 + hp:pic", async () => {
    const bytes = await markdownToHwpx(imgMd!);
    await assertHancomPackage(bytes);
    const zip = await JSZip.loadAsync(bytes);
    const bins = Object.keys(zip.files).filter(
      (p) => p.startsWith("BinData/") && !p.endsWith("/")
    );
    expect(bins.length).toBeGreaterThan(0);
    expect(bins[0]).toMatch(/\.png$/i);
    const sec = await zip.file("Contents/section0.xml")!.async("string");
    expect(sec).toContain("<hp:pic");
    expect(sec).toContain('binaryItemIDRef="image1"');
    // content.hpf 에 isEmbeded 등록
    const hpf = await zip.file("Contents/content.hpf")!.async("string");
    expect(hpf).toMatch(/<opf:item[^>]*id="image1"[^>]*isEmbeded="1"/);
  });

  it.runIf(md)("두 경로 모두 표를 3행×4열로 만든다", async () => {
    const fromMd = await JSZip.loadAsync(await markdownToHwpx(md!));
    const secMd = await fromMd.file("Contents/section0.xml")!.async("string");
    // 헤더 1 + 데이터 2 = 3행, 4열
    expect(secMd).toMatch(/<hp:tbl[^>]*rowCnt="3"[^>]*colCnt="4"/);

    const html = await marked.parse(md!);
    const fromHtml = await JSZip.loadAsync(await htmlToHwpx(html));
    const secHtml = await fromHtml.file("Contents/section0.xml")!.async("string");
    expect(secHtml).toMatch(/<hp:tbl[^>]*rowCnt="3"[^>]*colCnt="4"/);
  });
});
