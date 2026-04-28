/**
 * HWP 5.0 레코드 TagID 및 컨트롤 ID 상수.
 * HWPTAG_BEGIN(0x010) 기준 오프셋으로 정의.
 *
 * 원작: rhwp/src/parser/tags.rs (MIT, Copyright (c) 2025-2026 Edward Kim)
 */

export const HWPTAG_BEGIN = 0x010;

// ============================================================
// DocInfo 태그 (HWPTAG_BEGIN + 0 ~ 49)
// ============================================================
export const HWPTAG_DOCUMENT_PROPERTIES = HWPTAG_BEGIN + 0;
export const HWPTAG_ID_MAPPINGS = HWPTAG_BEGIN + 1;
export const HWPTAG_BIN_DATA = HWPTAG_BEGIN + 2;
export const HWPTAG_FACE_NAME = HWPTAG_BEGIN + 3;
export const HWPTAG_BORDER_FILL = HWPTAG_BEGIN + 4;
export const HWPTAG_CHAR_SHAPE = HWPTAG_BEGIN + 5;
export const HWPTAG_TAB_DEF = HWPTAG_BEGIN + 6;
export const HWPTAG_NUMBERING = HWPTAG_BEGIN + 7;
export const HWPTAG_BULLET = HWPTAG_BEGIN + 8;
export const HWPTAG_PARA_SHAPE = HWPTAG_BEGIN + 9;
export const HWPTAG_STYLE = HWPTAG_BEGIN + 10;
export const HWPTAG_DOC_DATA = HWPTAG_BEGIN + 11;
export const HWPTAG_DISTRIBUTE_DOC_DATA = HWPTAG_BEGIN + 12;
// (HWPTAG_BEGIN + 13 예약)
export const HWPTAG_COMPATIBLE_DOCUMENT = HWPTAG_BEGIN + 14;
export const HWPTAG_LAYOUT_COMPATIBILITY = HWPTAG_BEGIN + 15;
export const HWPTAG_TRACKCHANGE = HWPTAG_BEGIN + 16;

// ============================================================
// BodyText 태그 (HWPTAG_BEGIN + 50 ~)
// ============================================================
export const HWPTAG_PARA_HEADER = HWPTAG_BEGIN + 50;
export const HWPTAG_PARA_TEXT = HWPTAG_BEGIN + 51;
export const HWPTAG_PARA_CHAR_SHAPE = HWPTAG_BEGIN + 52;
export const HWPTAG_PARA_LINE_SEG = HWPTAG_BEGIN + 53;
export const HWPTAG_PARA_RANGE_TAG = HWPTAG_BEGIN + 54;
export const HWPTAG_CTRL_HEADER = HWPTAG_BEGIN + 55;
export const HWPTAG_LIST_HEADER = HWPTAG_BEGIN + 56;
export const HWPTAG_PAGE_DEF = HWPTAG_BEGIN + 57;
export const HWPTAG_FOOTNOTE_SHAPE = HWPTAG_BEGIN + 58;
export const HWPTAG_PAGE_BORDER_FILL = HWPTAG_BEGIN + 59;
export const HWPTAG_SHAPE_COMPONENT = HWPTAG_BEGIN + 60;
export const HWPTAG_TABLE = HWPTAG_BEGIN + 61;
export const HWPTAG_SHAPE_COMPONENT_LINE = HWPTAG_BEGIN + 62;
export const HWPTAG_SHAPE_COMPONENT_RECTANGLE = HWPTAG_BEGIN + 63;
export const HWPTAG_SHAPE_COMPONENT_ELLIPSE = HWPTAG_BEGIN + 64;
export const HWPTAG_SHAPE_COMPONENT_ARC = HWPTAG_BEGIN + 65;
export const HWPTAG_SHAPE_COMPONENT_POLYGON = HWPTAG_BEGIN + 66;
export const HWPTAG_SHAPE_COMPONENT_CURVE = HWPTAG_BEGIN + 67;
export const HWPTAG_SHAPE_COMPONENT_OLE = HWPTAG_BEGIN + 68;
export const HWPTAG_SHAPE_COMPONENT_PICTURE = HWPTAG_BEGIN + 69;
export const HWPTAG_SHAPE_COMPONENT_CONTAINER = HWPTAG_BEGIN + 70;
export const HWPTAG_CTRL_DATA = HWPTAG_BEGIN + 71;
export const HWPTAG_EQEDIT = HWPTAG_BEGIN + 72;
// (HWPTAG_BEGIN + 73 예약)
export const HWPTAG_SHAPE_COMPONENT_TEXTART = HWPTAG_BEGIN + 74;
export const HWPTAG_FORM_OBJECT = HWPTAG_BEGIN + 75;
export const HWPTAG_MEMO_SHAPE = HWPTAG_BEGIN + 76;
export const HWPTAG_MEMO_LIST = HWPTAG_BEGIN + 77;
export const HWPTAG_FORBIDDEN_CHAR = HWPTAG_BEGIN + 78;
export const HWPTAG_CHART_DATA = HWPTAG_BEGIN + 79;

