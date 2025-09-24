# hwpxjs

HWPX(OWPML) 문서 파싱과 텍스트/메타데이터 추출을 위한 TypeScript 라이브러리.
HWP 파일 변환 기능도 지원합니다.

- HWPX는 ZIP 패키지 내부에 XML로 문서가 저장되는 개방형 포맷입니다. (참고: [HWPX 포맷 구조 살펴보기](https://tech.hancom.com/hwpxformat/))

주요 기능
- **HWPX 파싱**: ZIP+XML 파싱, 섹션/문단 텍스트 추출, HTML 변환
- **HWP 변환**: HWP 파일을 HWPX로 변환 (순수 TypeScript 구현)
- **스타일 지원**: 표/이미지/스타일(굵게/기울임/밑줄/색상/크기) 처리
- **템플릿 처리**: 템플릿 치환(`{{key}}`) 및 폴더 일괄 변환
- **문서 생성**: 평문 텍스트 → .hwpx 생성
- **브라우저 지원**: 드래그&드롭 뷰어 제공

## 설치

의존성 설치 전, 먼저 승인해 주세요.

```bash
pnpm add @ssabrojs/hwpxjs
```

## 라이브러리 사용법

### 기본 HWPX 파일 처리

```ts
import HwpxReader from "@ssabrojs/hwpxjs";

// 파일에서 HWPX 읽기
const reader = new HwpxReader();
await reader.loadFromFile("./document.hwpx");

// 또는 ArrayBuffer에서 읽기
const buffer = await fetch("/document.hwpx").then(r => r.arrayBuffer());
await reader.loadFromArrayBuffer(buffer);

// 문서 정보 확인
const info = await reader.getDocumentInfo();
console.log(info);
// {
//   title: "문서 제목",
//   creator: "작성자",
//   subject: "주제",
//   description: "설명",
//   publisher: "발행처",
//   contributor: "기여자",
//   date: "2024-01-01",
//   type: "문서",
//   format: "application/hwpx",
//   identifier: "document-id",
//   source: "출처",
//   language: "ko",
//   relation: "관련",
//   coverage: "범위",
//   rights: "권한"
// }

// 텍스트 추출
const text = await reader.extractText();
console.log(text); // "문서의 모든 텍스트 내용..."

// 이미지 목록 확인
const images = await reader.listImages();
console.log(images);
// [
//   { binPath: "BinData/0.jpg", width: 200, height: 150, format: "jpg" },
//   { binPath: "BinData/1.png", width: 300, height: 200, format: "png" }
// ]
```

### HTML 변환 (고급 옵션)

```ts
// 기본 HTML 변환
const basicHtml = await reader.extractHtml();

// 모든 옵션을 포함한 HTML 변환
const fullHtml = await reader.extractHtml({
  // 문단 태그 설정
  paragraphTag: "p",

  // 테이블 CSS 클래스
  tableClassName: "hwpx-table",

  // 렌더링 옵션
  renderImages: true,       // 이미지 포함
  renderTables: true,       // 테이블 포함
  renderStyles: true,       // 스타일 적용 (굵게, 기울임, 색상 등)

  // 이미지 처리
  embedImages: true,        // Base64로 이미지 임베드
  imageSrcResolver: (binPath) => {
    // 커스텀 이미지 경로 생성
    return `/static/images/${binPath.replace('BinData/', '')}`;
  },

  // 테이블 헤더 처리
  tableHeaderFirstRow: true // 첫 번째 행을 <th>로 처리
});

console.log(fullHtml);
// <!DOCTYPE html>
// <html><head><style>.hwpx-table { border-collapse: collapse; }</style></head>
// <body><p>문서 내용...</p><img src="data:image/jpeg;base64,..." /></body></html>
```

### HWP 파일 변환 (순수 TypeScript)

```ts
import { HwpConverter } from "@ssabrojs/hwpxjs";

// 변환기 초기화
const converter = new HwpConverter({
  verbose: true  // 변환 과정 로그 출력
});

// HWP 변환 가능 여부 확인
if (converter.isAvailable()) {
  console.log("HWP 변환 기능 사용 가능");
}

// HWP → HWPX 변환
const result = await converter.convertHwpToHwpx("input.hwp", "output.hwpx");
if (result.success) {
  console.log(`변환 성공: ${result.inputPath} → ${result.outputPath}`);
  console.log(`처리 시간: ${result.processingTime}ms`);
} else {
  console.error(`변환 실패: ${result.error}`);
}

// HWP에서 텍스트만 추출
try {
  const hwpText = await converter.convertHwpToText("input.hwp");
  console.log("HWP 텍스트 내용:", hwpText);
} catch (error) {
  console.error("HWP 텍스트 추출 실패:", error.message);
}
```

### 문서 생성 (HwpxWriter)

```ts
import { HwpxWriter } from "@ssabrojs/hwpxjs";

// 평문 텍스트로 HWPX 생성
const writer = new HwpxWriter();
const textContent = `첫 번째 문단입니다.

두 번째 문단입니다.
여러 줄로 구성된 내용도 가능합니다.`;

await writer.createFromText(textContent, "output.hwpx");
console.log("HWPX 파일이 생성되었습니다.");
```

### 오류 처리 및 예외 상황

```ts
import HwpxReader, { HwpxError, HwpConverter } from "@ssabrojs/hwpxjs";

try {
  const reader = new HwpxReader();
  await reader.loadFromFile("document.hwpx");

  const text = await reader.extractText();
  console.log(text);

} catch (error) {
  if (error instanceof HwpxError) {
    switch (error.code) {
      case 'FILE_NOT_FOUND':
        console.error("파일을 찾을 수 없습니다:", error.message);
        break;
      case 'INVALID_FORMAT':
        console.error("유효하지 않은 HWPX 형식입니다:", error.message);
        break;
      case 'PARSING_ERROR':
        console.error("파싱 중 오류가 발생했습니다:", error.message);
        break;
      default:
        console.error("알 수 없는 오류:", error.message);
    }
  } else {
    console.error("시스템 오류:", error.message);
  }
}

// HWP 변환 오류 처리
const converter = new HwpConverter();
const result = await converter.convertHwpToHwpx("input.hwp", "output.hwpx");

if (!result.success) {
  console.error(`변환 실패: ${result.error}`);
  console.error(`입력 파일: ${result.inputPath}`);
  console.error(`출력 파일: ${result.outputPath}`);
}
```

### 고급 사용 시나리오

```ts
// 배치 처리: 여러 파일 일괄 변환
import fs from 'fs/promises';
import path from 'path';

async function batchConvertHwpx(inputDir: string, outputDir: string) {
  const files = await fs.readdir(inputDir);
  const hwpxFiles = files.filter(file => file.endsWith('.hwpx'));

  for (const file of hwpxFiles) {
    try {
      const reader = new HwpxReader();
      await reader.loadFromFile(path.join(inputDir, file));

      const html = await reader.extractHtml({
        renderImages: true,
        embedImages: true,
        renderStyles: true
      });

      const outputFile = path.join(outputDir, file.replace('.hwpx', '.html'));
      await fs.writeFile(outputFile, html, 'utf8');

      console.log(`변환 완료: ${file} → ${path.basename(outputFile)}`);
    } catch (error) {
      console.error(`변환 실패 (${file}):`, error.message);
    }
  }
}

// 템플릿 치환 처리
async function processTemplate(templatePath: string, data: any, outputPath: string) {
  const reader = new HwpxReader();
  await reader.loadFromFile(templatePath);

  let html = await reader.extractHtml();

  // {{key}} 형식의 템플릿 치환
  Object.keys(data).forEach(key => {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    html = html.replace(regex, data[key]);
  });

  await fs.writeFile(outputPath, html, 'utf8');
}

// 사용 예제
await batchConvertHwpx('./input', './output');
await processTemplate('./template.hwpx', {
  name: '홍길동',
  date: '2024-01-01'
}, './result.html');
```

## CLI 사용법

### 기본 HWPX 명령어

```bash
# 문서 정보 확인
hwpxjs inspect document.hwpx
# 출력:
# Title: 보고서 제목
# Creator: 홍길동
# Date: 2024-01-15
# Format: application/hwpx
# Pages: 5, Sections: 3

# 텍스트 추출 (콘솔 출력)
hwpxjs txt document.hwpx
# 출력: 문서의 모든 텍스트 내용...

# 텍스트를 파일로 저장
hwpxjs txt document.hwpx > extracted.txt

# HTML 변환 (이미지/스타일 포함)
hwpxjs html document.hwpx > output.html

# HTML 변환 후 브라우저에서 바로 열기 (Windows)
hwpxjs html document.hwpx > output.html && start output.html

# 여러 파일 처리
hwpxjs txt *.hwpx  # 현재 폴더의 모든 .hwpx 파일에서 텍스트 추출
```

### HWP 파일 처리 (새로운 기능!)

```bash
# HWP → HWPX 변환
hwpxjs convert:hwp document.hwp converted.hwpx
# 출력: HWP 파일이 HWPX로 변환되었습니다: document.hwp → converted.hwpx

# HWP에서 텍스트만 추출
hwpxjs hwp:txt document.hwp
# 출력: HWP 파일의 텍스트 내용...

# HWP 텍스트를 파일로 저장
hwpxjs hwp:txt document.hwp > hwp_text.txt

# 여러 HWP 파일 일괄 변환
for file in *.hwp; do
  hwpxjs convert:hwp "$file" "${file%.hwp}.hwpx"
done
```

### 문서 생성

```bash
# 평문 텍스트에서 HWPX 생성
hwpxjs write:txt notes.txt output.hwpx
echo "변환 완료: notes.txt → output.hwpx"

# 여러 줄 텍스트로 HWPX 생성
echo -e "첫 번째 줄\n\n두 번째 문단\n세 번째 줄" > content.txt
hwpxjs write:txt content.txt document.hwpx

# 파이프를 통한 텍스트 입력
echo "동적으로 생성된 내용" | hwpxjs write:txt - dynamic.hwpx
```

### 템플릿 처리

```bash
# 템플릿 파일과 JSON 데이터로 HTML 생성
hwpxjs html:tpl template.hwpx data.json > result.html

# data.json 예제:
# {
#   "name": "홍길동",
#   "date": "2024-01-15",
#   "title": "월간 보고서"
# }

# 템플릿에서 {{name}}, {{date}}, {{title}} 등이 치환됨
```

### 일괄 처리

```bash
# 폴더의 모든 HWPX를 HTML로 변환
hwpxjs batch ./input_hwpx ./output_html
# 출력:
# 변환 완료: document1.hwpx → document1.html
# 변환 완료: document2.hwpx → document2.html

# 템플릿 일괄 처리 (각 HWPX마다 대응하는 JSON 파일 필요)
hwpxjs batch:tpl ./templates ./data ./output
# 구조:
# ./templates/report1.hwpx + ./data/report1.json → ./output/report1.html
# ./templates/report2.hwpx + ./data/report2.json → ./output/report2.html

# 디렉토리 구조 예제
mkdir -p input output
cp *.hwpx input/
hwpxjs batch input/ output/
ls output/  # 변환된 HTML 파일들 확인
```

### 고급 CLI 사용 패턴

```bash
# 파이프라인을 통한 연속 처리
find ./documents -name "*.hwpx" -exec hwpxjs txt {} \; > all_text.txt

# 조건부 처리 (오류 발생 시 계속 진행)
for file in *.hwpx; do
  hwpxjs html "$file" > "${file%.hwpx}.html" 2>/dev/null || echo "Failed: $file"
done

# 병렬 처리 (GNU parallel 사용)
parallel hwpxjs txt {} \> {.}.txt ::: *.hwpx

# 메타데이터만 추출해서 CSV로 정리
echo "파일명,제목,작성자,날짜" > metadata.csv
for file in *.hwpx; do
  info=$(hwpxjs inspect "$file" 2>/dev/null)
  echo "$file,$(echo "$info" | grep "Title:" | cut -d: -f2-),$(echo "$info" | grep "Creator:" | cut -d: -f2-),$(echo "$info" | grep "Date:" | cut -d: -f2-)" >> metadata.csv
done

# 큰 파일 처리 시 진행 상황 표시
total=$(ls *.hwpx | wc -l)
current=0
for file in *.hwpx; do
  current=$((current + 1))
  echo "처리 중 ($current/$total): $file"
  hwpxjs html "$file" > "html/${file%.hwpx}.html"
done
```

### 오류 처리 및 디버깅

```bash
# 상세한 오류 메시지 확인
hwpxjs txt problematic.hwpx 2>&1

# 파일 형식 검증
hwpxjs inspect suspicious.hwpx || echo "유효하지 않은 HWPX 파일"

# 변환 가능한 파일만 필터링
for file in *.hwpx; do
  if hwpxjs inspect "$file" >/dev/null 2>&1; then
    echo "처리 가능: $file"
    hwpxjs html "$file" > "output/${file%.hwpx}.html"
  else
    echo "처리 불가: $file"
  fi
done

# 로그 파일 생성
hwpxjs batch input/ output/ 2>&1 | tee conversion.log
```

### 시스템 통합 예제

```bash
# cron으로 정기 변환 (매일 오전 9시)
# crontab -e
# 0 9 * * * cd /path/to/documents && hwpxjs batch ./incoming ./processed >> /var/log/hwpx-convert.log 2>&1

# 웹 서버와 연동 (새 파일 감지 후 자동 변환)
inotifywait -m ./uploads -e create -e moved_to |
  while read path action file; do
    if [[ "$file" == *.hwpx ]]; then
      echo "새 파일 감지: $file"
      hwpxjs html "$path$file" > "./web/html/${file%.hwpx}.html"
      echo "변환 완료: ${file%.hwpx}.html"
    fi
  done

# Git 후크로 자동 문서 변환 (.git/hooks/post-receive)
#!/bin/bash
cd /path/to/repo
if git diff-tree --name-only -r HEAD^ HEAD | grep -q "\.hwpx$"; then
  echo "HWPX 파일 변경 감지, HTML 재생성 중..."
  hwpxjs batch ./docs ./web/html/
  echo "문서 변환 완료"
fi
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