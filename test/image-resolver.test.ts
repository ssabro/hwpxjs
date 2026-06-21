/**
 * imageResolver 옵션 — data URI 가 아닌 이미지(로컬 경로/file://)를 임베드하는 부가기능.
 * 코어는 resolver 를 주입받기만 하고(브라우저 안전), Node 측(CLI)에서 fs 기반 resolver 를 제공한다.
 * [shyang 2026-06-21]
 */
import { describe, expect, it } from "vitest";
import JSZip from "jszip";

import { markdownToHwpx, htmlToHwpx } from "../src/lib/hwp/index.js";

const PNG = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYGD4DwABBAEAfbLI3wAAAABJRU5ErkJggg==",
    "base64"
  )
);

function binPaths(zip: JSZip): string[] {
  return Object.keys(zip.files).filter((p) => p.startsWith("BinData/") && !p.endsWith("/"));
}

describe("imageResolver 옵션", () => {
  it("md 의 비-dataURI 이미지를 resolver 로 BinData 임베드", async () => {
    const bytes = await markdownToHwpx(`![logo](./logo.png)`, {
      imageResolver: (src) => (src.endsWith(".png") ? { data: PNG, extension: "png" } : null),
    });
    const zip = await JSZip.loadAsync(bytes);
    const bins = binPaths(zip);
    expect(bins.length).toBe(1);
    expect(bins[0]).toMatch(/\.png$/i);
    const sec = await zip.file("Contents/section0.xml")!.async("string");
    expect(sec).toContain("<hp:pic");
    expect(sec).toContain("binaryItemIDRef");
  });

  it("resolver 없으면 비-dataURI 이미지는 스킵 (BinData 없음)", async () => {
    const bytes = await markdownToHwpx(`![logo](./logo.png)`);
    const zip = await JSZip.loadAsync(bytes);
    expect(binPaths(zip).length).toBe(0);
  });

  it("data URI 는 resolver 와 무관하게 항상 임베드", async () => {
    const dataUri =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYGD4DwABBAEAfbLI3wAAAABJRU5ErkJggg==";
    const bytes = await markdownToHwpx(`![x](${dataUri})`); // resolver 없음
    const zip = await JSZip.loadAsync(bytes);
    expect(binPaths(zip).length).toBe(1);
  });

  it("html 경로(htmlToHwpx)도 resolver 를 지원", async () => {
    const bytes = await htmlToHwpx(`<p>img</p><img src="file:///x.png">`, {
      imageResolver: () => ({ data: PNG, extension: "png" }),
    });
    const zip = await JSZip.loadAsync(bytes);
    expect(binPaths(zip).some((p) => p.endsWith(".png"))).toBe(true);
  });
});
