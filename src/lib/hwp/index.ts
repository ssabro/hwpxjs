/**
 * HWP 5.0 바이너리 파서 진입점.
 *
 * 공개 API:
 *   - detectFormat(bytes): "hwp" | "hwpx" | "hwp3" | "unknown"
 *   - parseHwp(bytes): HwpDocument
 *   - hwpToText(bytes, options?): Promise<string>
 *   - hwpToHwpx(bytes, options?): Promise<Uint8Array>
 *   - parseFileHeader, versionToString, isVersionSupported
 *   - 에러: HwpEncryptedError, HwpUnsupportedError, HwpInvalidFormatError
 *   - 타입: HwpDocument, HwpSection
 *
 * 보존되는 것 (HWP → HWPX 라운드트립):
 *   - 표 (rowSpan/colSpan 포함), 임베디드 이미지 (BinData 패키징)
 *   - 7개 언어 그룹별 폰트, 글자 모양(굵게/기울임/밑줄/색/크기)
 *   - 문단 모양(정렬/들여쓰기/줄간격), 스타일, 번호 매기기 형식 문자열, 글머리표 문자
 *   - 도형(line) 좌표, 수식(EQEDIT) 스크립트
 *   - Preview/PrvText.txt 자동 생성
 *
 * 미지원 / 한계:
 *   - 암호화된 HWP / 배포용 ViewText / HWP 3.0: 명시적 에러
 *   - 머리말/꼬리말/각주: 파싱되나 본문 흐름 외부에 출력하지 않음
 *   - BorderFill 정의: ID 슬롯만 채움 (색/굵기/대각선 미보존)
 *   - 차트(CHART_DATA) / OLE / 글맵시: 미지원
 *   - 도형(line) 외 사각형/타원/호/다각형/곡선: 종류만 보존
 */

import { parseFileHeader, isVersionSupported, versionToString } from "./fileHeader.js";
import { HwpCfbReader } from "./cfbReader.js";
import { parseDocInfo } from "./docInfo.js";
import { parseBodyTextSection } from "./bodyText.js";
import { loadBinDataContent } from "./binData.js";
import {
  hwpDocumentToText,
  hwpDocumentToHwpx,
  hwpDocumentToMarkdown,
  markdownToHwpDocument,
  htmlToHwpDocument,
  type MarkdownWriteOptions,
} from "./converter.js";
import type { HwpDocument, HwpSection } from "./types.js";

export type { HwpDocument, HwpSection } from "./types.js";
export type { MarkdownWriteOptions } from "./converter.js";
export {
  hwpDocumentToMarkdown,
  markdownToHwpDocument,
  htmlToHwpDocument,
} from "./converter.js";
export { parseFileHeader, versionToString, isVersionSupported } from "./fileHeader.js";

export class HwpUnsupportedError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "HwpUnsupportedError";
  }
}

export class HwpEncryptedError extends Error {
  constructor() {
    super("암호화된 HWP 문서는 현재 지원하지 않습니다.");
    this.name = "HwpEncryptedError";
  }
}

export class HwpInvalidFormatError extends Error {
  constructor(msg = "유효한 HWP 5.0 파일이 아닙니다.") {
    super(msg);
    this.name = "HwpInvalidFormatError";
  }
}

export type DetectedFormat = "hwp" | "hwpx" | "hwp3" | "unknown";

export function detectFormat(data: Uint8Array): DetectedFormat {
  if (data.byteLength >= 8) {
    // CFB/OLE 시그니처
    if (
      data[0] === 0xd0 &&
      data[1] === 0xcf &&
      data[2] === 0x11 &&
      data[3] === 0xe0 &&
      data[4] === 0xa1 &&
      data[5] === 0xb1 &&
      data[6] === 0x1a &&
      data[7] === 0xe1
    ) {
      return "hwp";
    }
    // ZIP 시그니처
    if (data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04) {
      return "hwpx";
    }
  }
  // HWP 3.0
  if (data.byteLength >= 17) {
    const sig = String.fromCharCode(...data.subarray(0, 17));
    if (sig === "HWP Document File") return "hwp3";
  }
  return "unknown";
}

/**
 * HWP 5.0 바이너리를 파싱하여 HwpDocument IR 반환.
 */
export function parseHwp(data: Uint8Array): HwpDocument {
  const fmt = detectFormat(data);
  if (fmt === "hwp3") {
    throw new HwpUnsupportedError(
      "HWP 3.0 포맷은 지원하지 않습니다. 한컴오피스/LibreOffice 에서 HWP 5.0 으로 다시 저장해 주세요."
    );
  }
  if (fmt !== "hwp") {
    throw new HwpInvalidFormatError(`HWP 5.0(CFB) 시그니처가 아닙니다 (감지: ${fmt}).`);
  }

  const cfb = new HwpCfbReader(data);

  const headerBytes = cfb.readFileHeader();
  const fileHeader = parseFileHeader(headerBytes);

  if (fileHeader.flags.encrypted) {
    throw new HwpEncryptedError();
  }
  if (!isVersionSupported(fileHeader.version)) {
    throw new HwpUnsupportedError(
      `지원하지 않는 HWP 버전: ${versionToString(fileHeader.version)} (5.0 ~ 5.1 지원)`
    );
  }
  if (fileHeader.flags.distribution) {
    // ViewText 복호화는 1차 포팅 범위 밖
    throw new HwpUnsupportedError(
      "배포용 문서(ViewText)는 현재 지원하지 않습니다. 일반 HWP 로 저장 후 시도해 주세요."
    );
  }

  const compressed = fileHeader.flags.compressed;

  const docInfoBytes = cfb.readDocInfo(compressed);
  const { docInfo } = parseDocInfo(docInfoBytes);

  const sectionCount = cfb.sectionCount(false);
  const sections: HwpSection[] = [];
  for (let i = 0; i < sectionCount; i++) {
    const secBytes = cfb.readBodySection(i, compressed, false);
    if (!secBytes) continue;
    try {
      sections.push(parseBodyTextSection(secBytes));
    } catch {
      // 개별 섹션 실패 시 빈 섹션으로 대체 (전체 실패 방지)
      sections.push({ paragraphs: [] });
    }
  }

  const binData = loadBinDataContent(cfb, docInfo.binData);

  return {
    header: fileHeader,
    docInfo,
    sections,
    binData,
  };
}

export async function hwpToText(
  data: Uint8Array,
  options?: { paragraphSeparator?: string; sectionSeparator?: string }
): Promise<string> {
  const doc = parseHwp(data);
  return hwpDocumentToText(doc, options);
}

export async function hwpToHwpx(
  data: Uint8Array,
  options?: { title?: string; creator?: string }
): Promise<Uint8Array> {
  const doc = parseHwp(data);
  return await hwpDocumentToHwpx(doc, options);
}

export async function hwpToMarkdown(
  data: Uint8Array,
  options?: MarkdownWriteOptions
): Promise<string> {
  const doc = parseHwp(data);
  return hwpDocumentToMarkdown(doc, options);
}

/** Markdown 텍스트를 HWPX 패키지로 변환. */
export async function markdownToHwpx(
  md: string,
  options?: { title?: string; creator?: string }
): Promise<Uint8Array> {
  const doc = markdownToHwpDocument(md);
  return await hwpDocumentToHwpx(doc, options);
}

/** HTML 문서를 HWPX 패키지로 변환. */
export async function htmlToHwpx(
  html: string,
  options?: { title?: string; creator?: string }
): Promise<Uint8Array> {
  const doc = htmlToHwpDocument(html);
  return await hwpDocumentToHwpx(doc, options);
}
