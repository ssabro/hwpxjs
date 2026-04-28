/**
 * HWP 레코드 헤더 (4바이트):
 *   - bits 0..9   : tag_id  (0..1023)
 *   - bits 10..19 : level   (0..1023)
 *   - bits 20..31 : size    (0..4095)
 *   - size == 0xFFF 이면 다음 4바이트가 실제 size (확장 크기)
 *
 * 원작: rhwp/src/parser/record.rs (MIT, Copyright (c) 2025-2026 Edward Kim)
 */

import { tagName } from "./tags.js";

export interface Record {
  tagId: number;
  level: number;
  size: number;
  data: Uint8Array;
}

export class RecordError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "RecordError";
  }
}

/**
 * 바이트 스트림에서 모든 레코드를 평탄하게 파싱.
 * 트리 재구성은 호출자가 level 필드를 보고 직접 수행.
 */
export function readAllRecords(data: Uint8Array): Record[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const records: Record[] = [];
  let offset = 0;
  const end = data.byteLength;

  while (offset < end) {
    if (end - offset < 4) {
      // 트레일링 패딩으로 간주하고 정상 종료
      break;
    }
    const header = view.getUint32(offset, true);
    offset += 4;

    const tagId = header & 0x3ff;
    const level = (header >>> 10) & 0x3ff;
    let size = header >>> 20;

    if (size === 0xfff) {
      if (end - offset < 4) {
        throw new RecordError(`extended size 헤더 중간 EOF (tag=${tagId})`);
      }
      size = view.getUint32(offset, true);
      offset += 4;
    }

    if (offset + size > end) {
      throw new RecordError(
        `레코드 데이터 부족: tag=${tagId}/${tagName(tagId)}, 필요=${size}, 가용=${end - offset}`
      );
    }

    const recordData = new Uint8Array(data.buffer, data.byteOffset + offset, size);
    offset += size;

    records.push({
      tagId,
      level,
      size,
      data: new Uint8Array(recordData), // 복사
    });
  }

  return records;
}

export function recordTagName(rec: Record): string {
  return tagName(rec.tagId);
}
