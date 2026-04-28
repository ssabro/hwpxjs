/**
 * HTML → HwpDocument IR.
 *
 * `htmlparser2` 로 SAX 파싱 → 트리 구축 → IR 변환.
 *   - p, div, h1~h6 → paragraph (heading 은 굵게 + 큰 사이즈)
 *   - strong/b, em/i → 굵게/기울임 run
 *   - br → 줄바꿈
 *   - ul/ol/li → "- " / "1. " prefix paragraph
 *   - table/thead/tbody/tr/th/td → HwpTableControl
 *   - img → HwpPictureControl (src 가 data: URI 일 때만)
 *   - blockquote → "> " prefix paragraph
 *   - code/pre → 모노스페이스
 *   - a → 텍스트만 (URL 미보존)
 *   - 기타 (style/script/head 등) → 무시
 */

import { Parser } from "htmlparser2";
import type {
  HwpDocument,
  HwpParagraph,
  HwpRun,
  HwpControl,
  HwpTableCell,
  HwpCharShape,
  HwpParaShape,
  HwpStyle,
  HwpFaceName,
} from "./types.js";

interface HtmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: (HtmlNode | string)[];
  parent: HtmlNode | null;
}

function parseToTree(html: string): HtmlNode {
  const root: HtmlNode = { tag: "#root", attrs: {}, children: [], parent: null };
  let current: HtmlNode = root;
  const voidTags = new Set([
    "br", "img", "hr", "input", "meta", "link", "source", "track", "wbr", "col", "area", "base", "embed",
  ]);
  const skipTags = new Set(["script", "style", "head", "noscript", "template"]);
  let inSkippedTag = 0;

  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (skipTags.has(name)) {
          inSkippedTag++;
          return;
        }
        if (inSkippedTag > 0) return;
        const node: HtmlNode = { tag: name, attrs, children: [], parent: current };
        current.children.push(node);
        if (!voidTags.has(name)) current = node;
      },
      ontext(text) {
        if (inSkippedTag > 0) return;
        current.children.push(text);
      },
      onclosetag(name) {
        if (skipTags.has(name)) {
          inSkippedTag = Math.max(0, inSkippedTag - 1);
          return;
        }
        if (inSkippedTag > 0) return;
        if (voidTags.has(name)) return;
        if (current.tag === name && current.parent) {
          current = current.parent;
        }
      },
    },
    { decodeEntities: true, lowerCaseTags: true }
  );
  parser.write(html);
  parser.end();
  return root;
}

interface BuildContext {
  charShapeIds: Map<string, number>;
  binData: Map<number, { data: Uint8Array; extension: string }>;
  nextBinDataId: number;
}

interface ShapeIds {
  idDefault: number;
  idBold: number;
  idItalic: number;
  idBoldItalic: number;
  idMono: number;
  idH1: number;
  idH2: number;
  idH3: number;
  idHmin: number;
}

interface InlineState {
  bold: boolean;
  italic: boolean;
  mono: boolean;
}

export function htmlToHwpDocument(html: string): HwpDocument {
  const tree = parseToTree(html);

  const ctx: BuildContext = {
    charShapeIds: new Map(),
    binData: new Map(),
    nextBinDataId: 1,
  };

  const charShapes: HwpCharShape[] = [defaultCharShape()];
  ctx.charShapeIds.set("default", 0);

  const ids: ShapeIds = {
    idDefault: 0,
    idBold: registerCharShape(charShapes, ctx, { ...defaultCharShape(), bold: true }),
    idItalic: registerCharShape(charShapes, ctx, { ...defaultCharShape(), italic: true }),
    idBoldItalic: registerCharShape(charShapes, ctx, { ...defaultCharShape(), bold: true, italic: true }),
    idMono: registerCharShape(charShapes, ctx, {
      ...defaultCharShape(),
      faceNameIds: { hangul: 2, latin: 2, hanja: 2, japanese: 2, other: 2, symbol: 2, user: 2 },
    }),
    idH1: registerCharShape(charShapes, ctx, { ...defaultCharShape(), bold: true, baseSize: 1800 }),
    idH2: registerCharShape(charShapes, ctx, { ...defaultCharShape(), bold: true, baseSize: 1600 }),
    idH3: registerCharShape(charShapes, ctx, { ...defaultCharShape(), bold: true, baseSize: 1400 }),
    idHmin: registerCharShape(charShapes, ctx, { ...defaultCharShape(), bold: true, baseSize: 1200 }),
  };

  const paragraphs: HwpParagraph[] = [];
  const initialState: InlineState = { bold: false, italic: false, mono: false };

  for (const child of tree.children) {
    paragraphs.push(...renderNode(child, ids, ctx, initialState, ""));
  }

  // 빈 paragraph 제거
  const filtered = paragraphs.filter(
    (p) => p.text.trim().length > 0 || p.controls.length > 0
  );

  return {
    header: defaultFileHeader(),
    docInfo: {
      fontFaces: [
        [{ name: "함초롬바탕" }, { name: "맑은 고딕" }, { name: "Courier New" }],
        [{ name: "Times New Roman" }],
        [],
        [],
        [],
        [],
        [],
      ],
      charShapes,
      paraShapes: [defaultParaShape()],
      styles: [{ name: "바탕글", engName: "Normal", paraShapeId: 0, charShapeId: 0 }],
      binData: [],
      borderFills: [],
      numberings: [],
      bullets: [],
      tabDefs: [],
    },
    sections: [{ paragraphs: filtered }],
    binData: ctx.binData,
  };
}

