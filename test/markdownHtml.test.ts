import { describe, expect, it } from "vitest";
import JSZip from "jszip";

import HwpxReader from "../src/lib/hwpxReader.js";
import {
  markdownToHwpx,
  htmlToHwpx,
  hwpDocumentToMarkdown,
  markdownToHwpDocument,
  htmlToHwpDocument,
} from "../src/lib/hwp/index.js";

async function readBackText(bytes: Uint8Array): Promise<string> {
  const r = new HwpxReader();
  await r.loadFromArrayBuffer(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  );
  return await r.extractText();
}

describe("Markdown → HWPX", () => {
  it("preserves heading and paragraph text", async () => {
    const md = `# 제목\n\n본문 첫 줄.\n\n본문 둘째 줄.`;
    const bytes = await markdownToHwpx(md);
    const text = await readBackText(bytes);
    expect(text).toContain("제목");
    expect(text).toContain("본문 첫 줄");
    expect(text).toContain("본문 둘째 줄");
  });

  it("preserves bold/italic via charShape ID lookup", async () => {
    const md = `**굵은** 텍스트와 *기울임* 텍스트`;
    const bytes = await markdownToHwpx(md);
    const zip = await JSZip.loadAsync(bytes);
    const header = await zip.file("Contents/header.xml")!.async("string");
    expect(header).toContain("<hh:bold/>");
    expect(header).toContain("<hh:italic/>");
  });

  it("preserves table structure", async () => {
    const md = `| 이름 | 나이 |\n| --- | --- |\n| 홍길동 | 30 |\n| 김철수 | 25 |`;
    const bytes = await markdownToHwpx(md);
    const text = await readBackText(bytes);
    expect(text).toContain("이름");
    expect(text).toContain("홍길동");
    expect(text).toContain("김철수");
    expect(text).toContain("30");
  });

  it("preserves list items with prefix", async () => {
    const md = `- 항목 1\n- 항목 2\n- 항목 3`;
    const bytes = await markdownToHwpx(md);
    const text = await readBackText(bytes);
    expect(text).toContain("- 항목 1");
    expect(text).toContain("- 항목 2");
    expect(text).toContain("- 항목 3");
  });

  it("embeds data URI images into BinData", async () => {
    // 1×1 PNG (transparent)
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYGD4DwABBAEAfbLI3wAAAABJRU5ErkJggg==";
    const md = `![alt](data:image/png;base64,${png})`;
    const bytes = await markdownToHwpx(md);
    const zip = await JSZip.loadAsync(bytes);
    const binPaths = Object.keys(zip.files).filter(
      (p) => p.startsWith("BinData/") && !p.endsWith("/")
    );
    expect(binPaths.length).toBeGreaterThan(0);
    expect(binPaths[0]).toMatch(/\.png$/i);
  });
});

describe("HTML → HWPX", () => {
  it("renders headings, paragraphs, lists, blockquote", async () => {
    const html = `<h1>제목</h1><p>본문 <strong>굵게</strong> 부분</p><ul><li>A</li><li>B</li></ul><blockquote>인용</blockquote>`;
    const bytes = await htmlToHwpx(html);
    const text = await readBackText(bytes);
    expect(text).toContain("제목");
    expect(text).toContain("본문");
    expect(text).toContain("굵게");
    expect(text).toContain("- A");
    expect(text).toContain("- B");
    expect(text).toContain("> 인용");
  });

  it("preserves table with thead/tbody and th/td distinction", async () => {
    const html = `<table>
      <thead><tr><th>X</th><th>Y</th></tr></thead>
      <tbody><tr><td>1</td><td>2</td></tr></tbody>
    </table>`;
    const bytes = await htmlToHwpx(html);
    const text = await readBackText(bytes);
    expect(text).toContain("X");
    expect(text).toContain("Y");
    expect(text).toContain("1");
    expect(text).toContain("2");
  });

  it("preserves rowspan/colspan from td/th", async () => {
    const html = `<table><tr><td rowspan="2">A</td><td>B</td></tr><tr><td>C</td></tr></table>`;
    const bytes = await htmlToHwpx(html);
    const zip = await JSZip.loadAsync(bytes);
    const sec = await zip.file("Contents/section0.xml")!.async("string");
    expect(sec).toMatch(/hp:rowSpan="2"/);
  });

  it("ignores script/style content", async () => {
    const html = `<style>body { color: red }</style><p>본문</p><script>alert(1)</script>`;
    const bytes = await htmlToHwpx(html);
    const text = await readBackText(bytes);
    expect(text).toContain("본문");
    expect(text).not.toContain("color");
    expect(text).not.toContain("alert");
  });

  it("decodes HTML entities", async () => {
    const html = `<p>A &amp; B &lt; C</p>`;
    const bytes = await htmlToHwpx(html);
    const text = await readBackText(bytes);
    expect(text).toContain("A & B < C");
  });

  it("preserves pre/code text with line breaks", async () => {
    const html = `<pre><code>line1\nline2\nline3</code></pre>`;
    const bytes = await htmlToHwpx(html);
    const text = await readBackText(bytes);
    expect(text).toContain("line1");
    expect(text).toContain("line2");
    expect(text).toContain("line3");
  });
});

describe("HwpDocument → Markdown writer", () => {
  it("emits proper markdown table syntax", () => {
    const doc = htmlToHwpDocument(
      `<table><tr><th>이름</th><th>나이</th></tr><tr><td>홍길동</td><td>30</td></tr></table>`
    );
    const md = hwpDocumentToMarkdown(doc);
    // <th> 는 bold 로 charShape 등록되어 ** 로 감싸짐
    expect(md).toMatch(/\| \*\*이름\*\* \| \*\*나이\*\* \|/);
    expect(md).toMatch(/\| --- \| --- \|/);
    expect(md).toMatch(/\| 홍길동 \| 30 \|/);
  });

  it("wraps bold/italic runs", () => {
    const doc = markdownToHwpDocument(`**굵게** 그리고 *기울임*`);
    const md = hwpDocumentToMarkdown(doc);
    expect(md).toContain("**굵게**");
    expect(md).toContain("*기울임*");
  });

  it("escapes pipe characters inside table cells", () => {
    // 셀 안 텍스트가 |를 포함해도 표 깨지지 않아야 함
    const doc = htmlToHwpDocument(`<table><tr><th>A|B</th></tr><tr><td>C|D</td></tr></table>`);
    const md = hwpDocumentToMarkdown(doc);
    // | 가 \\| 로 이스케이프됨
    expect(md).toContain("\\|");
  });
});

describe("HwpxReader.extractMarkdown — HWPX → MD", () => {
  it("extracts table as markdown table from HwpxWriter-generated HWPX", async () => {
    // HwpxWriter 는 평문만 만드므로 별도 흐름:
    // markdownToHwpx 로 표가 든 HWPX 생성 → extractMarkdown 으로 다시 MD
    const original = `| 머리1 | 머리2 |\n| --- | --- |\n| 데이터1 | 데이터2 |`;
    const bytes = await markdownToHwpx(original);
    const r = new HwpxReader();
    await r.loadFromArrayBuffer(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    );
    const md = await r.extractMarkdown();
    expect(md).toContain("머리1");
    expect(md).toContain("머리2");
    expect(md).toContain("데이터1");
    expect(md).toContain("데이터2");
    expect(md).toMatch(/\| --- \| --- \|/);
  });
});
