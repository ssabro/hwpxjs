/**
 * DocInfo 스트림 파싱 — 1차 포팅.
 *
 * 1차 범위: BIN_DATA, FACE_NAME, CHAR_SHAPE, PARA_SHAPE, STYLE.
 * BORDER_FILL/NUMBERING/BULLET/TAB_DEF 등은 2차 단계.
 *
 * 원작: rhwp/src/parser/doc_info.rs (MIT, Edward Kim)
 */

import { ByteReader } from "./byteReader.js";
import { readAllRecords } from "./record.js";
import {
  HWPTAG_DOCUMENT_PROPERTIES,
  HWPTAG_ID_MAPPINGS,
  HWPTAG_BIN_DATA,
  HWPTAG_FACE_NAME,
  HWPTAG_BORDER_FILL,
  HWPTAG_CHAR_SHAPE,
  HWPTAG_TAB_DEF,
  HWPTAG_NUMBERING,
  HWPTAG_BULLET,
  HWPTAG_PARA_SHAPE,
  HWPTAG_STYLE,
} from "./tags.js";
import type {
  HwpBinDataRef,
  HwpBorderFill,
  HwpBorderLine,
  HwpBullet,
  HwpCharShape,
  HwpDiagonalLine,
  HwpDocInfo,
  HwpFaceName,
  HwpNumbering,
  HwpParaShape,
  HwpSolidFill,
  HwpStyle,
  HwpTabDef,
} from "./types.js";

export class DocInfoError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "DocInfoError";
  }
}

export interface DocProperties {
  sectionCount: number;
  pageStartNum: number;
  footnoteStartNum: number;
  endnoteStartNum: number;
  pictureStartNum: number;
  tableStartNum: number;
  equationStartNum: number;
}

export interface DocInfoParseResult {
  docInfo: HwpDocInfo;
  docProperties: DocProperties;
}

interface IdMappings {
  binDataCount: number;
  fontCounts: number[]; // length 7
  borderFillCount: number;
  charShapeCount: number;
  tabDefCount: number;
  numberingCount: number;
  bulletCount: number;
  paraShapeCount: number;
  styleCount: number;
}

const DEFAULT_DOC_PROPS: DocProperties = {
  sectionCount: 1,
  pageStartNum: 1,
  footnoteStartNum: 1,
  endnoteStartNum: 1,
  pictureStartNum: 1,
  tableStartNum: 1,
  equationStartNum: 1,
};

export function parseDocInfo(data: Uint8Array): DocInfoParseResult {
  const records = readAllRecords(data);

  const binData: HwpBinDataRef[] = [];
  const fontFaces: HwpFaceName[][] = Array.from({ length: 7 }, () => []);
  const charShapes: HwpCharShape[] = [];
  const paraShapes: HwpParaShape[] = [];
  const styles: HwpStyle[] = [];
  const borderFills: HwpBorderFill[] = [];
  const numberings: HwpNumbering[] = [];
  const bullets: HwpBullet[] = [];
  const tabDefs: HwpTabDef[] = [];
  let docProps = { ...DEFAULT_DOC_PROPS };
  let idMappings: IdMappings | null = null;
  let currentLang = 0;
  const langConsumed = [0, 0, 0, 0, 0, 0, 0];

  for (const rec of records) {
    switch (rec.tagId) {
      case HWPTAG_DOCUMENT_PROPERTIES:
        docProps = parseDocumentProperties(rec.data);
        break;
      case HWPTAG_ID_MAPPINGS:
        idMappings = parseIdMappings(rec.data);
        break;
      case HWPTAG_BIN_DATA:
        binData.push(parseBinData(rec.data));
        break;
      case HWPTAG_FACE_NAME: {
        const font = parseFaceName(rec.data);
        if (idMappings) {
          while (
            currentLang < 7 &&
            langConsumed[currentLang] >= idMappings.fontCounts[currentLang]
          ) {
            currentLang++;
          }
          if (currentLang < 7) {
            fontFaces[currentLang].push(font);
            langConsumed[currentLang]++;
          } else {
            fontFaces[6].push(font);
          }
        } else {
          fontFaces[0].push(font);
        }
        break;
      }
      case HWPTAG_BORDER_FILL:
        borderFills.push(parseBorderFill(rec.data));
        break;
      case HWPTAG_CHAR_SHAPE:
        charShapes.push(parseCharShape(rec.data));
        break;
      case HWPTAG_TAB_DEF:
        tabDefs.push(parseTabDef(rec.data));
        break;
      case HWPTAG_NUMBERING:
        numberings.push(parseNumbering(rec.data));
        break;
      case HWPTAG_BULLET:
        bullets.push(parseBullet(rec.data));
        break;
      case HWPTAG_PARA_SHAPE:
        paraShapes.push(parseParaShape(rec.data));
        break;
      case HWPTAG_STYLE:
        styles.push(parseStyle(rec.data));
        break;
      default:
        break;
    }
  }

  return {
    docInfo: {
      fontFaces,
      charShapes,
      paraShapes,
      styles,
      binData,
      borderFills,
      numberings,
      bullets,
      tabDefs,
    },
    docProperties: docProps,
  };
}

