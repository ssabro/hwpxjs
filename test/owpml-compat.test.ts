/**
 * OWPML 한컴(한글) 호환성 정합 테스트.
 *
 * 생성된 HWPX 가 한컴오피스에서 열리려면 실제 한컴 출력 컨벤션을 따라야 한다:
 *   - mimetype = "application/hwp+zip" (한글의 HWPX 매직 문자열)
 *   - OWPML 속성은 네임스페이스 prefix 를 쓰지 않음 (요소만 prefix)
 *   - 루트에 OWPML 네임스페이스 선언 + <hh:head version>
 *   - 첫 문단에 <hp:secPr> (페이지 설정)
 *   - content.hpf spine 에 header itemref
 *
 * 기준: etc/hwpxcore_test/ (한컴 정상 출력 샘플)
 * [shyang 2026-06-21]
 */
import { describe, expect, it } from "vitest";
import JSZip from "jszip";

import { markdownToHwpx, htmlToHwpx } from "../src/lib/hwp/index.js";
import { HwpxWriter } from "../src/lib/writer.js";
import HwpxReader from "../src/lib/hwpxReader.js";

async function readerOf(bytes: Uint8Array): Promise<HwpxReader> {
  const r = new HwpxReader();
  await r.loadFromArrayBuffer(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  );
  return r;
}

async function zipOf(bytes: Uint8Array): Promise<JSZip> {
  return await JSZip.loadAsync(bytes);
}

/** xmlns: 선언을 제거한 뒤 남은 hh:/hp:/hc: prefix 속성(=잘못된 표기)을 찾는다. */
function hasPrefixedAttribute(xml: string): boolean {
  const stripped = xml.replace(/xmlns:[a-zA-Z0-9]+="[^"]*"/g, "");
  // 공백 다음에 오는 `prefix:name=` 형태 = 속성에 붙은 prefix
  return /\s(hh|hp|hc):[a-zA-Z]+=/.test(stripped);
}

describe("OWPML mimetype", () => {
  it("markdownToHwpx 의 mimetype 은 application/hwp+zip", async () => {
    const zip = await zipOf(await markdownToHwpx("본문"));
    const mime = await zip.file("mimetype")!.async("string");
    expect(mime).toBe("application/hwp+zip");
  });

  it("htmlToHwpx 의 mimetype 은 application/hwp+zip", async () => {
    const zip = await zipOf(await htmlToHwpx("<p>본문</p>"));
    const mime = await zip.file("mimetype")!.async("string");
    expect(mime).toBe("application/hwp+zip");
  });

  it("HwpxWriter(평문) 의 mimetype 은 application/hwp+zip", async () => {
    const zip = await zipOf(await new HwpxWriter().createFromPlainText("본문"));
    const mime = await zip.file("mimetype")!.async("string");
    expect(mime).toBe("application/hwp+zip");
  });
});

describe("OWPML 속성 prefix 부재", () => {
  it("header.xml 속성에 hh:/hp: prefix 가 없다 (xmlns 제외)", async () => {
    const zip = await zipOf(await markdownToHwpx("# 제목\n\n**굵게**"));
    const header = await zip.file("Contents/header.xml")!.async("string");
    expect(hasPrefixedAttribute(header)).toBe(false);
  });

  it("section0.xml 속성에 hp:/hh: prefix 가 없다 (xmlns 제외)", async () => {
    const zip = await zipOf(await markdownToHwpx("# 제목\n\n본문 텍스트"));
    const sec = await zip.file("Contents/section0.xml")!.async("string");
    expect(hasPrefixedAttribute(sec)).toBe(false);
  });

  it("평문 writer 의 section0.xml 속성에도 prefix 가 없다", async () => {
    const zip = await zipOf(await new HwpxWriter().createFromPlainText("첫 줄\n둘째 줄"));
    const sec = await zip.file("Contents/section0.xml")!.async("string");
    expect(hasPrefixedAttribute(sec)).toBe(false);
  });
});

