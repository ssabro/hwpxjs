/**
 * BodyText 섹션 파싱 — 계층 파싱.
 *
 * 레코드 트리:
 *   PARA_HEADER (level=0)
 *     PARA_TEXT       (level=1)
 *     PARA_CHAR_SHAPE (level=1)
 *     PARA_LINE_SEG   (level=1)
 *     CTRL_HEADER     (level=1)  ← 표/그림/머리말 등
 *       TABLE         (level=2)
 *       LIST_HEADER   (level=2)  ← 셀
 *         PARA_HEADER (level=3)
 *           PARA_TEXT (level=4)
 *
 * 외곽 파라그래프와 셀 안 파라그래프는 분리되어 보존된다.
 *
 * 원작: rhwp/src/parser/body_text.rs (MIT, Edward Kim)
 */

import { ByteReader } from "./byteReader.js";
import { readAllRecords, type Record } from "./record.js";
import {
  HWPTAG_PARA_HEADER,
  HWPTAG_PARA_TEXT,
  HWPTAG_PARA_CHAR_SHAPE,
  HWPTAG_CTRL_HEADER,
} from "./tags.js";
import { parseCtrlHeader } from "./control.js";
import type { HwpControl, HwpParagraph, HwpRun, HwpSection } from "./types.js";

export class BodyTextError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "BodyTextError";
  }
}

export function parseBodyTextSection(data: Uint8Array): HwpSection {
  const records = readAllRecords(data);
  // 섹션의 최상위 PARA_HEADER 들 (보통 level=0)
  const topLevel = records.length > 0 ? records[0].level : 0;
  return { paragraphs: parseParagraphList(records, topLevel) };
}

/**
 * 주어진 레코드 시퀀스에서 baseLevel 인 PARA_HEADER 들을 찾아 문단 목록으로 변환.
 *
 * @param records 정렬된 레코드 시퀀스 (서브트리 또는 전체)
 * @param baseLevel 추출 대상 PARA_HEADER 의 레벨 (보통 외부 컨테이너 레벨 + 1, 섹션 최상위면 0)
 */
export function parseParagraphList(records: Record[], baseLevel: number): HwpParagraph[] {
  const paragraphs: HwpParagraph[] = [];

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    if (rec.tagId !== HWPTAG_PARA_HEADER) continue;
    if (rec.level !== baseLevel) continue;

    // 자기 서브트리 종료점: level <= baseLevel 이 다시 등장하는 위치
    let end = i + 1;
    while (end < records.length && records[end].level > baseLevel) end++;

    const paraRecords = records.slice(i, end);
    paragraphs.push(buildParagraph(paraRecords));
    i = end - 1;
  }

  return paragraphs;
}

function buildParagraph(records: Record[]): HwpParagraph {
  const header = records[0];
  const headerInfo = parseParaHeader(header.data);
  const baseLevel = header.level;

  let text = "";
  let charShapeChanges: { charPos: number; charShapeId: number }[] = [];
  const controls: HwpControl[] = [];

  for (let j = 1; j < records.length; j++) {
    const r = records[j];
    if (r.level !== baseLevel + 1) continue; // 직접 자식만

    switch (r.tagId) {
      case HWPTAG_PARA_TEXT: {
        text = parseParaText(r.data);
        break;
      }
      case HWPTAG_PARA_CHAR_SHAPE: {
        charShapeChanges = parseParaCharShape(r.data);
        break;
      }
      case HWPTAG_CTRL_HEADER: {
        // CTRL_HEADER 의 자식 (level > baseLevel+1) 수집
        const ctrlChildren: Record[] = [];
        for (let k = j + 1; k < records.length; k++) {
          if (records[k].level <= baseLevel + 1) break;
          ctrlChildren.push(records[k]);
        }
        const ctrl = parseCtrlHeader(r, ctrlChildren, parseParagraphList);
        controls.push(ctrl);
        break;
      }
      default:
        break;
    }
  }

  return {
    paraShapeId: headerInfo.paraShapeId,
    styleId: headerInfo.styleId,
    text,
    runs: buildRuns(text, charShapeChanges),
    controls,
  };
}

