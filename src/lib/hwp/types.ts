/**
 * HWP 문서 IR (Intermediate Representation) 타입.
 * rhwp 의 model 모듈을 단순화하여 HWPX 변환에 필요한 정보만 정의.
 */

import type { FileHeader } from "./fileHeader.js";

export interface HwpRun {
  /** 글자 모양 ID (DocInfo의 CHAR_SHAPE 인덱스) */
  charShapeId: number;
  /** 텍스트 — 일반 문자만 (컨트롤 문자는 별도 controls 에 표시) */
  text: string;
}

export interface HwpParagraph {
  paraShapeId: number;
  styleId: number;
  /** 문단 텍스트 (모든 run을 이은 평문) */
  text: string;
  /** 글자 모양 변화점 기준 run 분할 */
  runs: HwpRun[];
  /** 인라인 컨트롤들 (표/그림/필드/머리말 등) */
  controls: HwpControl[];
}

export interface HwpSection {
  paragraphs: HwpParagraph[];
}

// ============================================================
// 컨트롤
// ============================================================

export type HwpControl =
  | HwpTableControl
  | HwpPictureControl
  | HwpHeaderControl
  | HwpFooterControl
  | HwpFootnoteControl
  | HwpFieldControl
  | HwpShapeControl
  | HwpEquationControl
  | HwpUnknownControl;

export interface HwpShapeControl {
  kind: "shape";
  /** "line" | "rectangle" | "ellipse" | "arc" | "polygon" | "curve" */
  shapeType: "line" | "rectangle" | "ellipse" | "arc" | "polygon" | "curve";
  /** 시작 좌표 (HWPUNIT) */
  x1?: number;
  y1?: number;
  /** 끝 좌표 (HWPUNIT) */
  x2?: number;
  y2?: number;
}

export interface HwpEquationControl {
  kind: "equation";
  /** 수식 스크립트 (HWP 자체 수식 언어, LaTeX 와 비슷하지만 다름) */
  script: string;
}

export interface HwpTableControl {
  kind: "table";
  rowCount: number;
  colCount: number;
  cells: HwpTableCell[];
}

export interface HwpTableCell {
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
  paragraphs: HwpParagraph[];
}

export interface HwpPictureControl {
  kind: "picture";
  /** DocInfo BIN_DATA 의 storageId */
  binDataId: number;
}

export interface HwpHeaderControl {
  kind: "header";
  paragraphs: HwpParagraph[];
}

export interface HwpFooterControl {
  kind: "footer";
  paragraphs: HwpParagraph[];
}

export interface HwpFootnoteControl {
  kind: "footnote";
  paragraphs: HwpParagraph[];
}

export interface HwpFieldControl {
  kind: "field";
  /** "%hlk", "%clk", "%dte" 등 */
  ctrlId: string;
  /** 필드 명령 (UTF-16) */
  command?: string;
}

export interface HwpUnknownControl {
  kind: "unknown";
  /** 4글자 ctrl_id ("tbl ", "secd", "cold", "$pic" 등) */
  ctrlId: string;
}

// ============================================================
// DocInfo 참조 테이블
// ============================================================

export interface HwpDocInfo {
  /** 언어별 폰트 그룹 [HANGUL, LATIN, HANJA, JAPANESE, OTHER, SYMBOL, USER] */
  fontFaces: HwpFaceName[][];
  charShapes: HwpCharShape[];
  paraShapes: HwpParaShape[];
  styles: HwpStyle[];
  binData: HwpBinDataRef[];
  /** 테두리/채우기 정의 — paraShape 의 borderFillIDRef 가 참조 */
  borderFills: HwpBorderFill[];
  /** 번호 매기기 — paraShape 의 numberingIDRef 가 참조 */
  numberings: HwpNumbering[];
  /** 글머리표 */
  bullets: HwpBullet[];
  /** 탭 정의 — paraShape 의 tabPrIDRef 가 참조 */
  tabDefs: HwpTabDef[];
}

export interface HwpBorderLine {
  /** 0=NONE, 1=SOLID, 2=DASH, 3=DOT, 4=DASH_DOT, 5=DASH_DOT_DOT, 6=LONG_DASH, 7=CIRCLE,
   *  8=DOUBLE, 9=THIN_THICK_DOUBLE, 10=THICK_THIN_DOUBLE, 11=THIN_THICK_THIN_TRIPLE,
   *  12=WAVE, 13=DOUBLE_WAVE, 14=THICK_3D, 15=THICK_3D_REVERSE, 16=THIN_3D, 17=THIN_3D_REVERSE */
  lineType: number;
  /** HWP 너비 인덱스 (0..15). mm 변환은 BORDER_WIDTH_MM 표 참조. */
  widthIndex: number;
  /** 0xAABBGGRR */
  color: number;
}

export interface HwpDiagonalLine {
  /** 0=NONE, 1=FORWARD, 2=BACKWARD, 3=CROSS */
  diagonalType: number;
  widthIndex: number;
  color: number;
}

export interface HwpSolidFill {
  /** 0xAABBGGRR */
  backgroundColor: number;
  patternColor: number;
  /** -1=NONE, 0=HORIZONTAL, 1=VERTICAL, ... */
  patternType: number;
}

export interface HwpBorderFill {
  /** 비트필드 속성 (3D, shadow, centerLine 등) */
  attr: number;
  /** [left, right, top, bottom] */
  borders: [HwpBorderLine, HwpBorderLine, HwpBorderLine, HwpBorderLine];
  diagonal: HwpDiagonalLine;
  /** 채우기. solid 만 보존 (gradient/image 는 미보존) */
  fill?: HwpSolidFill;
}

export interface HwpNumbering {
  startNumber: number;
  /** 수준별 (1~7) 번호 형식 문자열 (예: "^1.", "^1.^2.", "^1)") */
  levelFormats: string[];
}

export interface HwpBullet {
  /** 글머리 문자 (예: ●, ○, ■, …) */
  bulletChar: string;
}

export interface HwpTabDef {
  attr: number;
  autoTabLeft: boolean;
  autoTabRight: boolean;
}

export interface HwpFaceName {
  name: string;
  substituteName?: string;
}

export interface HwpCharShape {
  faceNameIds: {
    hangul: number;
    latin: number;
    hanja: number;
    japanese: number;
    other: number;
    symbol: number;
    user: number;
  };
  baseSize: number;
  property: number;
  textColor: number;
  shadeColor: number;
  underlineColor: number;
  shadowColor: number;
  outlineColor?: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikeout: boolean;
}

export interface HwpParaShape {
  alignment:
    | "left"
    | "right"
    | "center"
    | "justify"
    | "distribute"
    | "distributeSpace"
    | "unknown";
  property: number;
  leftMargin: number;
  rightMargin: number;
  indent: number;
  prevSpacing: number;
  nextSpacing: number;
  lineSpacing: number;
}

export interface HwpStyle {
  name: string;
  engName?: string;
  paraShapeId: number;
  charShapeId: number;
}

export interface HwpBinDataRef {
  storageId: number;
  extension?: string;
  type: "embedding" | "storage" | "link";
}

export interface HwpDocument {
  header: FileHeader;
  docInfo: HwpDocInfo;
  sections: HwpSection[];
  binData: Map<number, { data: Uint8Array; extension: string }>;
}