function parseBorderFill(data: Uint8Array): HwpBorderFill {
  const r = new ByteReader(data);
  const attr = r.remaining() >= 2 ? r.readU16() : 0;

  // 4면 테두리: 좌/우/상/하 인터리브 — { type u8, width u8, color u32 }
  const readBorder = () => {
    if (r.remaining() < 6) {
      return { lineType: 1, widthIndex: 0, color: 0 };
    }
    const lineType = r.readU8();
    const widthIndex = r.readU8();
    const color = r.readColorRef();
    return { lineType, widthIndex, color };
  };
  const borders: [HwpBorderLine, HwpBorderLine, HwpBorderLine, HwpBorderLine] = [
    readBorder(),
    readBorder(),
    readBorder(),
    readBorder(),
  ];

  // 대각선
  let diagonal: HwpDiagonalLine = { diagonalType: 0, widthIndex: 0, color: 0 };
  if (r.remaining() >= 6) {
    diagonal = {
      diagonalType: r.readU8(),
      widthIndex: r.readU8(),
      color: r.readColorRef(),
    };
  }

  // 채우기: u32 fillType 비트마스크 + 종류별 데이터
  let fill: HwpSolidFill | undefined;
  if (r.remaining() >= 4) {
    const fillType = r.readU32();
    if (fillType === 0) {
      // 채우기 없음: hwplib 기준 4바이트 추가 skip
      if (r.remaining() >= 4) r.skip(4);
    } else if ((fillType & 0x01) !== 0) {
      // solid
      if (r.remaining() >= 12) {
        fill = {
          backgroundColor: r.readColorRef(),
          patternColor: r.readColorRef(),
          patternType: r.readI32(),
        };
      }
      // gradient/image 는 1차 포팅에서 무시 (이후 바이트 무시)
    }
  }

  return { attr, borders, diagonal, fill };
}

function parseTabDef(data: Uint8Array): HwpTabDef {
  const r = new ByteReader(data);
  const attr = r.remaining() >= 4 ? r.readU32() : 0;
  return {
    attr,
    autoTabLeft: (attr & 0x01) !== 0,
    autoTabRight: (attr & 0x02) !== 0,
  };
}

function parseNumbering(data: Uint8Array): HwpNumbering {
  const r = new ByteReader(data);
  const levelFormats: string[] = ["", "", "", "", "", "", ""];

  // 7 레벨 × { attr(u32) + widthAdjust(i16) + textDistance(i16) + charShapeId(u32) + formatLen(u16) + WCHAR[formatLen] }
  for (let level = 0; level < 7; level++) {
    if (r.remaining() < 12) break;
    r.readU32(); // attr
    r.readI16(); // widthAdjust
    r.readI16(); // textDistance
    r.readU32(); // charShapeId

    if (r.remaining() < 2) break;
    const formatLen = r.readU16();
    if (formatLen > 0 && r.remaining() >= formatLen * 2) {
      try {
        levelFormats[level] = r.readUtf16(formatLen);
      } catch {
        // skip
      }
    }
  }

  const startNumber = r.remaining() >= 2 ? r.readU16() : 1;
  return { startNumber, levelFormats };
}

function parseBullet(data: Uint8Array): HwpBullet {
  const r = new ByteReader(data);
  // attr(u32) + widthAdjust(i16) + textDistance(i16) + charShapeId(u32)
  if (r.remaining() < 12) return { bulletChar: "●" };
  r.readU32();
  r.readI16();
  r.readI16();
  r.readU32();
  if (r.remaining() < 2) return { bulletChar: "●" };
  const bulletCharCode = r.readU16();
  const bulletChar = bulletCharCode > 0 ? String.fromCharCode(bulletCharCode) : "●";
  return { bulletChar };
}

function parseIdMappings(data: Uint8Array): IdMappings {
  const r = new ByteReader(data);
  const safe = (n: number) => (r.remaining() >= 4 ? r.readU32() : n);
  return {
    binDataCount: safe(0),
    fontCounts: [safe(0), safe(0), safe(0), safe(0), safe(0), safe(0), safe(0)],
    borderFillCount: safe(0),
    charShapeCount: safe(0),
    tabDefCount: safe(0),
    numberingCount: safe(0),
    bulletCount: safe(0),
    paraShapeCount: safe(0),
    styleCount: safe(0),
  };
}

