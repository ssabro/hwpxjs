/**
 * HWP 5.0 CFB(OLE2) 컨테이너 리더.
 * SheetJS 'cfb' 패키지를 감싸 HWP 친화적 API 제공.
 *
 * HWP CFB 구조:
 *   /FileHeader              (256B, 비압축)
 *   /DocInfo                 (압축 가능 — 비밀 stream에서 raw deflate)
 *   /BodyText/Section{N}     (압축 가능)
 *   /ViewText/Section{N}     (배포용 문서; 암호화)
 *   /BinData/BIN{XXXX}.{ext} (이미지/임베디드)
 *   /PrvImage, /PrvText      (미리보기)
 *   /Scripts/..., /DocOptions/...
 *
 * 원작 참고: rhwp/src/parser/cfb_reader.rs (MIT, Edward Kim)
 */

import * as CFB from "cfb";
import { inflateRaw } from "pako";

export class CfbError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "CfbError";
  }
}

export class HwpCfbReader {
  private container: CFB.CFB$Container;

  constructor(data: Uint8Array) {
    try {
      this.container = CFB.read(data, { type: "buffer" });
    } catch (e) {
      throw new CfbError(`CFB 파싱 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** path 정확히 일치하는 stream 의 raw bytes (압축/암호화 그대로) */
  readStreamRaw(path: string): Uint8Array | null {
    const norm = path.startsWith("/") ? path : `/${path}`;
    const entry = CFB.find(this.container, norm);
    if (!entry || entry.type !== 2 /* stream */) return null;
    return toUint8Array(entry.content);
  }

  /** 디플레이트 압축 해제. raw deflate (zlib 헤더 없음). */
  static decompress(data: Uint8Array): Uint8Array {
    if (data.byteLength === 0) return data;
    try {
      return inflateRaw(data);
    } catch (e) {
      throw new CfbError(`deflate 해제 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** FileHeader (256바이트, 비압축) */
  readFileHeader(): Uint8Array {
    const data = this.readStreamRaw("/FileHeader");
    if (!data) throw new CfbError("/FileHeader 스트림이 없습니다");
    return data;
  }

  /** DocInfo (compressed 플래그에 따라 자동 해제) */
  readDocInfo(compressed: boolean): Uint8Array {
    const raw = this.readStreamRaw("/DocInfo");
    if (!raw) throw new CfbError("/DocInfo 스트림이 없습니다");
    return compressed ? HwpCfbReader.decompress(raw) : raw;
  }

  /** /BodyText/SectionN 또는 /ViewText/SectionN (배포용) */
  readBodySection(index: number, compressed: boolean, distribution: boolean): Uint8Array | null {
    const folder = distribution ? "ViewText" : "BodyText";
    const raw = this.readStreamRaw(`/${folder}/Section${index}`);
    if (!raw) return null;
    if (distribution) {
      // ViewText 는 암호화되어 있어 v1 미지원: 호출자가 raw 처리
      return raw;
    }
    return compressed ? HwpCfbReader.decompress(raw) : raw;
  }

  /** BodyText 섹션 개수 (Section0 ~ SectionN-1) */
  sectionCount(distribution = false): number {
    const folder = distribution ? "ViewText" : "BodyText";
    const re = new RegExp(`(?:^|/)${folder}/Section\\d+$`);
    let n = 0;
    for (const path of this.container.FullPaths) {
      if (re.test(path)) n++;
    }
    return n;
  }

  /** /BinData/BIN{XXXX}.{ext} 모두 나열 */
  listBinData(): { name: string; storageId: number; extension: string }[] {
    const result: { name: string; storageId: number; extension: string }[] = [];
    const re = /(?:^|\/)BinData\/BIN([0-9A-Fa-f]{4})\.([^/]+)$/;
    for (const path of this.container.FullPaths) {
      const m = re.exec(path);
      if (!m) continue;
      result.push({
        name: path,
        storageId: parseInt(m[1], 16),
        extension: m[2].toLowerCase(),
      });
    }
    return result;
  }

  /** /BinData/BIN{XXXX}.{ext} 의 데이터 (압축되어 있으면 해제 시도) */
  readBinData(path: string): Uint8Array | null {
    const raw = this.readStreamRaw(path);
    if (!raw) return null;
    // BinData 도 일반적으로 압축됨
    try {
      return HwpCfbReader.decompress(raw);
    } catch {
      return raw;
    }
  }

  /** 디버그 — 모든 stream 경로 */
  listStreams(): string[] {
    const out: string[] = [];
    for (let i = 0; i < this.container.FileIndex.length; i++) {
      if (this.container.FileIndex[i].type === 2) out.push(this.container.FullPaths[i]);
    }
    return out;
  }
}

function toUint8Array(content: CFB.CFB$Blob): Uint8Array {
  if (content instanceof Uint8Array) return content;
  // number[]
  return Uint8Array.from(content);
}
