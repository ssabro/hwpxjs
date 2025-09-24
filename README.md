# hwpxjs

HWPX(OWPML) 문서 파싱과 텍스트/메타데이터 추출을 위한 TypeScript 라이브러리.

- HWPX는 ZIP 패키지 내부에 XML로 문서가 저장되는 개방형 포맷입니다. (참고: [HWPX 포맷 구조 살펴보기](https://tech.hancom.com/hwpxformat/))

주요 기능
- ZIP+XML 파싱, 섹션/문단 텍스트 추출, 간단 HTML 변환
- 표/이미지/스타일(굵게/기울임/밑줄/색상/크기 일부) 처리
- 템플릿 치환(`{{key}}`) 및 폴더 일괄 변환
- 최소 쓰기: 평문 텍스트 → .hwpx 생성
- 브라우저 데모(드래그&드롭 뷰어)

## 설치

의존성 설치 전, 먼저 승인해 주세요.

```bash
pnpm add @ssabrojs/hwpxjs
```

## 사용법 (라이브러리)

```ts
import HwpxReader from "@ssabrojs/hwpxjs";

const buffer = await fetch("/foo.hwpx").then(r => r.arrayBuffer());
const reader = new HwpxReader();
await reader.loadFromArrayBuffer(buffer);

const info = await reader.getDocumentInfo();
const text = await reader.extractText();
const images = await reader.listImages();

// HTML 추출(옵션 포함 예시)
const html = await reader.extractHtml({
  paragraphTag: "p",
  tableClassName: "hwpx-table",
  renderImages: true,
  renderTables: true,
  renderStyles: true,
  embedImages: false,
  tableHeaderFirstRow: true,
  imageSrcResolver: (binPath) => `/assets/${binPath}`
});
```

## CLI

```bash
# 요약
hwpxjs inspect sample.hwpx

# 텍스트/HTML
hwpxjs txt sample.hwpx
hwpxjs html sample.hwpx > sample.html

# 템플릿(치환)
hwpxjs html:tpl sample.hwpx data.json > out.html

# 폴더 일괄 변환
hwpxjs batch ./samples ./out
hwpxjs batch:tpl ./samples ./data ./out

# 쓰기(평문 → .hwpx)
hwpxjs write:txt out.hwpx notes.txt
```

## 브라우저 데모

정적 파일을 브라우저에서 직접 여세요:

```text
examples/browser/index.html
```

드래그&드롭으로 .hwpx를 올리면 텍스트/간단 HTML/요약을 표시합니다. 구현은 JSZip CDN + DOMParser 기반이며 번들 없이 동작합니다.

## HTML 옵션 요약

- paragraphTag: 기본 "p"
- tableClassName: 기본 "hwpx-table"
- renderImages/renderTables/renderStyles: 기본 true
- embedImages: 기본 false (true 시 `data:` URL로 인라인)
- tableHeaderFirstRow: 기본 false (true 시 첫 행을 `<th>` 처리)
- imageSrcResolver(binPath): 출력용 이미지 경로 커스터마이즈

## 구현 메모

- 구현은 패키지 구조(`Contents/content.hpf`, `Contents/section*.xml`)와 `hp:t` 텍스트 기준 추출에 초점을 맞췄습니다. 자세한 구조: [HWPX 포맷 구조 살펴보기](https://tech.hancom.com/hwpxformat/)
- 암호화 문서는 `META-INF/manifest.xml` 존재로 우선 감지하며, 복호화는 미지원입니다.