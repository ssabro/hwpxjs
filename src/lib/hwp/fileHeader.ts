/**
 * HWP FileHeader 스트림 (256바이트, 비압축).
 *   0..31  : 시그니처 "HWP Document File" + NULL 패딩
 *   32..35 : 버전 (revision, build, minor, major) — LE
 *   36..39 : 속성 플래그 (u32 LE)
 *   40..   : 예약
 *
 * 원작: rhwp/src/parser/header.rs (MIT, Copyright (c) 2025-2026 Edward Kim)
 */

export const HWP_SIGNATURE = "HWP Document File";
export const FILE_HEADER_SIZE = 256;

export interface HwpVersion {
  major: number;
  minor: number;
  build: number;
  revision: number;
}

export function versionToString(v: HwpVersion): string {
  return `${v.major}.${v.minor}.${v.build}.${v.revision}`;
}

export function isVersionSupported(v: HwpVersion): boolean {
  return v.major === 5 && (v.minor === 0 || v.minor === 1);
}

export interface FileHeaderFlags {
  raw: number;
  compressed: boolean;
  encrypted: boolean;
  distribution: boolean;
  script: boolean;
  drm: boolean;
  xmlTemplate: boolean;
  documentHistory: boolean;
  digitalSignature: boolean;
  publicKeyEncrypted: boolean;
  modifiedCertificate: boolean;
  prepareDistribution: boolean;
}

export function parseFlags(raw: number): FileHeaderFlags {
  return {
    raw,
    compressed: (raw & 0x001) !== 0,
    encrypted: (raw & 0x002) !== 0,
    distribution: (raw & 0x004) !== 0,
    script: (raw & 0x008) !== 0,
    drm: (raw & 0x010) !== 0,
    xmlTemplate: (raw & 0x020) !== 0,
    documentHistory: (raw & 0x040) !== 0,
    digitalSignature: (raw & 0x080) !== 0,
    publicKeyEncrypted: (raw & 0x100) !== 0,
    modifiedCertificate: (raw & 0x200) !== 0,
    prepareDistribution: (raw & 0x400) !== 0,
  };
}

export interface FileHeader {
  version: HwpVersion;
  flags: FileHeaderFlags;
}

export class HwpHeaderError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "HwpHeaderError";
  }
}

const ASCII = new TextDecoder("ascii");

export function parseFileHeader(data: Uint8Array): FileHeader {
  if (data.byteLength < FILE_HEADER_SIZE) {
    throw new HwpHeaderError(`FileHeader 크기 부족: ${data.byteLength} (최소 ${FILE_HEADER_SIZE})`);
  }

  // 시그니처 (0..31, NULL 종료)
  const sigArea = data.subarray(0, 32);
  let sigEnd = sigArea.indexOf(0);
  if (sigEnd === -1) sigEnd = 32;
  const sig = ASCII.decode(sigArea.subarray(0, sigEnd));
  if (!sig.startsWith(HWP_SIGNATURE)) {
    throw new HwpHeaderError(`HWP 시그니처가 일치하지 않습니다: "${sig}"`);
  }

  // 버전 (revision, build, minor, major)
  const version: HwpVersion = {
    revision: data[32],
    build: data[33],
    minor: data[34],
    major: data[35],
  };

  // 플래그
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const flagsRaw = view.getUint32(36, true);
  const flags = parseFlags(flagsRaw);

  return { version, flags };
}