// ============================================================
// 인라인 컨트롤 코드 (텍스트 내 특수 문자 — UTF-16 코드 포인트)
// ============================================================
export const CHAR_SECTION_COLUMN_DEF = 0x0002;
export const CHAR_FIELD_BEGIN = 0x0003;
export const CHAR_FIELD_END = 0x0004;
export const CHAR_INLINE_NON_TEXT = 0x0008;
export const CHAR_TAB = 0x0009;
export const CHAR_LINE_BREAK = 0x000a;
export const CHAR_EXTENDED_CTRL = 0x000b;
export const CHAR_PARA_BREAK = 0x000d;
export const CHAR_NBSPACE = 0x0018;
export const CHAR_FIXED_WIDTH_SPACE = 0x0019;
export const CHAR_HYPHEN = 0x001e;
export const CHAR_FIXED_WIDTH_SPACE_31 = 0x001f;

/**
 * 인라인 컨트롤 코드는 16비트 자리에 1~2개 등장한다.
 * 길이 1: 일반 문자 / Tab / Line break / Para break
 * 길이 8: ExtendedCtrl 등 (ctrl_id + 4바이트 + 동일 코드 반복)
 *
 * rhwp 기준 8자리(=16바이트)를 차지하는 컨트롤 코드 집합.
 */
export function isExtendedCtrlChar(code: number): boolean {
  return (
    code === CHAR_SECTION_COLUMN_DEF ||
    code === CHAR_FIELD_BEGIN ||
    code === CHAR_FIELD_END ||
    code === CHAR_INLINE_NON_TEXT ||
    code === CHAR_EXTENDED_CTRL
  );
}

// ============================================================
// 컨트롤 ID (4바이트 ASCII → u32, big-endian 인코딩)
// ============================================================
function ctrlId(s: string): number {
  if (s.length !== 4) throw new Error(`ctrlId requires 4 chars, got "${s}"`);
  return ((s.charCodeAt(0) << 24) | (s.charCodeAt(1) << 16) | (s.charCodeAt(2) << 8) | s.charCodeAt(3)) >>> 0;
}