interface ParaHeaderInfo {
  charCount: number;
  controlMask: number;
  paraShapeId: number;
  styleId: number;
}

function parseParaHeader(data: Uint8Array): ParaHeaderInfo {
  const r = new ByteReader(data);
  const nCharsRaw = r.remaining() >= 4 ? r.readU32() : 0;
  const charCount = nCharsRaw & 0x7fffffff;
  const controlMask = r.remaining() >= 4 ? r.readU32() : 0;
  const paraShapeId = r.remaining() >= 2 ? r.readU16() : 0;
  const styleId = r.remaining() >= 1 ? r.readU8() : 0;
  return { charCount, controlMask, paraShapeId, styleId };
}

/**
 * PARA_TEXT 디코딩 (텍스트만; 컨트롤 위치는 buildParagraph 의 CTRL_HEADER 처리에서 별도 추적).
 *
 * 컨트롤 문자 분류 (HWP 5.0 표 6):
 *   - 1 word (2바이트): 0, 10 (LF), 13 (para break — 종료), 24~31
 *   - 8 word (16바이트): 1~8, 11~12, 14~23
 *   - 9 (탭): 8 word
 */
function parseParaText(data: Uint8Array): string {
  let text = "";
  let pos = 0;
  const end = data.byteLength;

  while (pos + 1 < end) {
    const ch = data[pos] | (data[pos + 1] << 8);

    if (ch === 0) {
      pos += 2;
    } else if (ch === 0x09) {
      text += "\t";
      pos += 16;
    } else if (ch === 0x0a) {
      text += "\n";
      pos += 2;
    } else if (ch === 0x0d) {
      break;
    } else if (isExtendedCtrl(ch)) {
      pos += 16;
    } else if (ch < 0x20) {
      switch (ch) {
        case 0x18:
          text += " ";
          break;
        case 0x19:
          text += " ";
          break;
        case 0x1e:
          text += "-";
          break;
        case 0x1f:
          text += " ";
          break;
        default:
          break;
      }
      pos += 2;
    } else {
      if (ch >= 0xd800 && ch <= 0xdbff && pos + 3 < end) {
        const low = data[pos + 2] | (data[pos + 3] << 8);
        if (low >= 0xdc00 && low <= 0xdfff) {
          text += String.fromCharCode(ch, low);
          pos += 4;
          continue;
        }
      }
      text += String.fromCharCode(ch);
      pos += 2;
    }
  }
  return text;
}

function isExtendedCtrl(ch: number): boolean {
  return (
    (ch >= 1 && ch <= 8) ||
    ch === 11 ||
    ch === 12 ||
    (ch >= 14 && ch <= 23)
  );
}

function parseParaCharShape(data: Uint8Array): { charPos: number; charShapeId: number }[] {
  const r = new ByteReader(data);
  const out: { charPos: number; charShapeId: number }[] = [];
  while (r.remaining() >= 8) {
    const charPos = r.readU32();
    const charShapeId = r.readU32();
    out.push({ charPos, charShapeId });
  }
  return out;
}

function buildRuns(
  text: string,
  changes: { charPos: number; charShapeId: number }[]
): HwpRun[] {
  if (text.length === 0) return [];
  if (changes.length === 0) return [{ charShapeId: 0, text }];

  const sorted = [...changes].sort((a, b) => a.charPos - b.charPos);
  const runs: HwpRun[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i].charPos;
    const stop = i + 1 < sorted.length ? sorted[i + 1].charPos : text.length;
    if (stop > start) {
      runs.push({ charShapeId: sorted[i].charShapeId, text: text.slice(start, stop) });
    }
  }
  return runs;
}
