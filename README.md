# hwpxjs

HWP 5.0(바이너리/CFB) 및 HWPX(OWPML/ZIP+XML) 문서를 파싱·변환하는 TypeScript 라이브러리.
Node.js 와 브라우저(ESM) 양쪽에서 동작하며, 별도의 한글(HWP) 클라이언트 의존성 없이 순수 JS 만으로 처리합니다.

- HWPX 는 ZIP 패키지 내부에 OWPML XML 로 본문을 저장하는 개방형 포맷입니다. (참고: [HWPX 포맷 구조 살펴보기](https://tech.hancom.com/hwpxformat/))
- HWP 바이너리(CFB/OLE2) 파서는 [rhwp](https://github.com/edwardkim/rhwp) (Rust, MIT, Copyright (c) 2025-2026 Edward Kim) 의 구조를 TypeScript 로 포팅한 것입니다. 라이센스 호환을 위해 각 포팅 파일의 헤더에 출처를 명시하고, 본 저장소도 동일한 MIT 라이센스를 따릅니다.

## 주요 기능

- **HWPX 읽기**: 패키지 inspect, 평문/HTML/Markdown 추출 (이미지 인라인/리졸버 지원)
- **HWPX 쓰기**: OWPML 패키지 규칙(첫 STORED `mimetype`, `META-INF/container.xml`/`manifest.xml`, OPF spine) 호환 .hwpx 생성
- **HWP 5.0 파싱**: CFB(OLE2) + raw deflate 컨테이너 → FileHeader / DocInfo / BodyText 풀 파서
- **HWP → HWPX 변환**: 표(셀 병합 포함), 이미지(BinData 패키징), 폰트/문단/스타일 정의 보존, `Preview/PrvText.txt` 자동 생성
- **Markdown ↔ HWPX 양방향**: MD lexer → IR / IR → MD writer
- **HTML → HWPX**: `htmlparser2` 기반 DOM → IR
- **표·이미지·스타일 보존**: 글자 모양(굵게/기울임/밑줄/색/크기), 문단 모양(정렬/들여쓰기/줄간격), 7개 언어별 폰트 그룹, 번호/글머리표 형식 문자열까지 OWPML refList 로 옮겨 라운드트립 가능
- **CLI**: `inspect` / `txt` / `html` / `md` / `hwp:txt` / `hwp:md` / `html:tpl` / `batch` / `batch:tpl` / `write:txt` / `md:hwpx` / `html:hwpx` / `convert:hwp`
- **템플릿 처리**: `{{key}}` 텍스트 치환 (CLI / 라이브러리)
- **브라우저 ESM 번들**: `dist/browser/hwpxjs.browser.mjs` (esbuild, 약 730KB, 모든 의존성 인라인)

### 변환 매트릭스

| 출발 \ 도착 | text | HTML | Markdown | HWPX | HWP |
| --- | --- | --- | --- | --- | --- |
| **HWP** | ✅ | ⚠️ HWPX 거쳐서 | ✅ `hwpToMarkdown` | ✅ `hwpToHwpx` | ─ |
| **HWPX** | ✅ `extractText` | ✅ `extractHtml` | ✅ `extractMarkdown` | ─ | ❌ |
| **Markdown** | ─ | ─ | ─ | ✅ `markdownToHwpx` | ❌ |
| **HTML** | ─ | ─ | ─ | ✅ `htmlToHwpx` | ❌ |
| **plain text** | ─ | ─ | ─ | ✅ `HwpxWriter` | ❌ |
| **PDF** | ❌ | ❌ | ❌ | ❌ | ❌ |

PDF 와 HWPX → HWP 역변환은 별도 도메인이라 미지원. PDF 가 필요하면 변환된 HWPX 를 LibreOffice (`libreoffice --headless --convert-to pdf`) 또는 헤드리스 Chrome 인쇄로 변환하시면 됩니다.

## 설치

```bash
pnpm add @ssabrojs/hwpxjs
# or
npm i @ssabrojs/hwpxjs
```

런타임 의존성: `cfb`, `fast-xml-parser`, `jszip`, `pako`. Node.js 18+ 권장.

## 라이브러리 사용

### HWPX 파일 읽기

```ts
import HwpxReader from "@ssabrojs/hwpxjs";
import { readFile } from "node:fs/promises";

const buf = await readFile("./document.hwpx");
const reader = new HwpxReader();
await reader.loadFromArrayBuffer(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
);

// 패키지 메타/매니페스트 정보
const info = await reader.getDocumentInfo();
// { metadata: { title?, creator?, created?, modified?, version?, caretPosition? },
//   summary:  { hasEncryptionInfo, contentsFiles, manifest?, spine? } }

// 텍스트 추출 (표 셀까지 재귀 탐색)
const text = await reader.extractText();

// 이미지 경로 목록 (BinData/ 내 파일 경로)
const images = await reader.listImages();
// → ["BinData/image1.png", "BinData/image2.jpg", ...]
```

### HTML 변환

```ts
const html = await reader.extractHtml({
  paragraphTag: "p",            // default "p"
  tableClassName: "hwpx-table", // default "hwpx-table"
  renderImages: true,           // default true
  renderTables: true,           // default true (rowSpan/colSpan 보존)
  renderStyles: true,           // default true (charProperties 기반 굵게/기울임/색/크기)
  embedImages: false,           // default false. true 시 data: URL 인라인
  tableHeaderFirstRow: false,   // default false. true 시 첫 행을 <th>
  imageSrcResolver: (binPath) => `/static/images/${binPath}`,
});
```

### HWP 바이너리 파싱 / 변환

```ts
import {
  parseHwp,
  hwpToText,
  hwpToHwpx,
  detectFormat,
  HwpEncryptedError,
  HwpUnsupportedError,
  HwpInvalidFormatError,
} from "@ssabrojs/hwpxjs";
import { readFile, writeFile } from "node:fs/promises";

const bytes = new Uint8Array(await readFile("./input.hwp"));

// 포맷 자동 감지: "hwp" | "hwpx" | "hwp3" | "unknown"
const fmt = detectFormat(bytes);

// 평문 추출
const text = await hwpToText(bytes);

// HwpDocument IR (header / docInfo / sections / binData) 직접 접근
const doc = parseHwp(bytes);
console.log(doc.docInfo.styles, doc.sections.length);

// HWPX 로 변환 (표·이미지·스타일·미리보기 모두 포함)
const hwpxBytes = await hwpToHwpx(bytes, { title: "변환본", creator: "hwpxjs" });
await writeFile("./output.hwpx", hwpxBytes);
```

`hwpToHwpx` 가 만든 HWPX 는 다음을 보존합니다:

- 표(`<hp:tbl>`/`<hp:tr>`/`<hp:tc>`/`<hp:subList>`) — `colSpan`/`rowSpan` 그대로
- 이미지 — `BinData/imageN.{png|jpg|...}` 패키징 + 매니페스트 등록 + `<hp:pic>`/`<hc:img binaryItemIDRef>` 인라인
- 폰트 — 7개 언어 그룹별(`HANGUL/LATIN/HANJA/JAPANESE/OTHER/SYMBOL/USER`) 실제 사용 폰트
- 글자 모양 — `<hh:charPr>` 의 `fontRef`/`textColor`/`shadeColor`/`height` + `<hh:bold>`/`<hh:italic>`/`<hh:underline>`/`<hh:strikeout>` 요소
- 문단 모양 — 정렬(`LEFT|RIGHT|CENTER|JUSTIFY|DISTRIBUTE`), 좌/우 여백, 들여쓰기, 줄간격
- 스타일 정의 — `<hh:style>` + `paraPrIDRef`/`charPrIDRef`
- 번호 매기기 — 수준별 형식 문자열(예: `^1.`, `^1)`)
- 글머리표 — 글머리 문자(●/○/■ 등)
- 미리보기 — `Preview/PrvText.txt` 자동 생성 (한컴 호환 형식, 다른 뷰어/탐색기에서 썸네일/미리보기 지원)

> 한계: `BorderFill` 의 그라데이션/이미지 채우기와 도형의 사각형/타원/호/다각형/곡선 좌표·스타일은 종류만 표시합니다(직선만 좌표 보존). 차트·OLE·글맵시는 미지원이고, 머리말/꼬리말/각주는 본문 흐름에 평탄 출력되며 별도 master page 매핑은 향후 지원 예정입니다.

### Markdown / HTML ↔ HWPX

```ts
import {
  hwpToMarkdown,
  markdownToHwpx,
  htmlToHwpx,
} from "@ssabrojs/hwpxjs";
import { readFile, writeFile } from "node:fs/promises";

// HWP → Markdown
const md = await hwpToMarkdown(new Uint8Array(await readFile("./input.hwp")));

// HWPX → Markdown
import HwpxReader from "@ssabrojs/hwpxjs";
const reader = new HwpxReader();
await reader.loadFromArrayBuffer(/* ArrayBuffer */);
const md2 = await reader.extractMarkdown({ embedImages: true });

// Markdown → HWPX (heading/bold/italic/list/table/image-data-URI)
const mdSrc = `# 제목\n\n**굵게** 그리고 *기울임*\n\n| A | B |\n| --- | --- |\n| 1 | 2 |`;
const hwpxFromMd = await markdownToHwpx(mdSrc, { title: "from-md", creator: "me" });
await writeFile("./from-md.hwpx", hwpxFromMd);

// HTML → HWPX (p/h1-6/strong/em/ul/ol/li/table/blockquote/pre/img-data-URI)
const html = `<h1>제목</h1><p>본문 <strong>강조</strong></p>`;
const hwpxFromHtml = await htmlToHwpx(html);
await writeFile("./from-html.hwpx", hwpxFromHtml);
```

이미지는 `data:` URI 인 경우만 BinData 로 임베드됩니다. 외부 URL/상대경로 이미지는 스킵 (런타임 fetch 가 필요해서 1차 포팅 범위 밖).

### 평문 → HWPX 작성

```ts
import { HwpxWriter } from "@ssabrojs/hwpxjs";
import { writeFile } from "node:fs/promises";

const writer = new HwpxWriter();
const bytes = await writer.createFromPlainText("첫 문단\n두 번째 문단", {
  title: "예시",
  creator: "홍길동",
});
await writeFile("./output.hwpx", bytes);
```

`HwpxWriter` 는 OWPML 패키지 규칙(첫 STORED `mimetype`, `META-INF/container.xml`/`manifest.xml`, OPF 매니페스트+spine, 최소 충실도의 `header.xml` 1세트)을 따르는 spec 호환 .hwpx 를 생성합니다. 한컴오피스 / LibreOffice 에서 그대로 열립니다.

### 오류 처리

```ts
import HwpxReader, {
  HwpxNotLoadedError,
  HwpxEncryptedDocumentError,
  InvalidHwpxFormatError,
  HwpEncryptedError,
  HwpUnsupportedError,
  HwpInvalidFormatError,
} from "@ssabrojs/hwpxjs";

try {
  const reader = new HwpxReader();
  await reader.loadFromArrayBuffer(buffer);
  await reader.extractText();
} catch (e) {
  if (e instanceof HwpxEncryptedDocumentError) {
    // 암호화 HWPX — 미지원
  } else if (e instanceof InvalidHwpxFormatError) {
    // 유효하지 않은 HWPX
  } else if (e instanceof HwpxNotLoadedError) {
    // loadFromArrayBuffer 미호출
  } else if (e instanceof HwpEncryptedError) {
    // 암호화 HWP — 미지원
  } else if (e instanceof HwpUnsupportedError) {
    // 배포용 ViewText / HWP 3.0 등
  } else if (e instanceof HwpInvalidFormatError) {
    // CFB 시그니처 아님
  } else {
    throw e;
  }
}
```

### 브라우저(ESM) 사용

`dist/browser/hwpxjs.browser.mjs` 는 모든 의존성을 인라인한 단일 ESM 번들입니다. `package.json` 의 `exports.browser` 조건과 `./browser` 서브패스로 매핑되어 있습니다.

번들러(Vite/webpack) 사용 시:

```ts
// 번들러가 browser 조건을 자동 선택
import { hwpToText, parseHwp } from "@ssabrojs/hwpxjs";

// 명시적으로 브라우저 빌드 지정
import { hwpToText } from "@ssabrojs/hwpxjs/browser";
```

`<script type="module">` 직접 로드:

```html
<script type="module">
  import { hwpToText, hwpToHwpx } from "https://cdn.jsdelivr.net/npm/@ssabrojs/hwpxjs/dist/browser/hwpxjs.browser.mjs";

  document.querySelector("#file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    const bytes = new Uint8Array(await file.arrayBuffer());
    const text = await hwpToText(bytes);
    document.querySelector("#out").textContent = text;
  });
</script>
```

## CLI

설치 후 `hwpxjs` 또는 `hwpx` 명령으로 사용할 수 있습니다.

```bash
# HWPX 검사 / 추출
hwpxjs inspect document.hwpx
hwpxjs txt document.hwpx
hwpxjs html document.hwpx > out.html
hwpxjs md document.hwpx > out.md

# HWP 바이너리 (자동 라우팅: txt/md 명령은 .hwp 확장자 인식)
hwpxjs txt document.hwp
hwpxjs md document.hwp
hwpxjs hwp:txt document.hwp
hwpxjs hwp:md document.hwp > out.md
hwpxjs convert:hwp document.hwp converted.hwpx

# 작성 / 변환
hwpxjs write:txt notes.txt out.hwpx           # 평문 → HWPX
hwpxjs md:hwpx notes.md out.hwpx              # Markdown → HWPX
hwpxjs html:hwpx page.html out.hwpx           # HTML → HWPX

# 일괄 처리: HWPX → HTML
hwpxjs batch ./input ./output

# 템플릿 ({{key}} 치환)
hwpxjs html:tpl template.hwpx data.json > result.html
hwpxjs batch:tpl ./templates ./data ./output
```

## 아키텍처 개요

`src/lib/` 아래 모듈 구성:

| 모듈 | 역할 |
| --- | --- |
| `hwpxReader.ts` | HWPX(ZIP+XML) 읽기 — 매니페스트/spine 으로 섹션 순서 결정, `extractText`/`extractHtml`/`listImages` |
| `writer.ts` | 평문 → HWPX (`HwpxWriter.createFromPlainText`) |
| `errors.ts` | HWPX 측 에러 클래스 (`HwpxNotLoadedError` 등) |
| `types.ts` | HWPX 측 공개 타입 |
| `hwp/index.ts` | HWP 바이너리 진입점 — `detectFormat`/`parseHwp`/`hwpToText`/`hwpToHwpx` |
| `hwp/cfbReader.ts` | CFB(OLE2) 컨테이너 + raw deflate 압축 해제 (cfb + pako) |
| `hwp/fileHeader.ts` | FileHeader 256B — 시그니처/버전/11종 플래그 |
| `hwp/record.ts` | DocInfo/BodyText 공통 4바이트 레코드 헤더(tag/level/size + 확장 size) |
| `hwp/docInfo.ts` | DocInfo 스트림 — FACE_NAME/CHAR_SHAPE/PARA_SHAPE/STYLE/BORDER_FILL/NUMBERING/BULLET/TAB_DEF/BIN_DATA |
| `hwp/bodyText.ts` | BodyText 섹션 — PARA_HEADER/PARA_TEXT/PARA_CHAR_SHAPE 와 컨트롤 문자, 계층적 nested 문단 |
| `hwp/control.ts` | 인라인 컨트롤 — 표(rowSpan/colSpan) / 그림(GSO+SHAPE_PICTURE) / 머리말·꼬리말·각주 / 필드 / 도형 / 수식(EQEDIT) |
| `hwp/binData.ts` | 임베디드 바이너리(이미지/OLE) 추출 — OLE storage prefix 보정 |
| `hwp/converter.ts` | `HwpDocument` IR → 텍스트 / HWPX 라우팅 |
| `hwp/hwpxBuilder.ts` | `HwpDocument` → HWPX 패키지 합성 (header.xml refList 풀 출력, section.xml 실 ID 참조, BinData 패키징, PrvText 생성) |
| `hwp/types.ts` | HWP IR 타입 (`HwpDocument`, `HwpSection`, `HwpParagraph`, `HwpControl` …) |
| `hwp/tags.ts` | HWPTAG_* 상수 |
| `hwp/byteReader.ts` | LE u8/u16/u32, signed, UTF-16, HWP 문자열, 바운드 체크 |

`src/cli.ts` 는 위 라이브러리를 얇게 감싼 CLI 진입점이고, `scripts/build-browser.mjs` 는 esbuild 로 브라우저 번들을 만듭니다.

## 개발

```bash
# 빌드 (tsc → dist/, esbuild → dist/browser/hwpxjs.browser.mjs)
npm run build

# 테스트 (vitest, 59 tests / 7 files: 단위 + 통합 + 견고성)
npm test
npm run test:watch
```

테스트 픽스처는 `test/fixtures/` 또는 사용자의 `~/Documents/` 에서 자동 탐지합니다. 다음 파일들이 있으면 통합 테스트가 활성화됩니다:

- `1.hwp`, `1.hwpx` — 폼 양식 (다중 셀 표)
- `여름휴가 안내문.hwp` — 이미지 임베드 (PNG + JPG)
- `공고문(안)(26.4.24.).hwp` — 표 셀 병합 (rowSpan 2/3/5)

## 알려진 제한 (0.3.0)

- 암호화 HWP / 배포용 ViewText / HWP 3.0 미지원 — 명시적 에러 발생
- 머리말/꼬리말/각주: 본문 흐름에 평탄 paragraph 로 출력 (별도 master page 매핑은 향후)
- BorderFill 그라데이션/이미지 채우기 미보존 (단색 채우기·4면 테두리·대각선은 보존)
- 번호 매기기 수준별 시작번호: 기본 1
- 차트(CHART_DATA) / OLE / 글맵시: 미지원
- 도형: `line` 의 좌표만 보존, 사각형/타원/호/다각형/곡선은 종류만 보존

## 구현 노트

- `HwpxReader` 는 `Contents/content.hpf` 의 manifest+spine 으로 섹션 순서를 결정하며, 실패 시 `Contents/section*.xml` 알파벳 순서로 폴백합니다.
- 암호화 감지는 `META-INF/manifest.xml` 의 `encrypt|cipher` 마커에 의존합니다(휴리스틱). 복호화는 미지원입니다.
- HWP 5.0 바이너리 파서는 [rhwp](https://github.com/edwardkim/rhwp) (MIT) 의 구조를 TypeScript 로 포팅 중이며, 각 포팅 파일 헤더에 출처가 명시되어 있습니다.

## 라이센스

MIT. HWP 바이너리 파서 부분은 rhwp (MIT, Copyright (c) 2025-2026 Edward Kim) 의 코드 구조를 TypeScript 로 포팅한 것이며 동일 MIT 라이센스에서 재배포됩니다. 자세한 내용은 [LICENSE](./LICENSE) 와 각 포팅 파일의 헤더 주석을 참조해 주세요.
