import { describe, expect, it } from "vitest";
import { detectFormat } from "../src/lib/hwp/index.js";

describe("detectFormat", () => {
  it("detects HWP 5.0 (CFB) signature", () => {
    const cfb = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
    expect(detectFormat(cfb)).toBe("hwp");
  });

  it("detects HWPX (ZIP) signature", () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0, 0, 0]);
    expect(detectFormat(zip)).toBe("hwpx");
  });

  it("detects HWP 3.0 prefix", () => {
    const hwp3 = new TextEncoder().encode("HWP Document File V3.00");
    expect(detectFormat(hwp3)).toBe("hwp3");
  });

  it("returns unknown for arbitrary bytes", () => {
    expect(detectFormat(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]))).toBe("unknown");
    expect(detectFormat(new Uint8Array(0))).toBe("unknown");
  });

  it("does not misidentify too-short data", () => {
    expect(detectFormat(new Uint8Array([0x50, 0x4b]))).toBe("unknown");
  });
});