function parseDocumentProperties(data: Uint8Array): DocProperties {
  const r = new ByteReader(data);
  const safe = (n: number) => (r.remaining() >= 2 ? r.readU16() : n);
  return {
    sectionCount: safe(1),
    pageStartNum: safe(1),
    footnoteStartNum: safe(1),
    endnoteStartNum: safe(1),
    pictureStartNum: safe(1),
    tableStartNum: safe(1),
    equationStartNum: safe(1),
  };
}

function parseBinData(data: Uint8Array): HwpBinDataRef {
  const r = new ByteReader(data);
  const attr = r.readU16();
  const typeBits = attr & 0x000f;
  let type: HwpBinDataRef["type"];
  switch (typeBits) {
    case 0:
      type = "link";
      break;
    case 1:
      type = "embedding";
      break;
    case 2:
      type = "storage";
      break;
    default:
      type = "link";
      break;
  }

  if (type === "link") {
    // absPath, relPath — 1차 포팅에서는 무시
    safeReadHwpString(r);
    safeReadHwpString(r);
    return { storageId: 0, type };
  }
  const storageId = r.remaining() >= 2 ? r.readU16() : 0;
  const extension = safeReadHwpString(r);
  return { storageId, extension, type };
}

function parseFaceName(data: Uint8Array): HwpFaceName {
  const r = new ByteReader(data);
  const attr = r.readU8();
  const name = safeReadHwpString(r) ?? "";
  let substituteName: string | undefined;
  if ((attr & 0x80) !== 0) {
    substituteName = safeReadHwpString(r);
  }
  return { name, substituteName };
}

function parseCharShape(data: Uint8Array): HwpCharShape {
  const r = new ByteReader(data);

  const fontIds: number[] = [];
  for (let i = 0; i < 7; i++) fontIds.push(r.readU16());
  // ratios u8x7
  for (let i = 0; i < 7; i++) r.readU8();
  // spacings i8x7
  for (let i = 0; i < 7; i++) r.readI8();
  // relativeSizes u8x7
  for (let i = 0; i < 7; i++) r.readU8();
  // charOffsets i8x7
  for (let i = 0; i < 7; i++) r.readI8();

  const baseSize = r.readI32();
  const attr = r.readU32();

  // shadow_offset_x, shadow_offset_y (i8 x 2)
  r.readI8();
  r.readI8();

  const textColor = r.readColorRef();
  const underlineColor = r.readColorRef();
  const shadeColor = r.readColorRef();
  const shadowColor = r.readColorRef();

  return {
    faceNameIds: {
      hangul: fontIds[0],
      latin: fontIds[1],
      hanja: fontIds[2],
      japanese: fontIds[3],
      other: fontIds[4],
      symbol: fontIds[5],
      user: fontIds[6],
    },
    baseSize,
    property: attr,
    textColor,
    shadeColor,
    underlineColor,
    shadowColor,
    bold: (attr & 0x02) !== 0,
    italic: (attr & 0x01) !== 0,
    underline: ((attr >>> 2) & 0x03) !== 0,
    strikeout: ((attr >>> 18) & 0x07) > 1,
  };
}

function parseParaShape(data: Uint8Array): HwpParaShape {
  const r = new ByteReader(data);
  const attr1 = r.readU32();
  const leftMargin = r.readI32();
  const rightMargin = r.readI32();
  const indent = r.readI32();
  const prevSpacing = r.readI32();
  const nextSpacing = r.readI32();
  const lineSpacing = r.readI32();

  const alignBits = (attr1 >>> 2) & 0x07;
  let alignment: HwpParaShape["alignment"];
  switch (alignBits) {
    case 0:
      alignment = "justify";
      break;
    case 1:
      alignment = "left";
      break;
    case 2:
      alignment = "right";
      break;
    case 3:
      alignment = "center";
      break;
    case 4:
      alignment = "distribute";
      break;
    case 5:
      alignment = "distributeSpace";
      break;
    default:
      alignment = "unknown";
  }

  return {
    alignment,
    property: attr1,
    leftMargin,
    rightMargin,
    indent,
    prevSpacing,
    nextSpacing,
    lineSpacing,
  };
}

function parseStyle(data: Uint8Array): HwpStyle {
  const r = new ByteReader(data);
  const name = safeReadHwpString(r) ?? "";
  const engName = safeReadHwpString(r);
  // properties u8, next u8, lang u8 — 일단 skip
  if (r.remaining() >= 3) {
    r.readU8();
    r.readU8();
    r.readU8();
  }
  const paraShapeId = r.remaining() >= 2 ? r.readU16() : 0;
  const charShapeId = r.remaining() >= 2 ? r.readU16() : 0;
  return { name, engName, paraShapeId, charShapeId };
}

function safeReadHwpString(r: ByteReader): string | undefined {
  if (r.remaining() < 2) return undefined;
  try {
    return r.readHwpString();
  } catch {
    return undefined;
  }
}