function renderNode(
  node: HtmlNode | string,
  ids: ShapeIds,
  ctx: BuildContext,
  state: InlineState,
  prefix: string
): HwpParagraph[] {
  if (typeof node === "string") {
    const text = collapseWhitespace(node);
    if (!text) return [];
    return [
      {
        paraShapeId: 0,
        styleId: 0,
        text: prefix + text,
        runs:
          prefix.length > 0
            ? [
                { charShapeId: ids.idDefault, text: prefix },
                { charShapeId: pickInlineId(ids, state), text },
              ]
            : [{ charShapeId: pickInlineId(ids, state), text }],
        controls: [],
      },
    ];
  }

  const tag = node.tag.toLowerCase();

  // 블록 레벨 태그 처리
  switch (tag) {
    case "p":
    case "div":
    case "section":
    case "article": {
      const runs = collectInlineRuns(node, ids, ctx, state);
      const text = runsToText(runs);
      const controls = collectInlineControls(node, ctx);
      if (text.length === 0 && controls.length === 0) return [];
      return [
        {
          paraShapeId: 0,
          styleId: 0,
          text: prefix + text,
          runs:
            prefix.length > 0
              ? [{ charShapeId: ids.idDefault, text: prefix }, ...runs]
              : runs,
          controls,
        },
      ];
    }
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const depth = Number(tag[1]);
      const baseShapeId =
        depth === 1 ? ids.idH1 : depth === 2 ? ids.idH2 : depth === 3 ? ids.idH3 : ids.idHmin;
      const runs = collectInlineRuns(node, ids, ctx, state, baseShapeId);
      const text = runsToText(runs);
      if (!text) return [];
      return [
        {
          paraShapeId: 0,
          styleId: 0,
          text,
          runs,
          controls: [],
        },
      ];
    }
    case "ul":
    case "ol": {
      const out: HwpParagraph[] = [];
      let idx = 1;
      for (const child of node.children) {
        if (typeof child === "string") continue;
        if (child.tag !== "li") continue;
        const liPrefix = tag === "ul" ? "- " : `${idx}. `;
        const inner = renderNodeChildren(child, ids, ctx, state, liPrefix);
        if (inner.length === 0) {
          out.push({
            paraShapeId: 0,
            styleId: 0,
            text: liPrefix,
            runs: [{ charShapeId: ids.idDefault, text: liPrefix }],
            controls: [],
          });
        } else {
          out.push(...inner);
        }
        idx++;
      }
      return out;
    }
    case "blockquote": {
      const inner = renderNodeChildren(node, ids, ctx, state, "");
      return inner.map((p) => {
        const text = `> ${p.text}`;
        const runs: HwpRun[] = [
          { charShapeId: p.runs[0]?.charShapeId ?? ids.idDefault, text: "> " },
          ...p.runs,
        ];
        return { ...p, text, runs };
      });
    }
    case "table": {
      return [collectTableParagraph(node, ids, ctx)];
    }
    case "br":
      return [
        {
          paraShapeId: 0,
          styleId: 0,
          text: "",
          runs: [],
          controls: [],
        },
      ];
    case "hr":
      return [
        {
          paraShapeId: 0,
          styleId: 0,
          text: "─────",
          runs: [{ charShapeId: ids.idDefault, text: "─────" }],
          controls: [],
        },
      ];
    case "pre": {
      // pre 안의 텍스트는 모노스페이스로 보존 (개행 유지)
      const monoState: InlineState = { ...state, mono: true };
      const text = extractPreText(node);
      const lines = text.split("\n");
      return lines.map((line) => ({
        paraShapeId: 0,
        styleId: 0,
        text: line,
        runs: line.length > 0 ? [{ charShapeId: pickInlineId(ids, monoState), text: line }] : [],
        controls: [],
      }));
    }
    case "img": {
      const ctrl = imageNodeToControl(node, ctx);
      if (!ctrl) return [];
      return [
        {
          paraShapeId: 0,
          styleId: 0,
          text: "",
          runs: [],
          controls: [ctrl],
        },
      ];
    }
    case "html":
    case "body":
    case "main":
    case "header":
    case "footer":
    case "nav":
    case "aside":
    case "figure":
    case "figcaption":
      return renderNodeChildren(node, ids, ctx, state, prefix);
    default:
      // 인라인 컨테이너로 처리 (span/strong/em/code/a 등)
      // 단, blockquote/list 등은 위에서 처리됨
      return renderNodeChildren(node, ids, ctx, state, prefix);
  }
}

