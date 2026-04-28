import { describe, expect, it } from "vitest";
import JSZip from "jszip";

import HwpxReader from "../src/lib/hwpxReader.js";
import HwpxWriter from "../src/lib/writer.js";
import type {
  HwpDocument,
  HwpBorderFill,
  HwpBorderLine,
  HwpDiagonalLine,
  HwpSolidFill,
} from "../src/lib/hwp/types.js";
import { buildHwpxFromDocument } from "../src/lib/hwp/hwpxBuilder.js";

/**
 * 픽스처 의존 없이 HwpDocument IR 을 직접 만들어 hwpxBuilder 의 출력과 라운드트립을 검증.
 * 사용자 환경에 .hwp 파일이 없어도 CI 에서 안정 동작.
 */

function makeBorder(lineType: number, widthIndex: number, color: number): HwpBorderLine {
  return { lineType, widthIndex, color };
}

function makeDiagonal(): HwpDiagonalLine {
  return { diagonalType: 0, widthIndex: 0, color: 0 };
}

function makeMinimalDoc(extra?: Partial<HwpDocument>): HwpDocument {
  const base: HwpDocument = {
    header: {
      version: { major: 5, minor: 0, build: 6, revision: 0 },
      flags: {
        raw: 1,
        compressed: true,
        encrypted: false,
        distribution: false,
        script: false,
        drm: false,
        xmlTemplate: false,
        documentHistory: false,
        digitalSignature: false,
        publicKeyEncrypted: false,
        modifiedCertificate: false,
        prepareDistribution: false,
      },
    },
    docInfo: {
      fontFaces: [
        [{ name: "함초롬바탕" }, { name: "굴림" }],
        [{ name: "Times New Roman" }],
        [],
        [],
        [],
        [],
        [],
      ],
      charShapes: [],
      paraShapes: [],
      styles: [],
      binData: [],
      borderFills: [],
      numberings: [],
      bullets: [],
      tabDefs: [],
    },
    sections: [
      {
        paragraphs: [
          {
            paraShapeId: 0,
            styleId: 0,
            text: "안녕하세요, hwpxjs 합성 테스트입니다.",
            runs: [
              { charShapeId: 0, text: "안녕하세요, hwpxjs 합성 테스트입니다." },
            ],
            controls: [],
          },
        ],
      },
    ],
    binData: new Map(),
  };
  return { ...base, ...(extra ?? {}) };
}

describe("Synthetic round-trip — buildHwpxFromDocument → HwpxReader", () => {
  it("preserves single paragraph text through HWPX round-trip", async () => {
    const doc = makeMinimalDoc();
    const bytes = await buildHwpxFromDocument(doc, { title: "T", creator: "C" });
    const r = new HwpxReader();
    await r.loadFromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const text = await r.extractText();
    expect(text).toContain("hwpxjs 합성 테스트");
  });

  it("preserves all 7 language font face groups", async () => {
    const doc = makeMinimalDoc();
    const bytes = await buildHwpxFromDocument(doc);
    const zip = await JSZip.loadAsync(bytes);
    const header = await zip.file("Contents/header.xml")!.async("string");
    expect(header).toMatch(/hh:fontfaces hh:itemCnt="7"/);
    expect(header).toContain("함초롬바탕");
    expect(header).toContain("굴림");
    expect(header).toContain("Times New Roman");
  });

  it("emits PrvText.txt with body content", async () => {
    const doc = makeMinimalDoc();
    const bytes = await buildHwpxFromDocument(doc);
    const zip = await JSZip.loadAsync(bytes);
    const prv = await zip.file("Preview/PrvText.txt")!.async("string");
    expect(prv).toContain("hwpxjs 합성 테스트");
  });

  it("emits valid mimetype as first STORED entry", async () => {
    const doc = makeMinimalDoc();
    const bytes = await buildHwpxFromDocument(doc);
    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files)[0]).toBe("mimetype");
    const mimetype = await zip.file("mimetype")!.async("string");
    expect(mimetype).toBe("application/owpml");
  });
});

