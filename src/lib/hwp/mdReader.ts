/**
 * Markdown → HwpDocument IR.
 *
 * `marked` 의 lexer 로 토큰 트리를 만들고 IR 로 변환.
 *   - heading → 굵은 paragraph (charShape 별도 정의: 큰 사이즈 + bold)
 *   - paragraph → text + bold/italic run 분할
 *   - list (ordered/unordered) → "1. " / "- " prefix 가 포함된 paragraph (간단 표현)
 *   - blockquote → 인용 paragraph (회색 배경)
 *   - code (block / inline) → 모노스페이스 charShape
 *   - table → HwpTableControl (셀 paragraph 재귀)
 *   - image → HwpPictureControl + binData 등록 (data: URI 만 지원)
 *   - link → 텍스트 그대로 (링크 자체는 보존하지 않음 — HWP 필드 컨트롤은 별도 작업)
 */

import { marked, type Tokens } from "marked";
import type {
  HwpDocument,
  HwpDocInfo,
  HwpParagraph,
  HwpRun,
  HwpControl,
  HwpTableCell,
  HwpCharShape,
  HwpParaShape,
  HwpStyle,
  HwpFaceName,
} from "./types.js";

interface BuildContext {
  /** charShape ID 발급기 */
  charShapeIds: Map<string, number>;
  /** binData 적재 (storageId → bytes) */
  binData: Map<number, { data: Uint8Array; extension: string }>;
  /** 다음에 발급할 binData storageId */
  nextBinDataId: number;
}

/** Markdown 텍스트를 HwpDocument 로 변환. */
export function markdownToHwpDocument(md: string): HwpDocument {
  const tokens = marked.lexer(md);

  const ctx: BuildContext = {
    charShapeIds: new Map(),
    binData: new Map(),
    nextBinDataId: 1,
  };

  // 기본 charShapes / paraShapes / styles / fontFaces 등록
  // ID 0: 기본 (10pt, 함초롬바탕)
  // 추가 ID 는 paragraph 처리 중에 동적으로 발급
  const charShapes: HwpCharShape[] = [defaultCharShape()];
  ctx.charShapeIds.set("default", 0);

  const paraShapes: HwpParaShape[] = [defaultParaShape()];
  const styles: HwpStyle[] = [{ name: "바탕글", engName: "Normal", paraShapeId: 0, charShapeId: 0 }];
  const fontFaces: HwpFaceName[][] = [
    [{ name: "함초롬바탕" }, { name: "맑은 고딕" }, { name: "Courier New" }],
    [{ name: "Times New Roman" }],
    [],
    [],
    [],
    [],
    [],
  ];

  // bold/italic charShape 사전 등록
  const idBold = registerCharShape(charShapes, ctx, { ...defaultCharShape(), bold: true });
  const idItalic = registerCharShape(charShapes, ctx, { ...defaultCharShape(), italic: true });
  const idBoldItalic = registerCharShape(charShapes, ctx, { ...defaultCharShape(), bold: true, italic: true });
  // 헤딩(굵게 + 큰 사이즈) — h1=1800, h2=1600, h3=1400, h4-6=1200
  const idH1 = registerCharShape(charShapes, ctx, { ...defaultCharShape(), bold: true, baseSize: 1800 });
  const idH2 = registerCharShape(charShapes, ctx, { ...defaultCharShape(), bold: true, baseSize: 1600 });
  const idH3 = registerCharShape(charShapes, ctx, { ...defaultCharShape(), bold: true, baseSize: 1400 });
  const idHmin = registerCharShape(charShapes, ctx, { ...defaultCharShape(), bold: true, baseSize: 1200 });
  // 모노스페이스
  const idMono = registerCharShape(charShapes, ctx, {
    ...defaultCharShape(),
    faceNameIds: { hangul: 2, latin: 2, hanja: 2, japanese: 2, other: 2, symbol: 2, user: 2 },
  });

  const headingShapeId = (depth: number) => (depth === 1 ? idH1 : depth === 2 ? idH2 : depth === 3 ? idH3 : idHmin);

  const paragraphs: HwpParagraph[] = [];

  const visitTokens = (tks: Tokens.Generic[]): void => {
    for (const tk of tks) {
      paragraphs.push(...renderToken(tk, { idBold, idItalic, idBoldItalic, headingShapeId, idMono }, ctx, charShapes));
    }
  };
  visitTokens(tokens as Tokens.Generic[]);

  return {
    header: defaultFileHeader(),
    docInfo: {
      fontFaces,
      charShapes,
      paraShapes,
      styles,
      binData: [],
      borderFills: [],
      numberings: [],
      bullets: [],
      tabDefs: [],
    },
    sections: [{ paragraphs }],
    binData: ctx.binData,
  };
}