function renderNodeChildren(
  node: HtmlNode,
  ids: ShapeIds,
  ctx: BuildContext,
  state: InlineState,
  prefix: string
): HwpParagraph[] {
  // 자식이 모두 인라인이면 단일 paragraph 로 합치기
  const allInline = node.children.every((c) => typeof c === "string" || isInlineTag(c.tag));
  if (allInline) {
    const runs = collectInlineRuns(node, ids, ctx, state);
    const text = runsToText(runs);
    const controls = collectInlineControls(node, ctx);
    if (!text && controls.length === 0) return [];
    return [
      {
        paraShapeId: 0,
        styleId: 0,
        text: prefix + text,
        runs:
          prefix.length > 0
            ? [{ charShapeId: ids.idDefault, text: prefix }, ...runs]
            : runs,
        controls,
      },
    ];
  }
  // 블록 자식이 섞여있으면 각각 별도 paragraph 로
  const out: HwpParagraph[] = [];
  let blockPrefix = prefix;
  for (const child of node.children) {
    out.push(...renderNode(child, ids, ctx, state, blockPrefix));
    blockPrefix = ""; // prefix 는 첫 paragraph 에만 적용
  }
  return out;
}

function isInlineTag(tag: string): boolean {
  return [
    "a", "abbr", "b", "bdi", "bdo", "br", "cite", "code", "data", "dfn", "em", "i", "kbd",
    "mark", "q", "s", "samp", "small", "span", "strong", "sub", "sup", "time", "u", "var",
    "wbr", "del", "ins", "img",
  ].includes(tag);
}

function collectInlineRuns(
  node: HtmlNode,
  ids: ShapeIds,
  ctx: BuildContext,
  state: InlineState,
  baseId?: number
): HwpRun[] {
  const runs: HwpRun[] = [];
  walkInline(node, ids, ctx, state, runs, baseId ?? null);
  return mergeRuns(runs);
}

function walkInline(
  node: HtmlNode | string,
  ids: ShapeIds,
  ctx: BuildContext,
  state: InlineState,
  runs: HwpRun[],
  baseId: number | null
): void {
  if (typeof node === "string") {
    const text = collapseWhitespace(node);
    if (text.length === 0) return;
    runs.push({
      charShapeId: baseId !== null ? baseId : pickInlineId(ids, state),
      text,
    });
    return;
  }
  const tag = node.tag.toLowerCase();
  if (tag === "img") {
    // 이미지는 별도 컨트롤. 인라인에서는 alt 만 노출.
    const alt = node.attrs.alt;
    if (alt) {
      runs.push({ charShapeId: pickInlineId(ids, state), text: alt });
    }
    return;
  }
  if (tag === "br") {
    runs.push({ charShapeId: pickInlineId(ids, state), text: "\n" });
    return;
  }
  let nextState = state;
  if (tag === "strong" || tag === "b") nextState = { ...nextState, bold: true };
  if (tag === "em" || tag === "i") nextState = { ...nextState, italic: true };
  if (tag === "code" || tag === "samp" || tag === "kbd") nextState = { ...nextState, mono: true };
  for (const child of node.children) {
    walkInline(child, ids, ctx, nextState, runs, baseId);
  }
}

