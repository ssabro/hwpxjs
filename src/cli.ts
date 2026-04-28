#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import HwpxReader from "./lib/hwpxReader.js";
import HwpxWriter from "./lib/writer.js";
import {
  detectFormat,
  parseHwp,
  hwpToHwpx,
  hwpToText,
  hwpToMarkdown,
  markdownToHwpx,
  htmlToHwpx,
} from "./lib/hwp/index.js";

async function main() {
  const [command, inputPath, maybeOut] = process.argv.slice(2);
  if (!command || !inputPath) {
    console.error(
      "Usage:\n" +
      "  hwpxjs inspect <file.hwpx>\n" +
      "  hwpxjs txt <file.hwpx|file.hwp>\n" +
      "  hwpxjs html <file.hwpx>\n" +
      "  hwpxjs md <file.hwpx|file.hwp>      # Markdown 추출\n" +
      "  hwpxjs html:tpl <file.hwpx> <data.json>\n" +
      "  hwpxjs batch <inFolder> <outFolder>\n" +
      "  hwpxjs batch:tpl <inFolder> <dataFolder> <outFolder>\n" +
      "  hwpxjs write:txt <textfile> <out.hwpx>\n" +
      "  hwpxjs md:hwpx <file.md> <out.hwpx>    # Markdown → HWPX\n" +
      "  hwpxjs html:hwpx <file.html> <out.hwpx># HTML → HWPX\n" +
      "  hwpxjs convert:hwp <file.hwp> <out.hwpx>\n" +
      "  hwpxjs hwp:txt <file.hwp>\n" +
      "  hwpxjs hwp:md <file.hwp>"
    );
    process.exit(1);
  }

  if (command === "hwp:txt") {
    const buf = await readFile(inputPath);
    const ab = toArrayBuffer(buf);
    const text = await hwpToText(new Uint8Array(ab));
    console.log(text);
    return;
  }

  if (command === "hwp:md") {
    const buf = await readFile(inputPath);
    const ab = toArrayBuffer(buf);
    const md = await hwpToMarkdown(new Uint8Array(ab));
    console.log(md);
    return;
  }

  if (command === "md:hwpx") {
    const outPath = maybeOut;
    if (!outPath) {
      console.error("Usage: hwpxjs md:hwpx <input.md> <output.hwpx>");
      process.exit(1);
    }
    const md = await readFile(inputPath, "utf-8");
    const bytes = await markdownToHwpx(md);
    const { writeFile: wf } = await import("node:fs/promises");
    await wf(outPath, bytes);
    console.log(`Wrote ${outPath}`);
    return;
  }

  if (command === "html:hwpx") {
    const outPath = maybeOut;
    if (!outPath) {
      console.error("Usage: hwpxjs html:hwpx <input.html> <output.hwpx>");
      process.exit(1);
    }
    const html = await readFile(inputPath, "utf-8");
    const bytes = await htmlToHwpx(html);
    const { writeFile: wf } = await import("node:fs/promises");
    await wf(outPath, bytes);
    console.log(`Wrote ${outPath}`);
    return;
  }

  if (command === "convert:hwp") {
    const outPath = maybeOut;
    if (!outPath) {
      console.error("Usage: hwpxjs convert:hwp <input.hwp> <output.hwpx>");
      process.exit(1);
    }
    const buf = await readFile(inputPath);
    const bytes = await hwpToHwpx(new Uint8Array(toArrayBuffer(buf)));
    const { writeFile: wf } = await import("node:fs/promises");
    await wf(outPath, bytes);
    console.log(`Wrote ${outPath}`);
    return;
  }

  if (command === "write:txt") {
    const textPath = inputPath;
    const outPath = maybeOut;
    if (!outPath) {
      console.error("Usage: hwpxjs write:txt <textfile> <out.hwpx>");
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

  // 자동 감지: .hwp 파일이 들어오면 hwp:txt 로 라우팅
  if (command === "txt" && /\.hwp$/i.test(inputPath)) {
    const buf = await readFile(inputPath);
    const ab = toArrayBuffer(buf);
    const text = await hwpToText(new Uint8Array(ab));
    console.log(text);
    return;
  }

  if (command === "md") {
    if (/\.hwp$/i.test(inputPath)) {
      const buf = await readFile(inputPath);
      const md = await hwpToMarkdown(new Uint8Array(toArrayBuffer(buf)));
      console.log(md);
      return;
    }
    // HWPX 경로
    const buf = await readFile(inputPath);
    const reader = new HwpxReader();
    await reader.loadFromArrayBuffer(toArrayBuffer(buf));
    const md = await reader.extractMarkdown();
    console.log(md);
    return;
  }

  const buf = await readFile(inputPath);
  const ab = toArrayBuffer(buf);
  const reader = new HwpxReader();
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
    const rawText = await reader.extractText({});
    const replaced = (reader as unknown as { applyTemplateToText: (raw: string, data: unknown) => string })
      .applyTemplateToText(rawText, json);
    const html = replaced
      .split(/\n+/)
      .map((line) => `<p>${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`)
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
      await reader2.loadFromArrayBuffer(toArrayBuffer(buf2));
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
      await reader2.loadFromArrayBuffer(toArrayBuffer(buf2));
      const jsonName = basename(name, ".hwpx") + ".json";
      let json: unknown = {};
      try {
        json = JSON.parse(await rf(join(dataDir, jsonName), "utf-8"));
      } catch {
        try {
          json = JSON.parse(await rf(join(dataDir, "default.json"), "utf-8"));
        } catch {
          /* ignore */
        }
      }
      const rawText = await reader2.extractText({});
      const replaced = (reader2 as unknown as { applyTemplateToText: (raw: string, data: unknown) => string })
        .applyTemplateToText(rawText, json);
      const html = replaced
        .split(/\n+/)
        .map((line) => `<p>${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`)
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

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
