/**
 * 컨트롤 파싱 (CTRL_HEADER 의 ctrl_id 별 분기).
 *
 * 1차 포팅 범위: 표(tbl) / 그림(gso+pic) / 머리말(head) / 꼬리말(foot) / 각주(fn)
 *
 * 원작: rhwp/src/parser/control.rs (MIT, Edward Kim)
 */

import { ByteReader } from "./byteReader.js";
import type { Record } from "./record.js";
import {
  CTRL_TABLE,
  CTRL_GEN_SHAPE,
  CTRL_HEADER,
  CTRL_FOOTER,
  CTRL_FOOTNOTE,
  CTRL_EQUATION,
  HWPTAG_TABLE,
  HWPTAG_LIST_HEADER,
  HWPTAG_SHAPE_COMPONENT,
  HWPTAG_SHAPE_COMPONENT_PICTURE,
  HWPTAG_SHAPE_COMPONENT_LINE,
  HWPTAG_SHAPE_COMPONENT_RECTANGLE,
  HWPTAG_SHAPE_COMPONENT_ELLIPSE,
  HWPTAG_SHAPE_COMPONENT_ARC,
  HWPTAG_SHAPE_COMPONENT_POLYGON,
  HWPTAG_SHAPE_COMPONENT_CURVE,
  HWPTAG_EQEDIT,
  ctrlIdToString,
  isFieldCtrlId,
} from "./tags.js";
import type {
  HwpControl,
  HwpParagraph,
  HwpTableCell,
} from "./types.js";

/**
 * CTRL_HEADER 레코드와 그 자식 레코드들을 받아 HwpControl 로 변환.
 *
 * @param ctrlHeader CTRL_HEADER 레코드 자체
 * @param children CTRL_HEADER 의 자식 레코드들 (level > ctrlHeader.level). subtree 의 후손까지 포함.
 * @param parseParagraphList 재귀 파싱용 콜백 — 셀/머리말 등 내부 문단 추출
 */
export function parseCtrlHeader(
  ctrlHeader: Record,
  children: Record[],
  parseParagraphList: (records: Record[], baseLevel: number) => HwpParagraph[]
): HwpControl {
  if (ctrlHeader.data.byteLength < 4) {
    return { kind: "unknown", ctrlId: "" };
  }
  // ctrl_id 는 첫 4바이트의 u32(LE) 값. tags.ts 의 ctrlId() 와 동일한 big-endian 표기 정수를 반환하도록 변환.
  // 파일에는 "secd" 가 [0x64, 0x63, 0x65, 0x73] 순서(LE u32)로 저장되며, 같은 4글자를 BE u32 로 인코딩한 값과 동일.
  const r = new ByteReader(ctrlHeader.data);
  const ctrlIdRaw = r.readU32(); // LE u32 → 그대로 BE 인코딩한 ctrl_id 와 일치
  const ctrlData = ctrlHeader.data.subarray(4);

  switch (ctrlIdRaw) {
    case CTRL_TABLE:
      return parseTableControl(ctrlHeader, children, parseParagraphList);
    case CTRL_GEN_SHAPE:
      return parseGsoControl(ctrlHeader, children);
    case CTRL_HEADER:
      return {
        kind: "header",
        paragraphs: collectListHeaderParagraphs(ctrlHeader, children, parseParagraphList),
      };
    case CTRL_FOOTER:
      return {
        kind: "footer",
        paragraphs: collectListHeaderParagraphs(ctrlHeader, children, parseParagraphList),
      };
    case CTRL_FOOTNOTE:
      return {
        kind: "footnote",
        paragraphs: collectListHeaderParagraphs(ctrlHeader, children, parseParagraphList),
      };
    case CTRL_EQUATION:
      return parseEquationControl(ctrlHeader, children);
    default:
      if (isFieldCtrlId(ctrlIdRaw)) {
        return parseFieldControl(ctrlIdRaw, ctrlData);
      }
      return { kind: "unknown", ctrlId: ctrlIdToString(ctrlIdRaw) };
  }
}

// ============================================================
// 표
// ============================================================

