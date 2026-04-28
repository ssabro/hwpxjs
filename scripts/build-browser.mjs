#!/usr/bin/env node
import { build } from "esbuild";
import { rm, mkdir } from "node:fs/promises";

await rm("dist/browser", { recursive: true, force: true });
await mkdir("dist/browser", { recursive: true });

const result = await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2020",
  outfile: "dist/browser/hwpxjs.browser.mjs",
  sourcemap: true,
  // Node-only built-in 모듈 명시적으로 제외 (CLI 만 사용)
  external: ["node:fs", "node:fs/promises", "node:path", "node:os", "node:buffer"],
  // 빈 stub 으로 대체 (cfb 패키지의 fs 의존성 대응)
  alias: {
    fs: "./scripts/empty.mjs",
    path: "./scripts/empty.mjs",
  },
  define: {
    "process.env.NODE_ENV": '"production"',
  },
  metafile: true,
  treeShaking: true,
});

const out = result.metafile?.outputs?.["dist/browser/hwpxjs.browser.mjs"];
if (out) {
  const kb = (out.bytes / 1024).toFixed(1);
  console.log(`✓ Built dist/browser/hwpxjs.browser.mjs (${kb} KB)`);
}