interface ShapeIds {
  idBold: number;
  idItalic: number;
  idBoldItalic: number;
  idMono: number;
  headingShapeId: (depth: number) => number;
}

function renderToken(
  tk: Tokens.Generic,
  ids: ShapeIds,
  ctx: BuildContext,
  charShapes: HwpCharShape[]
): HwpParagraph[] {
  switch (tk.type) {
    case "heading": {
      const t = tk as Tokens.Heading;
      const csId = ids.headingShapeId(t.depth);
      const runs = inlineToRuns(t.tokens ?? [], ids, csId);
      return [
        {
          paraShapeId: 0,
          styleId: 0,
          text: runsToText(runs),
          runs,
          controls: [],
        },
      ];
    }
    case "paragraph": {
      const t = tk as Tokens.Paragraph;
      const runs = inlineToRuns(t.tokens ?? [], ids, 0);
      const controls: HwpControl[] = [];
      // image 토큰은 별도 컨트롤로
      const imageControls = collectImagesFromInline(t.tokens ?? [], ctx);
      controls.push(...imageControls);
      return [
        {
          paraShapeId: 0,
          styleId: 0,
          text: runsToText(runs),
          runs,
          controls,
        },
      ];
    }
    case "blockquote": {
      const t = tk as Tokens.Blockquote;
      const inner = (t.tokens ?? []).flatMap((sub) =>
        renderToken(sub as Tokens.Generic, ids, ctx, charShapes)
      );
      // "> " prefix 로 시각적 표시
      return inner.map((p) => ({
        ...p,
        text: `> ${p.text}`,
        runs: p.runs.length > 0 ? [{ charShapeId: p.runs[0].charShapeId, text: `> ${runsToText(p.runs)}` }] : [],
      }));
    }
    case "list": {
      const t = tk as Tokens.List;
      const out: HwpParagraph[] = [];
      let idx = t.start === "" ? 1 : Number(t.start) || 1;
      for (const item of t.items) {
        const prefix = t.ordered ? `${idx}. ` : "- ";
        const inner = (item.tokens ?? []).flatMap((sub) =>
          renderToken(sub as Tokens.Generic, ids, ctx, charShapes)
        );
        if (inner.length === 0) {
          out.push({
            paraShapeId: 0,
            styleId: 0,
            text: prefix,
            runs: [{ charShapeId: 0, text: prefix }],
            controls: [],
          });
        } else {
          // 첫 paragraph 에 prefix 추가
          const first = inner[0];
          const newText = prefix + first.text;
          const newRuns: HwpRun[] = [
            { charShapeId: 0, text: prefix },
            ...first.runs,
          ];
          out.push({ ...first, text: newText, runs: newRuns });
          for (let i = 1; i < inner.length; i++) out.push(inner[i]);
        }
        idx++;
      }
      return out;
    }
    case "code": {
      const t = tk as Tokens.Code;
      // 코드 블록 — 모노스페이스 paragraph 들로 분할
      const lines = t.text.split("\n");
      return lines.map((line) => ({
        paraShapeId: 0,
        styleId: 0,
        text: line,
        runs: line.length > 0 ? [{ charShapeId: ids.idMono, text: line }] : [],
        controls: [],
      }));
    }
    case "table": {
      const t = tk as Tokens.Table;
      const rowCount = 1 + t.rows.length;
      const colCount = t.header.length;
      const cells: HwpTableCell[] = [];
      // 헤더 행
      for (let c = 0; c < t.header.length; c++) {
        const cellTokens = t.header[c].tokens ?? [];
        const runs = inlineToRuns(cellTokens, ids, ids.idBold);
        cells.push({
          col: c,
          row: 0,
          colSpan: 1,
          rowSpan: 1,
          paragraphs: [
            {
              paraShapeId: 0,
              styleId: 0,
              text: runsToText(runs),
              runs,
              controls: [],
            },
          ],
        });
      }
      // 본 행
      for (let r = 0; r < t.rows.length; r++) {
        for (let c = 0; c < t.rows[r].length; c++) {
          const cellTokens = t.rows[r][c].tokens ?? [];
          const runs = inlineToRuns(cellTokens, ids, 0);
          cells.push({
            col: c,
            row: r + 1,
            colSpan: 1,
            rowSpan: 1,
            paragraphs: [
              {
                paraShapeId: 0,
                styleId: 0,
                text: runsToText(runs),
                runs,
                controls: [],
              },
            ],
          });
        }
      }
      return [
        {
          paraShapeId: 0,
          styleId: 0,
          text: "",
          runs: [],
          controls: [{ kind: "table", rowCount, colCount, cells }],
        },
      ];
    }
    case "hr":
      return [
        {
          paraShapeId: 0,
          styleId: 0,
          text: "─────",
          runs: [{ charShapeId: 0, text: "─────" }],
          controls: [],
        },
      ];
    case "space":
      return [];
    case "text": {
      // 블록 레벨 text 토큰 — list item 안 등에서 등장 (tight list).
      const t = tk as Tokens.Text & { tokens?: Tokens.Generic[] };
      const inlineTokens =
        t.tokens ??
        ([{ type: "text", text: t.text, raw: t.text }] as unknown as Tokens.Generic[]);
      const runs = inlineToRuns(inlineTokens, ids, 0);
      return [
        {
          paraShapeId: 0,
          styleId: 0,
          text: runsToText(runs),
          runs,
          controls: [],
        },
      ];
    }
    default:
      return [];
  }
}

