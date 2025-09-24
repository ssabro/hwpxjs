#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import HwpxReader from "./lib/hwpxReader.js";
import HwpxWriter from "./lib/writer.js";

async function main() {
  const [command, inputPath, maybeOut] = process.argv.slice(2);
  if (!command || !inputPath) {
    console.error("Usage: hwpxjs <inspect|txt|html> <file.hwpx> | hwpxjs batch <folder> <outFolder> | hwpxjs html:tpl <file.hwpx> <data.json> | hwpxjs batch:tpl <inFolder> <dataFolder> <outFolder> | hwpxjs write:txt <out.hwpx> <textfile>");
    process.exit(1);
  }

  // write:txt 명령어는 별도 처리 (inputPath가 HWPX가 아님)
  if (command === "write:txt") {
    const outPath = inputPath;
    const textPath = maybeOut;
    if (!textPath) {
      console.error("Usage: hwpxjs write:txt <out.hwpx> <textfile>");
      process.exit(1);
    }
    const { writeFile: wf } = await import("node:fs/promises");
    const text = await readFile(textPath, "utf-8");
    const writer = new HwpxWriter();
    const bytes = await writer.createFromPlainText(text);
    await wf(outPath, bytes);
    console.log(`Wrote ${outPath}`);
    return;
  }

  const buf = await readFile(inputPath);
  const reader = new HwpxReader();
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  await reader.loadFromArrayBuffer(ab);

  if (command === "inspect") {
    const info = await reader.getDocumentInfo();
    console.log(JSON.stringify(info, null, 2));
    return;
  }

  if (command === "txt") {
    const text = await reader.extractText();
    console.log(text);
    return;
  }

  if (command === "html") {
    const html = await reader.extractHtml({ embedImages: true });
    console.log(html);
    return;
  }

  if (command === "html:tpl") {
    const dataPath = maybeOut;
    if (!dataPath) {
      console.error("Usage: hwpxjs html:tpl <in.hwpx> <data.json>");
      process.exit(1);
    }
    const { readFile: rf } = await import("node:fs/promises");
    const json = JSON.parse(await rf(dataPath, "utf-8"));
    // 텍스트 추출 후 치환 → HTML 변환(간단히 p 래핑)
    const rawText = await reader.extractText({});
    // @ts-ignore private 접근 회피 없이 간단 래핑을 위해 인스턴스 메서드를 사용
    const replaced = (reader as any).applyTemplateToText(rawText, json);
    const html = replaced
      .split(/\n+/)
      .map((line: string) => `<p>${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`) 
      .join("");
    console.log(html);
    return;
  }

  if (command === "batch") {
    const inDir = inputPath;
    const outDir = maybeOut;
    if (!outDir) {
      console.error("Usage: hwpxjs batch <inFolder> <outFolder>");
      process.exit(1);
    }
    const { readdir, readFile: rf, writeFile, mkdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    await mkdir(outDir, { recursive: true });
    const entries = await readdir(inDir);
    for (const name of entries) {
      if (!name.toLowerCase().endsWith(".hwpx")) continue;
      const inPath = join(inDir, name);
      const buf2 = await rf(inPath);
      const reader2 = new HwpxReader();
      const ab2 = buf2.buffer.slice(buf2.byteOffset, buf2.byteOffset + buf2.byteLength) as ArrayBuffer;
      await reader2.loadFromArrayBuffer(ab2);
      const html = await reader2.extractHtml({ embedImages: true });
      const outName = name.replace(/\.hwpx$/i, ".html");
      const outPath = join(outDir, outName);
      await writeFile(outPath, html, "utf-8");
      console.log(`Wrote ${outPath}`);
    }
    return;
  }

  if (command === "batch:tpl") {
    const inDir = inputPath;
    const dataDir = maybeOut;
    const outDir = process.argv[5];
    if (!dataDir || !outDir) {
      console.error("Usage: hwpxjs batch:tpl <inFolder> <dataFolder> <outFolder>");
      process.exit(1);
    }
    const { readdir, readFile: rf, writeFile, mkdir } = await import("node:fs/promises");
    const { join, basename } = await import("node:path");
    await mkdir(outDir, { recursive: true });
    const entries = await readdir(inDir);
    for (const name of entries) {
      if (!name.toLowerCase().endsWith(".hwpx")) continue;
      const inPath = join(inDir, name);
      const buf2 = await rf(inPath);
      const reader2 = new HwpxReader();
      const ab2 = buf2.buffer.slice(buf2.byteOffset, buf2.byteOffset + buf2.byteLength) as ArrayBuffer;
      await reader2.loadFromArrayBuffer(ab2);
      // data.json 선정: 동일 파일명.json 우선, 없으면 default.json
      const jsonName = basename(name, '.hwpx') + '.json';
      let json: any = {};
      try {
        json = JSON.parse(await rf(join(dataDir, jsonName), 'utf-8'));
      } catch {
        try {
          json = JSON.parse(await rf(join(dataDir, 'default.json'), 'utf-8'));
        } catch {}
      }
      const rawText = await reader2.extractText({});
      // @ts-ignore 간단 접근
      const replaced = (reader2 as any).applyTemplateToText(rawText, json);
      const html = replaced
        .split(/\n+/)
        .map((line: string) => `<p>${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`)
        .join("");
      const outName = name.replace(/\.hwpx$/i, ".html");
      const outPath = join(outDir, outName);
      await writeFile(outPath, html, "utf-8");
      console.log(`Wrote ${outPath}`);
    }
    return;
  }

  console.error("Unknown command:", command);
  process.exit(1);
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});