export const CTRL_SECTION_DEF = ctrlId("secd");
export const CTRL_COLUMN_DEF = ctrlId("cold");
export const CTRL_TABLE = ctrlId("tbl ");
export const CTRL_EQUATION = ctrlId("eqed");
export const CTRL_GEN_SHAPE = ctrlId("gso ");
export const SHAPE_PICTURE_ID = ctrlId("$pic");
export const SHAPE_RECT_ID = ctrlId("$rec");
export const SHAPE_LINE_ID = ctrlId("$lin");
export const SHAPE_ELLIPSE_ID = ctrlId("$ell");
export const SHAPE_POLYGON_ID = ctrlId("$pol");
export const SHAPE_ARC_ID = ctrlId("$arc");
export const SHAPE_CURVE_ID = ctrlId("$cur");
export const SHAPE_CONNECTOR_ID = ctrlId("$col");
export const CTRL_HEADER = ctrlId("head");
export const CTRL_FOOTER = ctrlId("foot");
export const CTRL_FOOTNOTE = ctrlId("fn  ");
export const CTRL_ENDNOTE = ctrlId("en  ");
export const CTRL_AUTO_NUMBER = ctrlId("atno");
export const CTRL_NEW_NUMBER = ctrlId("nwno");
export const CTRL_PAGE_NUM_POS = ctrlId("pgnp");
export const CTRL_PAGE_HIDE = ctrlId("pghd");
export const CTRL_INDEX_MARK = ctrlId("idxm");
export const CTRL_BOOKMARK = ctrlId("bokm");
export const CTRL_TCPS = ctrlId("tcps");
export const CTRL_FORM = ctrlId("form");
export const CTRL_CHAR_OVERLAP = ctrlId("tdut");
export const CTRL_HIDDEN_COMMENT = ctrlId("tcmt");

// 필드 컨트롤 (% 접두어)
export const FIELD_CLICKHERE = ctrlId("%clk");
export const FIELD_HYPERLINK = ctrlId("%hlk");
export const FIELD_BOOKMARK = ctrlId("%bmk");
export const FIELD_DATE = ctrlId("%dte");
export const FIELD_DOCDATE = ctrlId("%ddt");
export const FIELD_PATH = ctrlId("%pat");
export const FIELD_MAILMERGE = ctrlId("%mmg");
export const FIELD_CROSSREF = ctrlId("%xrf");
export const FIELD_FORMULA = ctrlId("%fmu");
export const FIELD_SUMMARY = ctrlId("%smr");
export const FIELD_USERINFO = ctrlId("%usr");

export function isFieldCtrlId(id: number): boolean {
  return ((id >>> 24) & 0xff) === 0x25; // '%'
}