/** 인라인 토큰 (text / strong / em / codespan / link / br / image) → HwpRun[] */
function inlineToRuns(
  tokens: Tokens.Generic[],
  ids: ShapeIds,
  baseCharShapeId: number
): HwpRun[] {
  const runs: HwpRun[] = [];
  for (const t of tokens) {
    walkInline(t, baseCharShapeId, ids, runs, false, false);
  }
  // 인접 동일 charShape 합치기
  return mergeRuns(runs);
}

function walkInline(
  tk: Tokens.Generic,
  baseId: number,
  ids: ShapeIds,
  runs: HwpRun[],
  bold: boolean,
  italic: boolean
): void {
  switch (tk.type) {
    case "text": {
      const t = tk as Tokens.Text;
      const text = t.text;
      // 자식 토큰이 있으면 재귀, 없으면 그대로
      if ((t as Tokens.Text & { tokens?: Tokens.Generic[] }).tokens) {
        for (const sub of (t as Tokens.Text & { tokens: Tokens.Generic[] }).tokens) {
          walkInline(sub, baseId, ids, runs, bold, italic);
        }
      } else if (text.length > 0) {
        runs.push({ charShapeId: pickShapeId(baseId, ids, bold, italic), text: decodeEntities(text) });
      }
      break;
    }
    case "strong": {
      const t = tk as Tokens.Strong;
      for (const sub of t.tokens ?? []) walkInline(sub, baseId, ids, runs, true, italic);
      break;
    }
    case "em": {
      const t = tk as Tokens.Em;
      for (const sub of t.tokens ?? []) walkInline(sub, baseId, ids, runs, bold, true);
      break;
    }
    case "codespan": {
      const t = tk as Tokens.Codespan;
      runs.push({ charShapeId: ids.idMono, text: decodeEntities(t.text) });
      break;
    }
    case "link": {
      const t = tk as Tokens.Link;
      // 링크 텍스트만 보존 (URL 은 미보존 — 필드 컨트롤은 별도 작업)
      for (const sub of t.tokens ?? []) walkInline(sub, baseId, ids, runs, bold, italic);
      break;
    }
    case "br":
      runs.push({ charShapeId: pickShapeId(baseId, ids, bold, italic), text: "\n" });
      break;
    case "del": {
      const t = tk as Tokens.Del;
      for (const sub of t.tokens ?? []) walkInline(sub, baseId, ids, runs, bold, italic);
      break;
    }
    case "image":
      // 이미지는 paragraph 레벨에서 별도 처리 — runs 에는 alt 만
      runs.push({ charShapeId: baseId, text: (tk as Tokens.Image).text });
      break;
    case "escape":
      runs.push({ charShapeId: pickShapeId(baseId, ids, bold, italic), text: (tk as Tokens.Escape).text });
      break;
    case "html":
      // raw HTML 은 텍스트로
      runs.push({ charShapeId: baseId, text: (tk as Tokens.HTML).text });
      break;
    default:
      break;
  }
}