function parseTableControl(
  ctrlHeader: Record,
  children: Record[],
  parseParagraphList: (records: Record[], baseLevel: number) => HwpParagraph[]
): HwpControl {
  const baseLevel = ctrlHeader.level;
  let rowCount = 0;
  let colCount = 0;
  const cells: HwpTableCell[] = [];

  // 자식 중 직접 자식(level == baseLevel + 1) 만 처리.
  // - HWPTAG_TABLE: 표 메타데이터 (행/열)
  // - HWPTAG_LIST_HEADER: 셀 (그 자체는 레벨 baseLevel+1)
  //   각 셀의 내부 문단 PARA_HEADER 는 level baseLevel+2

  let tableSeen = false;

  for (let i = 0; i < children.length; i++) {
    const r = children[i];
    if (r.level !== baseLevel + 1) continue;

    if (r.tagId === HWPTAG_TABLE) {
      tableSeen = true;
      const meta = parseTableMeta(r.data);
      rowCount = meta.rowCount;
      colCount = meta.colCount;
    } else if (r.tagId === HWPTAG_LIST_HEADER) {
      // TABLE 레코드 이전의 LIST_HEADER 는 캡션 — 1차 포팅에서는 무시
      if (!tableSeen) continue;

      // 셀 메타데이터 파싱 (LIST_HEADER 의 데이터)
      const cellMeta = parseCellMeta(r.data);

      // HWP 셀 구조 특이점: LIST_HEADER 와 그 셀의 PARA_HEADER 가 같은 level 이다.
      // 따라서 셀 범위는 다음 LIST_HEADER 또는 TABLE (같은 level) 까지.
      // PARA_HEADER 는 같은 level 이라도 셀 내용이므로 포함시킨다.
      const cellChildren: Record[] = [];
      for (let j = i + 1; j < children.length; j++) {
        const cr = children[j];
        if (cr.level < baseLevel + 1) break; // 서브트리 탈출
        if (cr.level === baseLevel + 1) {
          if (cr.tagId === HWPTAG_LIST_HEADER || cr.tagId === HWPTAG_TABLE) break;
        }
        cellChildren.push(cr);
      }
      // 셀 문단은 LIST_HEADER 와 같은 level (baseLevel + 1)
      const cellParagraphs = parseParagraphList(cellChildren, baseLevel + 1);
      cells.push({
        col: cellMeta.col,
        row: cellMeta.row,
        colSpan: cellMeta.colSpan,
        rowSpan: cellMeta.rowSpan,
        paragraphs: cellParagraphs,
      });
    }
  }

  return { kind: "table", rowCount, colCount, cells };
}

interface TableMeta {
  rowCount: number;
  colCount: number;
}

function parseTableMeta(data: Uint8Array): TableMeta {
  const r = new ByteReader(data);
  if (r.remaining() < 8) return { rowCount: 0, colCount: 0 };
  r.readU32(); // attr
  const rowCount = r.readU16();
  const colCount = r.readU16();
  return { rowCount, colCount };
}

interface CellMeta {
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
}

function parseCellMeta(data: Uint8Array): CellMeta {
  const r = new ByteReader(data);
  // LIST_HEADER 공통: nParagraphs(u16) + listAttr(u32) + listHeaderWidthRef(u16)
  if (r.remaining() < 8) return { col: 0, row: 0, colSpan: 1, rowSpan: 1 };
  r.readU16();
  r.readU32();
  r.readU16();
  // 셀 메타: col(u16) row(u16) colSpan(u16) rowSpan(u16)
  if (r.remaining() < 8) return { col: 0, row: 0, colSpan: 1, rowSpan: 1 };
  const col = r.readU16();
  const row = r.readU16();
  const colSpan = r.readU16();
  const rowSpan = r.readU16();
  return {
    col,
    row,
    colSpan: colSpan === 0 ? 1 : colSpan,
    rowSpan: rowSpan === 0 ? 1 : rowSpan,
  };
}

// ============================================================
// 그리기 개체 (gso) — 1차 포팅: PICTURE 만 추출
// ============================================================

function parseGsoControl(ctrlHeader: Record, children: Record[]): HwpControl {
  const baseLevel = ctrlHeader.level;

  // 그림이 우선 — SHAPE_COMPONENT_PICTURE 레코드 검색
  for (const r of children) {
    if (r.tagId === HWPTAG_SHAPE_COMPONENT_PICTURE && r.level <= baseLevel + 3) {
      const binDataId = parsePictureBinDataId(r.data);
      if (binDataId !== undefined) {
        return { kind: "picture", binDataId };
      }
    }
  }

  // 도형 (line/rect/ellipse/arc/polygon/curve)
  for (const r of children) {
    if (r.level > baseLevel + 3) continue;
    switch (r.tagId) {
      case HWPTAG_SHAPE_COMPONENT_LINE:
        return parseLineShape(r.data);
      case HWPTAG_SHAPE_COMPONENT_RECTANGLE:
        return { kind: "shape", shapeType: "rectangle" };
      case HWPTAG_SHAPE_COMPONENT_ELLIPSE:
        return { kind: "shape", shapeType: "ellipse" };
      case HWPTAG_SHAPE_COMPONENT_ARC:
        return { kind: "shape", shapeType: "arc" };
      case HWPTAG_SHAPE_COMPONENT_POLYGON:
        return { kind: "shape", shapeType: "polygon" };
      case HWPTAG_SHAPE_COMPONENT_CURVE:
        return { kind: "shape", shapeType: "curve" };
    }
  }

  return { kind: "unknown", ctrlId: "gso " };
}