function collectInlineControls(node: HtmlNode, ctx: BuildContext): HwpControl[] {
  const out: HwpControl[] = [];
  const visit = (n: HtmlNode | string): void => {
    if (typeof n === "string") return;
    if (n.tag === "img") {
      const ctrl = imageNodeToControl(n, ctx);
      if (ctrl) out.push(ctrl);
      return;
    }
    for (const c of n.children) visit(c);
  };
  for (const c of node.children) visit(c);
  return out;
}

function collectTableParagraph(
  table: HtmlNode,
  ids: ShapeIds,
  ctx: BuildContext
): HwpParagraph {
  // <tr> 수집 (thead/tbody/tfoot 평탄화)
  const trs: HtmlNode[] = [];
  const collectTrs = (n: HtmlNode): void => {
    for (const c of n.children) {
      if (typeof c === "string") continue;
      if (c.tag === "tr") trs.push(c);
      else if (c.tag === "thead" || c.tag === "tbody" || c.tag === "tfoot") collectTrs(c);
    }
  };
  collectTrs(table);

  let maxCols = 0;
  const tcs: { row: number; col: number; isHeader: boolean; node: HtmlNode }[] = [];
  for (let r = 0; r < trs.length; r++) {
    let col = 0;
    for (const c of trs[r].children) {
      if (typeof c === "string") continue;
      if (c.tag === "td" || c.tag === "th") {
        tcs.push({ row: r, col, isHeader: c.tag === "th", node: c });
        col++;
      }
    }
    if (col > maxCols) maxCols = col;
  }

  const cells: HwpTableCell[] = tcs.map(({ row, col, isHeader, node }) => {
    const colSpan = Math.max(1, Number(node.attrs.colspan ?? "1") || 1);
    const rowSpan = Math.max(1, Number(node.attrs.rowspan ?? "1") || 1);
    const baseId = isHeader ? ids.idBold : ids.idDefault;
    const runs = collectInlineRuns(node, ids, ctx, { bold: isHeader, italic: false, mono: false }, baseId);
    return {
      col,
      row,
      colSpan,
      rowSpan,
      paragraphs: [
        {
          paraShapeId: 0,
          styleId: 0,
          text: runsToText(runs),
          runs,
          controls: [],
        },
      ],
    };
  });

  return {
    paraShapeId: 0,
    styleId: 0,
    text: "",
    runs: [],
    controls: [{ kind: "table", rowCount: trs.length, colCount: maxCols, cells }],
  };
}

function imageNodeToControl(node: HtmlNode, ctx: BuildContext): HwpControl | null {
  const src = node.attrs.src ?? "";
  const match = /^data:([^;]+);base64,(.*)$/i.exec(src);
  if (!match) return null;
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

function extractPreText(node: HtmlNode): string {
  let out = "";
  const visit = (n: HtmlNode | string): void => {
    if (typeof n === "string") {
      out += n;
      return;
    }
    if (n.tag === "br") {
      out += "\n";
      return;
    }
    for (const c of n.children) visit(c);
  };
  for (const c of node.children) visit(c);
  return out;
}

function pickInlineId(ids: ShapeIds, state: InlineState): number {
  if (state.mono) return ids.idMono;
  if (state.bold && state.italic) return ids.idBoldItalic;
  if (state.bold) return ids.idBold;
  if (state.italic) return ids.idItalic;
  return ids.idDefault;
}

function mergeRuns(runs: HwpRun[]): HwpRun[] {
  const out: HwpRun[] = [];
  for (const r of runs) {
    if (r.text.length === 0) continue;
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

function collapseWhitespace(s: string): string {
  // HTML 텍스트 노드의 연속 공백을 단일 공백으로
  return s.replace(/[\s ]+/g, " ");
}

// ============================================================
// 기본 IR
// ============================================================

function defaultCharShape(): HwpCharShape {
  return {
    faceNameIds: { hangul: 0, latin: 1, hanja: 0, japanese: 0, other: 0, symbol: 0, user: 0 },
    baseSize: 1000,
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
