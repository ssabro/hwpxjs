/**
 * HwpDocument IR → Markdown.
 *
 * 보존:
 *   - 문단 텍스트
 *   - 글자 모양 굵게/기울임 (charShape lookup)
 *   - 표 (markdown table; 셀 병합은 평탄화)
 *   - 이미지 (`![](BinData/imageN.ext)` 또는 `data:` URI 인라인)
 *   - 머리말/꼬리말/각주 (인용 블록)
 *
 * 의도적으로 단순화한 부분:
 *   - 헤딩 레벨 자동 판별 안 함 (paraShape.heading 정보 부족)
 *   - 색상/사이즈는 마크다운 표준에서 표현 못 함 → 무시
 *   - 줄바꿈은 \n\n 으로 문단 구분
 */

import { detectImageMime } from "./binData.js";
import type {
  HwpDocument,
  HwpParagraph,
  HwpRun,
  HwpTableControl,
  HwpTableCell,
  HwpCharShape,
} from "./types.js";

export interface MarkdownWriteOptions {
  /** 이미지를 base64 data URI 로 인라인 (브라우저에서 즉시 렌더링) */
  embedImages?: boolean;
  /** 이미지 src 경로 변환 (embedImages=false 일 때) */
  imageSrcResolver?: (binPath: string, storageId: number) => string;
}

export function hwpDocumentToMarkdown(
  doc: HwpDocument,
  options?: MarkdownWriteOptions
): string {
  const blocks: string[] = [];
  for (const section of doc.sections) {
    for (const para of section.paragraphs) {
      const md = renderParagraph(para, doc, options);
      if (md.length > 0) blocks.push(md);
    }
  }
  return blocks.join("\n\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

function renderParagraph(
  p: HwpParagraph,
  doc: HwpDocument,
  options?: MarkdownWriteOptions
): string {
  const parts: string[] = [];

  // 본문 runs (charShape 기반 굵게/기울임 보존)
  if (p.runs.length > 0) {
    parts.push(renderRuns(p.runs, doc));
  } else if (p.text.length > 0) {
    parts.push(escapeMd(p.text));
  }

  // 컨트롤
  for (const ctrl of p.controls) {
    switch (ctrl.kind) {
      case "table":
        parts.push(renderTable(ctrl, doc, options));
        break;
      case "picture": {
        const md = renderPicture(ctrl.binDataId, doc, options);
        if (md) parts.push(md);
        break;
      }
      case "header":
      case "footer":
      case "footnote": {
        const inner = ctrl.paragraphs
          .map((q) => renderParagraph(q, doc, options))
          .filter((s) => s.length > 0)
          .join("\n");
        if (inner) {
          // 인용 블록으로 표시
          parts.push(inner.split("\n").map((line) => `> ${line}`).join("\n"));
        }
        break;
      }
      case "equation":
        if (ctrl.script.length > 0) {
          parts.push("```\n" + ctrl.script + "\n```");
        }
        break;
      default:
        break;
    }
  }

  return parts.filter((s) => s.length > 0).join("\n\n");
}

function renderRuns(runs: HwpRun[], doc: HwpDocument): string {
  const out: string[] = [];
  for (const run of runs) {
    if (run.text.length === 0) continue;
    const cs = doc.docInfo.charShapes[run.charShapeId];
    out.push(applyInlineStyle(escapeMd(run.text), cs));
  }
  return out.join("");
}

function applyInlineStyle(text: string, cs: HwpCharShape | undefined): string {
  if (!cs) return text;
  let s = text;
  if (cs.bold) s = `**${s}**`;
  if (cs.italic) s = `*${s}*`;
  // 밑줄/취소선: 표준 MD 부재 — 생략
  return s;
}

function renderTable(
  t: HwpTableControl,
  doc: HwpDocument,
  options?: MarkdownWriteOptions
): string {
  if (t.rowCount === 0 || t.colCount === 0) return "";
  // 셀을 행별로 그룹핑하고 col 순으로 정렬
  const grid: (HwpTableCell | undefined)[][] = Array.from({ length: t.rowCount }, () =>
    new Array(t.colCount).fill(undefined)
  );
  for (const cell of t.cells) {
    if (cell.row >= 0 && cell.row < t.rowCount && cell.col >= 0 && cell.col < t.colCount) {
      // 병합된 셀 영역도 마크다운에서는 동일 컨텐츠로 채움 (표준 MD 표는 병합 미지원)
      for (let r = 0; r < cell.rowSpan; r++) {
        for (let c = 0; c < cell.colSpan; c++) {
          const ri = cell.row + r;
          const ci = cell.col + c;
          if (ri < t.rowCount && ci < t.colCount && !grid[ri][ci]) {
            grid[ri][ci] = cell;
          }
        }
      }
    }
  }

  const rows: string[][] = [];
  for (const row of grid) {
    const cellTexts = row.map((cell) => {
      if (!cell) return "";
      const inner = cell.paragraphs
        .map((q) => renderParagraph(q, doc, options))
        .filter((s) => s.length > 0)
        .join(" ")
        .replace(/\n+/g, " ")
        .replace(/\|/g, "\\|");
      return inner;
    });
    rows.push(cellTexts);
  }

  if (rows.length === 0) return "";

  // 첫 행을 헤더로 (마크다운 표 규칙 — 항상 헤더 1행 + 구분선)
  const header = rows[0];
  const sep = header.map(() => "---");
  const body = rows.slice(1);

  const fmt = (cells: string[]) => `| ${cells.map((c) => c || " ").join(" | ")} |`;
  const lines: string[] = [];
  lines.push(fmt(header));
  lines.push(fmt(sep));
  for (const row of body) lines.push(fmt(row));
  return lines.join("\n");
}

function renderPicture(
  binDataId: number,
  doc: HwpDocument,
  options?: MarkdownWriteOptions
): string {
  const entry = doc.binData.get(binDataId);
  if (!entry) return "";
  const ext = entry.extension.toLowerCase();
  const binPath = `BinData/image${binDataId}.${ext}`;

  if (options?.embedImages) {
    const mime = detectImageMime(ext);
    const b64 = bytesToBase64(entry.data);
    return `![](data:${mime};base64,${b64})`;
  }

  if (options?.imageSrcResolver) {
    return `![](${options.imageSrcResolver(binPath, binDataId)})`;
  }
  return `![](${binPath})`;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  // 브라우저 fallback
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return (globalThis as { btoa?: (s: string) => string }).btoa?.(bin) ?? "";
}

/**
 * 마크다운 메타문자 이스케이프.
 * 너무 공격적으로 하면 문서가 읽기 어려워지므로 핵심만 처리.
 *   - 백슬래시
 *   - 인라인 강조: `*`, `_`, `` ` ``, `~`
 *   - 줄 시작의 헤딩(#)/인용(>) 마커
 *
 * 줄 시작의 `1.`, `-`, `+` 는 일부러 이스케이프하지 않는다 — 일반 텍스트(특히 날짜)에 너무 자주 등장.
 */
function escapeMd(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/([*_`~])/g, "\\$1")
    .replace(/^([#>])/gm, "\\$1");
}