function parseLineShape(data: Uint8Array): HwpControl {
  // SHAPE_LINE: x1(i32), y1(i32), x2(i32), y2(i32) + 추가 속성
  if (data.byteLength < 16) return { kind: "shape", shapeType: "line" };
  const r = new ByteReader(data);
  const x1 = r.readI32();
  const y1 = r.readI32();
  const x2 = r.readI32();
  const y2 = r.readI32();
  return { kind: "shape", shapeType: "line", x1, y1, x2, y2 };
}

// ============================================================
// 수식
// ============================================================

function parseEquationControl(ctrlHeader: Record, children: Record[]): HwpControl {
  // EQEDIT 레코드를 자식에서 찾는다.
  // EQEDIT 레이아웃: u32 attr + u16 width + u16 height + u32 charCount(?) + WCHAR script + ...
  // 여기서는 단순히 UTF-16 문자열을 추출해서 반환.
  for (const r of children) {
    if (r.tagId === HWPTAG_EQEDIT) {
      return { kind: "equation", script: extractEquationScript(r.data) };
    }
  }
  return { kind: "equation", script: "" };
}

function extractEquationScript(data: Uint8Array): string {
  // 보수적으로 파싱: u32 attr 다음 가변. HWP 스펙상:
  // u32 attr | i16 nLine | i16 lineHeight | u8 charScale | u32 baseUnit |
  // u16 strLen | WCHAR script[strLen] | u16 charSet | i32 fontSize ...
  // strLen 이 어디인지 찾기 위해 처음 몇 u16 의 패턴을 검사.
  const r = new ByteReader(data);
  if (r.remaining() < 4) return "";
  r.readU32(); // attr
  // nLine, lineHeight (i16 x 2), charScale (u8), baseUnit (u32) — 11바이트
  if (r.remaining() < 11) return "";
  r.skip(11);
  if (r.remaining() < 2) return "";
  const strLen = r.readU16();
  if (strLen === 0 || strLen > 10000) return "";
  const need = strLen * 2;
  if (r.remaining() < need) return "";
  try {
    return r.readUtf16(strLen);
  } catch {
    return "";
  }
}

/**
 * SHAPE_COMPONENT_PICTURE 레코드에서 bin_data_id 추출.
 * 레이아웃 (rhwp 기준):
 *   border_color  u32       (4)
 *   border_width  i32       (4)
 *   border_attr   u32       (4)
 *   border_x[4]   i32 each (16)
 *   border_y[4]   i32 each (16)
 *   crop          4x i32   (16)
 *   padding       4x i16    (8)
 *   brightness    i8        (1)
 *   contrast      i8        (1)
 *   effect        u8        (1)
 *   bin_data_id   u16       (2) ← offset 71
 */
function parsePictureBinDataId(data: Uint8Array): number | undefined {
  const OFFSET = 4 + 4 + 4 + 16 + 16 + 16 + 8 + 1 + 1 + 1; // 71
  if (data.byteLength < OFFSET + 2) return undefined;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return view.getUint16(OFFSET, true);
}

// ============================================================
// LIST_HEADER 기반 컨트롤 (head/foot/fn)
// ============================================================

function collectListHeaderParagraphs(
  ctrlHeader: Record,
  children: Record[],
  parseParagraphList: (records: Record[], baseLevel: number) => HwpParagraph[]
): HwpParagraph[] {
  const baseLevel = ctrlHeader.level;
  // 첫 LIST_HEADER (level baseLevel+1) 의 자식 PARA_HEADER (level baseLevel+2) 수집
  const lhIdx = children.findIndex(
    (r) => r.tagId === HWPTAG_LIST_HEADER && r.level === baseLevel + 1
  );
  if (lhIdx < 0) return [];

  const subtree: Record[] = [];
  for (let j = lhIdx + 1; j < children.length; j++) {
    if (children[j].level <= baseLevel + 1) break;
    subtree.push(children[j]);
  }
  return parseParagraphList(subtree, baseLevel + 2);
}

// ============================================================
// 필드 컨트롤
// ============================================================

function parseFieldControl(ctrlIdRaw: number, ctrlData: Uint8Array): HwpControl {
  const id = ctrlIdToString(ctrlIdRaw);
  if (ctrlData.byteLength < 7) return { kind: "field", ctrlId: id };

  const r = new ByteReader(ctrlData);
  r.readU32(); // properties
  r.readU8(); // extra
  const commandLen = r.readU16();
  let command: string | undefined;
  if (commandLen > 0 && r.remaining() >= commandLen * 2) {
    try {
      command = r.readUtf16(commandLen);
    } catch {
      command = undefined;
    }
  }
  return { kind: "field", ctrlId: id, command };
}
