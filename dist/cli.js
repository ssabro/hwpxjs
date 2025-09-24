#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import HwpxReader from "./lib/hwpxReader.js";
import HwpxWriter from "./lib/writer.js";
import { HwpConverter } from "./lib/hwpConverter.js";
async function main() {
    const [command, inputPath, maybeOut] = process.argv.slice(2);
    if (!command || !inputPath) {
        console.error("Usage: hwpxjs <inspect|txt|html> <file.hwpx> | hwpxjs batch <folder> <outFolder> | hwpxjs html:tpl <file.hwpx> <data.json> | hwpxjs batch:tpl <inFolder> <dataFolder> <outFolder> | hwpxjs write:txt <textfile> <out.hwpx> | hwpxjs convert:hwp <file.hwp> <out.hwpx> | hwpxjs hwp:txt <file.hwp>");
        process.exit(1);
    }
    // hwp:txt 명령어 - HWP 파일에서 텍스트만 추출
    if (command === "hwp:txt") {
        const converter = new HwpConverter({ verbose: false });
        try {
            const text = await converter.convertHwpToText(inputPath);
            console.log(text);
        }
        catch (error) {
            console.error("✗ Failed to extract text from HWP file:");
            console.error(error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
        return;
    }
    // convert:hwp 명령어는 별도 처리 (Java 라이브러리 사용)
    if (command === "convert:hwp") {
        const outPath = maybeOut;
        if (!outPath) {
            console.error("Usage: hwpxjs convert:hwp <input.hwp> <output.hwpx>");
            process.exit(1);
        }
        const converter = new HwpConverter({ verbose: true });
        // Check if converter is available
        const isAvailable = await converter.isAvailable();
        if (!isAvailable) {
            console.error("HWP converter is not available.");
            process.exit(1);
        }
        console.log("Converting HWP to HWPX...");
        console.log(`Input: ${inputPath}`);
        console.log(`Output: ${outPath}`);
        const result = await converter.convertHwpToHwpx(inputPath, outPath);
        if (result.success) {
            console.log("✓ Conversion completed successfully");
            console.log(`Output saved to: ${result.outputPath}`);
        }
        else {
            console.error("✗ Conversion failed:");
            console.error(result.error);
            if (result.stderr) {
                console.error("Java error output:");
                console.error(result.stderr);
            }
            process.exit(1);
        }
        return;
    }
    // write:txt 명령어는 별도 처리 (텍스트 파일에서 HWPX 생성)
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
    const buf = await readFile(inputPath);
    const reader = new HwpxReader();
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
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
        const replaced = reader.applyTemplateToText(rawText, json);
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
            if (!name.toLowerCase().endsWith(".hwpx"))
                continue;
            const inPath = join(inDir, name);
            const buf2 = await rf(inPath);
            const reader2 = new HwpxReader();
            const ab2 = buf2.buffer.slice(buf2.byteOffset, buf2.byteOffset + buf2.byteLength);
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
            if (!name.toLowerCase().endsWith(".hwpx"))
                continue;
            const inPath = join(inDir, name);
            const buf2 = await rf(inPath);
            const reader2 = new HwpxReader();
            const ab2 = buf2.buffer.slice(buf2.byteOffset, buf2.byteOffset + buf2.byteLength);
            await reader2.loadFromArrayBuffer(ab2);
            // data.json 선정: 동일 파일명.json 우선, 없으면 default.json
            const jsonName = basename(name, '.hwpx') + '.json';
            let json = {};
            try {
                json = JSON.parse(await rf(join(dataDir, jsonName), 'utf-8'));
            }
            catch {
                try {
                    json = JSON.parse(await rf(join(dataDir, 'default.json'), 'utf-8'));
                }
                catch { }
            }
            const rawText = await reader2.extractText({});
            // @ts-ignore 간단 접근
            const replaced = reader2.applyTemplateToText(rawText, json);
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
main().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
});
