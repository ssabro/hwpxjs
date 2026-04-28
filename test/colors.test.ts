import { describe, expect, it } from "vitest";
import { colorBgrToHex } from "../src/lib/hwp/hwpxBuilder.js";

describe("colorBgrToHex", () => {
  it("converts black", () => {
    expect(colorBgrToHex(0x000000)).toBe("#000000");
  });

  it("converts white (BBGGRR=FFFFFF)", () => {
    expect(colorBgrToHex(0xffffff)).toBe("#FFFFFF");
  });

  it("converts pure red (HWP stores R in low byte)", () => {
    // HWP color: 0x000000FF = R=FF G=00 B=00 → #FF0000
    expect(colorBgrToHex(0x0000ff)).toBe("#FF0000");
  });

  it("converts pure blue (HWP stores B in high byte)", () => {
    // HWP color: 0x00FF0000 = R=00 G=00 B=FF → #0000FF
    expect(colorBgrToHex(0xff0000)).toBe("#0000FF");
  });

  it("converts a custom color", () => {
    // bytes in HWP: [0x8E, 0x61, 0x30] → R=0x8E G=0x61 B=0x30 readU32 LE = 0x0030618E
    // → #8E6130
    expect(colorBgrToHex(0x0030618e)).toBe("#8E6130");
  });

  it("ignores alpha byte (top u32 byte)", () => {
    expect(colorBgrToHex(0xff000000)).toBe("#000000");
  });
});