const TAG_NAMES: Record<number, string> = {
  [HWPTAG_DOCUMENT_PROPERTIES]: "DOCUMENT_PROPERTIES",
  [HWPTAG_ID_MAPPINGS]: "ID_MAPPINGS",
  [HWPTAG_BIN_DATA]: "BIN_DATA",
  [HWPTAG_FACE_NAME]: "FACE_NAME",
  [HWPTAG_BORDER_FILL]: "BORDER_FILL",
  [HWPTAG_CHAR_SHAPE]: "CHAR_SHAPE",
  [HWPTAG_TAB_DEF]: "TAB_DEF",
  [HWPTAG_NUMBERING]: "NUMBERING",
  [HWPTAG_BULLET]: "BULLET",
  [HWPTAG_PARA_SHAPE]: "PARA_SHAPE",
  [HWPTAG_STYLE]: "STYLE",
  [HWPTAG_DOC_DATA]: "DOC_DATA",
  [HWPTAG_DISTRIBUTE_DOC_DATA]: "DISTRIBUTE_DOC_DATA",
  [HWPTAG_COMPATIBLE_DOCUMENT]: "COMPATIBLE_DOCUMENT",
  [HWPTAG_LAYOUT_COMPATIBILITY]: "LAYOUT_COMPATIBILITY",
  [HWPTAG_TRACKCHANGE]: "TRACKCHANGE",
  [HWPTAG_PARA_HEADER]: "PARA_HEADER",
  [HWPTAG_PARA_TEXT]: "PARA_TEXT",
  [HWPTAG_PARA_CHAR_SHAPE]: "PARA_CHAR_SHAPE",
  [HWPTAG_PARA_LINE_SEG]: "PARA_LINE_SEG",
  [HWPTAG_PARA_RANGE_TAG]: "PARA_RANGE_TAG",
  [HWPTAG_CTRL_HEADER]: "CTRL_HEADER",
  [HWPTAG_LIST_HEADER]: "LIST_HEADER",
  [HWPTAG_PAGE_DEF]: "PAGE_DEF",
  [HWPTAG_FOOTNOTE_SHAPE]: "FOOTNOTE_SHAPE",
  [HWPTAG_PAGE_BORDER_FILL]: "PAGE_BORDER_FILL",
  [HWPTAG_SHAPE_COMPONENT]: "SHAPE_COMPONENT",
  [HWPTAG_TABLE]: "TABLE",
  [HWPTAG_SHAPE_COMPONENT_LINE]: "SHAPE_LINE",
  [HWPTAG_SHAPE_COMPONENT_RECTANGLE]: "SHAPE_RECTANGLE",
  [HWPTAG_SHAPE_COMPONENT_ELLIPSE]: "SHAPE_ELLIPSE",
  [HWPTAG_SHAPE_COMPONENT_ARC]: "SHAPE_ARC",
  [HWPTAG_SHAPE_COMPONENT_POLYGON]: "SHAPE_POLYGON",
  [HWPTAG_SHAPE_COMPONENT_CURVE]: "SHAPE_CURVE",
  [HWPTAG_SHAPE_COMPONENT_OLE]: "SHAPE_OLE",
  [HWPTAG_SHAPE_COMPONENT_PICTURE]: "SHAPE_PICTURE",
  [HWPTAG_SHAPE_COMPONENT_CONTAINER]: "SHAPE_CONTAINER",
  [HWPTAG_CTRL_DATA]: "CTRL_DATA",
  [HWPTAG_EQEDIT]: "EQEDIT",
  [HWPTAG_SHAPE_COMPONENT_TEXTART]: "SHAPE_TEXTART",
  [HWPTAG_FORM_OBJECT]: "FORM_OBJECT",
  [HWPTAG_MEMO_SHAPE]: "MEMO_SHAPE",
  [HWPTAG_MEMO_LIST]: "MEMO_LIST",
  [HWPTAG_FORBIDDEN_CHAR]: "FORBIDDEN_CHAR",
  [HWPTAG_CHART_DATA]: "CHART_DATA",
};

export function tagName(tagId: number): string {
  return TAG_NAMES[tagId] ?? "UNKNOWN";
}

const CTRL_NAMES: Record<number, string> = {
  [CTRL_SECTION_DEF]: "SectionDef",
  [CTRL_COLUMN_DEF]: "ColumnDef",
  [CTRL_TABLE]: "Table",
  [CTRL_EQUATION]: "Equation",
  [CTRL_GEN_SHAPE]: "GenShape",
  [CTRL_HEADER]: "Header",
  [CTRL_FOOTER]: "Footer",
  [CTRL_FOOTNOTE]: "Footnote",
  [CTRL_ENDNOTE]: "Endnote",
  [CTRL_AUTO_NUMBER]: "AutoNumber",
  [CTRL_NEW_NUMBER]: "NewNumber",
  [CTRL_PAGE_NUM_POS]: "PageNumPos",
  [CTRL_PAGE_HIDE]: "PageHide",
  [CTRL_INDEX_MARK]: "IndexMark",
  [CTRL_BOOKMARK]: "Bookmark",
  [CTRL_TCPS]: "Tcps",
  [CTRL_FORM]: "Form",
  [CTRL_CHAR_OVERLAP]: "CharOverlap",
  [CTRL_HIDDEN_COMMENT]: "HiddenComment",
};

export function ctrlName(id: number): string {
  return CTRL_NAMES[id] ?? "Unknown";
}

/** ctrl_id를 4글자 문자열로 (디버그 용) */
export function ctrlIdToString(id: number): string {
  return String.fromCharCode((id >>> 24) & 0xff, (id >>> 16) & 0xff, (id >>> 8) & 0xff, id & 0xff);
}