function pickShapeId(baseId: number, ids: ShapeIds, bold: boolean, italic: boolean): number {
  if (bold && italic) return ids.idBoldItalic;
  if (bold) return ids.idBold;
  if (italic) return ids.idItalic;
  return baseId;
}

function mergeRuns(runs: HwpRun[]): HwpRun[] {
  const out: HwpRun[] = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (last && last.charShapeId === r.charShapeId) {
      last.text += r.text;
    } else {
      out.push({ ...r });
    }
  }
  return out;
}

function runsToText(runs: HwpRun[]): string {
  return runs.map((r) => r.text).join("");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * paragraph 토큰 안의 image 토큰을 추출 → HwpPictureControl 로.
 * src 가 `data:` URI 인 경우만 binData 로 등록 (외부 URL/상대 경로는 보존 불가).
 */
function collectImagesFromInline(
  tokens: Tokens.Generic[],
  ctx: BuildContext
): HwpControl[] {
  const out: HwpControl[] = [];
  const visit = (tks: Tokens.Generic[]) => {
    for (const tk of tks) {
      if (tk.type === "image") {
        const img = tk as Tokens.Image;
        const ctrl = imageTokenToControl(img.href, ctx);
        if (ctrl) out.push(ctrl);
      }
      const subTokens = (tk as Tokens.Generic & { tokens?: Tokens.Generic[] }).tokens;
      if (Array.isArray(subTokens)) visit(subTokens);
    }
  };
  visit(tokens);
  return out;
}

function imageTokenToControl(href: string, ctx: BuildContext): HwpControl | null {
  // data URI 처리
  const match = /^data:([^;]+);base64,(.*)$/i.exec(href);
  if (match) {
    const mime = match[1].toLowerCase();
    const ext =
      mime === "image/png"
        ? "png"
        : mime === "image/jpeg"
          ? "jpg"
          : mime === "image/gif"
            ? "gif"
            : mime === "image/bmp"
              ? "bmp"
              : mime === "image/webp"
                ? "webp"
                : "bin";
    let bytes: Uint8Array;
    try {
      if (typeof Buffer !== "undefined") {
        bytes = new Uint8Array(Buffer.from(match[2], "base64"));
      } else {
        const bin = (globalThis as { atob?: (s: string) => string }).atob?.(match[2]) ?? "";
        bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      }
    } catch {
      return null;
    }
    const id = ctx.nextBinDataId++;
    ctx.binData.set(id, { data: bytes, extension: ext });
    return { kind: "picture", binDataId: id };
  }
  // 외부 URL / 상대 경로는 보존 불가 — 런타임 fetch 가 필요. 1차 포팅에서는 skip.
  return null;
}

// ============================================================
// 기본 IR 빌더
// ============================================================

function defaultCharShape(): HwpCharShape {
  return {
    faceNameIds: { hangul: 0, latin: 1, hanja: 0, japanese: 0, other: 0, symbol: 0, user: 0 },
    baseSize: 1000, // 10pt
    property: 0,
    textColor: 0,
    shadeColor: 0xffffff,
    underlineColor: 0,
    shadowColor: 0,
    bold: false,
    italic: false,
    underline: false,
    strikeout: false,
  };
}

function defaultParaShape(): HwpParaShape {
  return {
    alignment: "justify",
    property: 0,
    leftMargin: 0,
    rightMargin: 0,
    indent: 0,
    prevSpacing: 0,
    nextSpacing: 0,
    lineSpacing: 160,
  };
}

function defaultFileHeader(): HwpDocument["header"] {
  return {
    version: { major: 5, minor: 0, build: 6, revision: 0 },
    flags: {
      raw: 0,
      compressed: false,
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
  };
}

function registerCharShape(
  shapes: HwpCharShape[],
  ctx: BuildContext,
  cs: HwpCharShape
): number {
  const key = JSON.stringify(cs);
  const existing = ctx.charShapeIds.get(key);
  if (existing !== undefined) return existing;
  const id = shapes.length;
  shapes.push(cs);
  ctx.charShapeIds.set(key, id);
  return id;
}
