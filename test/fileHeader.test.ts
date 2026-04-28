import { describe, expect, it } from "vitest";
import {
  HWP_SIGNATURE,
  FILE_HEADER_SIZE,
  parseFileHeader,
  parseFlags,
  isVersionSupported,
  versionToString,
  HwpHeaderError,
} from "../src/lib/hwp/fileHeader.js";

function makeHeader(major: number, minor: number, flags: number, build = 0, revision = 0): Uint8Array {
  const data = new Uint8Array(FILE_HEADER_SIZE);
  // signature
  for (let i = 0; i < HWP_SIGNATURE.length; i++) {
    data[i] = HWP_SIGNATURE.charCodeAt(i);
  }
  data[32] = revision;
  data[33] = build;
  data[34] = minor;
  data[35] = major;
  new DataView(data.buffer).setUint32(36, flags, true);
  return data;
}

describe("FileHeader", () => {
  it("HWP_SIGNATURE constant", () => {
    expect(HWP_SIGNATURE).toBe("HWP Document File");
  });

  it("parses a valid HWP 5.0 compressed header", () => {
    const data = makeHeader(5, 0, 0x01);
    const h = parseFileHeader(data);
    expect(h.version.major).toBe(5);
    expect(h.version.minor).toBe(0);
    expect(h.flags.compressed).toBe(true);
    expect(h.flags.encrypted).toBe(false);
    expect(h.flags.distribution).toBe(false);
  });

  it("decodes encrypted/distribution flags", () => {
    const enc = parseFileHeader(makeHeader(5, 0, 0x03));
    expect(enc.flags.encrypted).toBe(true);
    const dist = parseFileHeader(makeHeader(5, 0, 0x05));
    expect(dist.flags.distribution).toBe(true);
  });

  it("decodes all 11 flag bits", () => {
    const f = parseFlags(0x7ff);
    expect(f.compressed).toBe(true);
    expect(f.encrypted).toBe(true);
    expect(f.distribution).toBe(true);
    expect(f.script).toBe(true);
    expect(f.drm).toBe(true);
    expect(f.xmlTemplate).toBe(true);
    expect(f.documentHistory).toBe(true);
    expect(f.digitalSignature).toBe(true);
    expect(f.publicKeyEncrypted).toBe(true);
    expect(f.modifiedCertificate).toBe(true);
    expect(f.prepareDistribution).toBe(true);
  });

  it("rejects too-short data", () => {
    expect(() => parseFileHeader(new Uint8Array(100))).toThrow(HwpHeaderError);
  });

  it("rejects invalid signature", () => {
    const bad = new Uint8Array(FILE_HEADER_SIZE);
    bad.set(new TextEncoder().encode("NOT A HWP!"), 0);
    expect(() => parseFileHeader(bad)).toThrow(HwpHeaderError);
  });

  it("isVersionSupported and versionToString", () => {
    expect(isVersionSupported({ major: 5, minor: 0, build: 0, revision: 0 })).toBe(true);
    expect(isVersionSupported({ major: 5, minor: 1, build: 0, revision: 0 })).toBe(true);
    expect(isVersionSupported({ major: 3, minor: 0, build: 0, revision: 0 })).toBe(false);
    expect(versionToString({ major: 5, minor: 0, build: 6, revision: 1 })).toBe("5.0.6.1");
  });
});