describe("Synthetic — BorderFill detail preservation", () => {
  it("emits 4-side border with line type, width, color", async () => {
    const black = 0x000000;
    const red = 0x0000ff; // HWP color: BBGGRR=0000FF means R=FF G=00 B=00 → red
    const borderFill: HwpBorderFill = {
      attr: 0,
      borders: [
        makeBorder(1, 4, black), // SOLID, 0.25mm, black
        makeBorder(2, 4, red), // DASH, 0.25mm, red
        makeBorder(3, 6, black), // DOT, 0.4mm, black
        makeBorder(8, 7, black), // DOUBLE, 0.5mm, black
      ],
      diagonal: makeDiagonal(),
      fill: undefined,
    };
    const doc = makeMinimalDoc({
      docInfo: { ...makeMinimalDoc().docInfo, borderFills: [borderFill] },
    });
    const bytes = await buildHwpxFromDocument(doc);
    const zip = await JSZip.loadAsync(bytes);
    const header = await zip.file("Contents/header.xml")!.async("string");

    // 4면 보더 모두 등장 (서로 다른 type)
    expect(header).toMatch(/hh:leftBorder hh:type="SOLID" hh:width="0\.25 mm"/);
    expect(header).toMatch(/hh:rightBorder hh:type="DASH" hh:width="0\.25 mm" hh:color="#FF0000"/);
    expect(header).toMatch(/hh:topBorder hh:type="DOT" hh:width="0\.4 mm"/);
    expect(header).toMatch(/hh:bottomBorder hh:type="DOUBLE" hh:width="0\.5 mm"/);
  });

  it("encodes attr bits 2-4 as slash direction", async () => {
    const bf: HwpBorderFill = {
      attr: 0x04, // bit 2 → slash kind=1
      borders: [makeBorder(1, 0, 0), makeBorder(1, 0, 0), makeBorder(1, 0, 0), makeBorder(1, 0, 0)],
      diagonal: makeDiagonal(),
    };
    const doc = makeMinimalDoc({
      docInfo: { ...makeMinimalDoc().docInfo, borderFills: [bf] },
    });
    const bytes = await buildHwpxFromDocument(doc);
    const zip = await JSZip.loadAsync(bytes);
    const header = await zip.file("Contents/header.xml")!.async("string");
    expect(header).toMatch(/hh:slash hh:type="SOLID"/);
    expect(header).toMatch(/hh:backSlash hh:type="NONE"/);
  });

  it("emits fillBrush winBrush for solid fill", async () => {
    const fill: HwpSolidFill = {
      backgroundColor: 0x00d9d9d9, // light gray
      patternColor: 0,
      patternType: -1,
    };
    const bf: HwpBorderFill = {
      attr: 0,
      borders: [makeBorder(0, 0, 0), makeBorder(0, 0, 0), makeBorder(0, 0, 0), makeBorder(0, 0, 0)],
      diagonal: makeDiagonal(),
      fill,
    };
    const doc = makeMinimalDoc({
      docInfo: { ...makeMinimalDoc().docInfo, borderFills: [bf] },
    });
    const bytes = await buildHwpxFromDocument(doc);
    const zip = await JSZip.loadAsync(bytes);
    const header = await zip.file("Contents/header.xml")!.async("string");
    expect(header).toContain('hh:winBrush hh:faceColor="#D9D9D9"');
    expect(header).toContain('hh:hatchStyle="NONE"');
  });
});

describe("Synthetic — Header/Footer/Footnote inline output", () => {
  it("includes header paragraphs in section body", async () => {
    const doc = makeMinimalDoc();
    doc.sections[0].paragraphs[0].controls.push({
      kind: "header",
      paragraphs: [
        {
          paraShapeId: 0,
          styleId: 0,
          text: "이 페이지의 머리말입니다.",
          runs: [{ charShapeId: 0, text: "이 페이지의 머리말입니다." }],
          controls: [],
        },
      ],
    });
    const bytes = await buildHwpxFromDocument(doc);
    const r = new HwpxReader();
    await r.loadFromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const text = await r.extractText();
    expect(text).toContain("머리말입니다");
  });

  it("includes footnote paragraphs", async () => {
    const doc = makeMinimalDoc();
    doc.sections[0].paragraphs[0].controls.push({
      kind: "footnote",
      paragraphs: [
        {
          paraShapeId: 0,
          styleId: 0,
          text: "각주 본문",
          runs: [{ charShapeId: 0, text: "각주 본문" }],
          controls: [],
        },
      ],
    });
    const bytes = await buildHwpxFromDocument(doc);
    const r = new HwpxReader();
    await r.loadFromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const text = await r.extractText();
    expect(text).toContain("각주 본문");
  });
});

describe("Synthetic — HwpxWriter spec details", () => {
  it("createFromPlainText emits a valid HWPX with title and creator metadata", async () => {
    const w = new HwpxWriter();
    const bytes = await w.createFromPlainText("hello", { title: "내 문서", creator: "ssabro" });
    const zip = await JSZip.loadAsync(bytes);
    const hpf = await zip.file("Contents/content.hpf")!.async("string");
    expect(hpf).toContain("<dc:title>내 문서</dc:title>");
    expect(hpf).toContain("<dc:creator>ssabro</dc:creator>");
  });

  it("escapes XML special characters in plain text", async () => {
    const w = new HwpxWriter();
    const tricky = `<tag attr="v">A & B</tag> 'quote'`;
    const bytes = await w.createFromPlainText(tricky);
    const zip = await JSZip.loadAsync(bytes);
    const sec = await zip.file("Contents/section0.xml")!.async("string");
    // 원문 그대로 등장하면 안 됨 (XML 깨짐)
    expect(sec).not.toContain('<tag attr="v">');
    // 이스케이프 형태로 등장
    expect(sec).toContain("&lt;tag");
    expect(sec).toContain("&amp; B");

    // HwpxReader 로 읽어서 원문 복원
    const r = new HwpxReader();
    await r.loadFromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const text = await r.extractText();
    expect(text).toContain(tricky);
  });
});
