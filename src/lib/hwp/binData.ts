/**
 * BinData (CFB Storage) 에서 임베디드 이미지/OLE 데이터 추출.
 *
 * /BinData/BIN0001.png, BIN0002.jpg, ... 패턴.
 * DocInfo의 BIN_DATA 레코드와 storageId 로 연결됨.
 *
 * 원작: rhwp/src/parser/bin_data.rs (MIT, Edward Kim)
 */

import type { HwpCfbReader } from "./cfbReader.js";
import type { HwpBinDataRef } from "./types.js";

const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

export function loadBinDataContent(
  cfb: HwpCfbReader,
  refs: HwpBinDataRef[]
): Map<number, { data: Uint8Array; extension: string }> {
  const out = new Map<number, { data: Uint8Array; extension: string }>();

  for (const ref of refs) {
    if (ref.type === "link") continue;
    const isStorage = ref.type === "storage";
    const ext = ref.extension ?? (isStorage ? "OLE" : "dat");

    // 파일명: BIN{XXXX}.{ext} (4자리 hex, 대문자/소문자 둘 다 시도)
    const idHex = ref.storageId.toString(16).padStart(4, "0");
    const candidates = [
      `/BinData/BIN${idHex.toUpperCase()}.${ext}`,
      `/BinData/BIN${idHex.toLowerCase()}.${ext}`,
    ];

    let bytes: Uint8Array | null = null;
    for (const path of candidates) {
      bytes = cfb.readBinData(path);
      if (bytes) break;
    }
    if (!bytes) continue;

    // OLE Storage 의 경우 선두 4바이트 size prefix 가 붙는 경우가 있어 정리
    if (isStorage && bytes.byteLength > 12) {
      const headIsCfb =
        bytes[0] === CFB_MAGIC[0] &&
        bytes[1] === CFB_MAGIC[1] &&
        bytes[2] === CFB_MAGIC[2] &&
        bytes[3] === CFB_MAGIC[3];
      const cfbAt4 =
        bytes[4] === CFB_MAGIC[0] &&
        bytes[5] === CFB_MAGIC[1] &&
        bytes[6] === CFB_MAGIC[2] &&
        bytes[7] === CFB_MAGIC[3];
      if (!headIsCfb && cfbAt4) {
        bytes = bytes.subarray(4);
      }
    }

    out.set(ref.storageId, { data: new Uint8Array(bytes), extension: ext });
  }

  return out;
}

export function detectImageMime(extension: string): string {
  const ext = extension.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "bmp") return "image/bmp";
  if (ext === "webp") return "image/webp";
  if (ext === "svg") return "image/svg+xml";
  return "application/octet-stream";
}