describe("OWPML 루트 네임스페이스 + version", () => {
  it("header.xml 에 version 속성과 hp 네임스페이스 선언", async () => {
    const zip = await zipOf(await markdownToHwpx("본문"));
    const header = await zip.file("Contents/header.xml")!.async("string");
    expect(header).toMatch(/<hh:head[^>]*\sversion="/);
    expect(header).toContain('xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"');
  });

  it("section0.xml 루트에 OWPML 네임스페이스 선언", async () => {
    const zip = await zipOf(await markdownToHwpx("본문"));
    const sec = await zip.file("Contents/section0.xml")!.async("string");
    expect(sec).toContain('xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"');
    expect(sec).toContain('xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head"');
  });
});

describe("OWPML 첫 문단 secPr (페이지 설정)", () => {
  it("section0.xml 첫 문단에 hp:secPr + pagePr", async () => {
    const zip = await zipOf(await markdownToHwpx("# 제목\n\n본문"));
    const sec = await zip.file("Contents/section0.xml")!.async("string");
    expect(sec).toContain("<hp:secPr");
    expect(sec).toContain("<hp:pagePr");
  });
});

describe("OWPML content.hpf spine", () => {
  it("spine 에 header itemref 포함", async () => {
    const zip = await zipOf(await markdownToHwpx("본문"));
    const hpf = await zip.file("Contents/content.hpf")!.async("string");
    expect(hpf).toMatch(/<opf:itemref[^>]*idref="header"/);
  });
});

describe("OWPML 표 한컴 구조", () => {
  it("표는 cellAddr/cellSpan/cellSz 자식 + tbl sz 구조를 쓴다", async () => {
    const md = `| A | B |\n| --- | --- |\n| 1 | 2 |`;
    const zip = await zipOf(await markdownToHwpx(md));
    const sec = await zip.file("Contents/section0.xml")!.async("string");
    expect(sec).toContain("<hp:tbl");
    expect(sec).toContain("<hp:cellAddr");
    expect(sec).toContain("<hp:cellSpan");
    expect(sec).toContain("<hp:cellSz");
    expect(sec).toMatch(/<hp:sz width="\d+"/);
  });

  it("HTML 병합표(rowspan)의 cellAddr 이 점유 그리드 기준으로 정확하다", async () => {
    // 1행: A(rowspan=2) | B,  2행: C → C 는 A 가 0열을 점유하므로 colAddr=1
    const html = `<table><tr><td rowspan="2">A</td><td>B</td></tr><tr><td>C</td></tr></table>`;
    const zip = await zipOf(await htmlToHwpx(html));
    const sec = await zip.file("Contents/section0.xml")!.async("string");
    expect(sec).toMatch(/<hp:cellSpan colSpan="1" rowSpan="2"\/>/); // A
    expect(sec).toMatch(/<hp:cellAddr colAddr="1" rowAddr="1"\/>/); // C
  });

  it("reader 가 새 표 구조(cellSpan 자식)의 rowspan 을 HTML 로 복원", async () => {
    const html = `<table><tr><td rowspan="2">A</td><td>B</td></tr><tr><td>C</td></tr></table>`;
    const r = await readerOf(await htmlToHwpx(html));
    const out = await r.extractHtml();
    expect(out).toMatch(/rowspan="2"/i);
  });
});

describe("OWPML 이미지 hp:pic 한컴 구조", () => {
  const PNG_1x1 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYGD4DwABBAEAfbLI3wAAAABJRU5ErkJggg==";

  it("이미지는 hp:pic 풀 구조(curSz/renderingInfo/imgRect/sz)를 쓴다", async () => {
    const md = `![alt](data:image/png;base64,${PNG_1x1})`;
    const zip = await zipOf(await markdownToHwpx(md));
    const sec = await zip.file("Contents/section0.xml")!.async("string");
    expect(sec).toContain("<hp:pic");
    expect(sec).toContain("<hp:curSz");
    expect(sec).toContain("<hp:renderingInfo");
    expect(sec).toContain("<hp:imgRect");
    expect(sec).toMatch(/<hp:sz width="\d+" widthRelTo="ABSOLUTE"/);
    expect(sec).toContain('binaryItemIDRef="image1"');
  });

  it("content.hpf 의 이미지 item 은 isEmbeded 로 등록된다", async () => {
    const md = `![alt](data:image/png;base64,${PNG_1x1})`;
    const zip = await zipOf(await markdownToHwpx(md));
    const hpf = await zip.file("Contents/content.hpf")!.async("string");
    expect(hpf).toMatch(/<opf:item[^>]*id="image1"[^>]*isEmbeded="1"/);
  });
});

describe("OWPML 폰트 face 속성", () => {
  it("header.xml 폰트는 name 이 아니라 face 속성을 쓴다", async () => {
    const zip = await zipOf(await markdownToHwpx("본문"));
    const header = await zip.file("Contents/header.xml")!.async("string");
    expect(header).toMatch(/<hh:font[^>]*\sface="/);
  });
});
