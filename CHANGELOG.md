# Changelog

## 0.4.0

Markdown / HTML 양방향 변환과 BorderFill 풀 보존을 추가한 릴리스. 0.3.0 대비 사용 시나리오가 크게 확장됐고 새 의존성(`marked`, `htmlparser2`)이 추가됐기 때문에 minor 버전 bump.

### Markdown / HTML 양방향 변환

- **HWP/HWPX → Markdown** (`hwpToMarkdown`, `HwpxReader.extractMarkdown`):
  - 본문/표/이미지/굵게/기울임 보존
  - 표는 마크다운 테이블 (병합 셀은 평탄화)
  - 이미지 `![](BinData/imageN.ext)` 또는 `embedImages: true` 시 base64 data URI
- **Markdown → HWPX** (`markdownToHwpx`):
  - `marked` lexer 토큰 트리 → HwpDocument IR → hwpxBuilder
  - 헤딩 1~6 (큰 사이즈 + 굵게), 인라인 `**bold**`/`*em*`/`` `code` ``, 리스트(ordered/unordered), blockquote, 표, 이미지(data URI 만 보존), 코드 블록(모노스페이스)
- **HTML → HWPX** (`htmlToHwpx`):
  - `htmlparser2` SAX → DOM 트리 → IR → hwpxBuilder
  - p/h1~6/strong/em/b/i/code/pre/ul/ol/li/blockquote/table(rowspan,colspan)/img(data URI)/br/hr 처리
  - script/style/head 무시, HTML 엔티티 디코딩
- **CLI 신규 명령**: `md` / `hwp:md` / `md:hwpx` / `html:hwpx`

### BorderFill 실 데이터 보존

- 4면 테두리(line type/width/color), 대각선 슬래시 방향(attr 비트필드), 단색 채우기(`<hh:fillBrush><hh:winBrush>`) 모두 HWPX 로 옮김
- 너비 인덱스 → mm 매핑 (HWP 5.0 스펙 16종)
- 라인 종류 18종 (NONE/SOLID/DASH/DOT/DOUBLE/THIN_THICK_DOUBLE/THICK_3D 등)
- `attr` 비트 2~4 = slash, 5~7 = backSlash 방향 정확히 디코딩

### 머리말/꼬리말/각주 인라인 출력

- 본문 흐름에 paragraph 형태로 평탄 출력해서 텍스트 가시화 (master page 매핑은 향후)

### 변경

- `HwpBorderFill` 타입 확장: `borders` (4면), `diagonal`, `fill` 추가
- `HwpDiagonalLine`, `HwpBorderLine`, `HwpSolidFill` 신규 타입
- `HwpxReader.parseXml` 가 `trimValues: false` — run 사이 공백 보존
- 의존성 추가: `marked` (Markdown 파서), `htmlparser2` (HTML SAX 파서)
- 브라우저 번들 크기: 540KB → 733KB (marked + htmlparser2 인라인)

### 테스트

- 신규 `test/markdownHtml.test.ts` — 15 개 (MD/HTML → HWPX, MD writer)
- 전체: **85 tests / 9 files**

## 0.3.0

HWP 5.0 바이너리 포맷 지원과 풀 충실도 HWPX 변환을 추가한 대규모 업데이트.

### 추가된 기능

#### HWP 5.0 바이너리 파서

- CFB(OLE2) 컨테이너 리더 (`cfb` 의존, raw deflate 는 `pako`)
- `FileHeader` (시그니처/버전/11종 플래그)
- `DocInfo`: 7개 언어 그룹별 폰트(`FACE_NAME`), `CHAR_SHAPE`, `PARA_SHAPE`, `STYLE`, `BORDER_FILL`, `NUMBERING`, `BULLET`, `TAB_DEF`, `BIN_DATA` 레코드
- `BodyText`: `PARA_HEADER` / `PARA_TEXT` / `PARA_CHAR_SHAPE` 텍스트 + run 분할
- 표/도형 안의 nested `PARA_HEADER`(level≥2)도 본문 문단으로 평탄 추출
- 컨트롤 문자 (탭/줄끝/문단끝/NBSP/하이픈/figure space) 처리
- 인라인 컨트롤: 표 (rowSpan/colSpan + 셀 문단 재귀), 그림(GSO+SHAPE_PICTURE, `binDataId` 추출), 머리말/꼬리말/각주, 필드, 도형(SHAPE_LINE 좌표 보존, 사각형/타원/호/다각형/곡선은 종류만), 수식(EQEDIT 스크립트 UTF-16 추출)
- 임베디드 BinData 추출 (이미지/OLE storage prefix 보정)

#### 공개 API

- `parseHwp(bytes): HwpDocument` — IR 직접 접근
- `hwpToText(bytes, options?): string` — 평문 추출
- `hwpToHwpx(bytes, options?): Uint8Array` — HWPX 변환
- `detectFormat(bytes)` — `"hwp" | "hwpx" | "hwp3" | "unknown"`
- 에러: `HwpEncryptedError`, `HwpUnsupportedError`, `HwpInvalidFormatError`

#### CLI

- `hwpxjs hwp:txt <file.hwp>` — HWP 평문 출력
- `hwpxjs convert:hwp <file.hwp> <out.hwpx>` — HWP → HWPX
- `hwpxjs txt` 가 입력 확장자 보고 자동 라우팅 (`.hwp` 는 바이너리 파서)
- 기존: `inspect`, `txt`, `html`, `html:tpl`, `batch`, `batch:tpl`, `write:txt`

#### HWPX 변환 충실도 (HWP → HWPX)

- 표 → `<hp:tbl>` `<hp:tr>` `<hp:tc>` `<hp:subList>` (rowSpan/colSpan 보존)
- 이미지 → `BinData/imageN.{ext}` 패키징 + 매니페스트 등록 + `<hp:pic>` + `<hc:img binaryItemIDRef>` 인라인
- 다중 섹션 출력
- `header.xml refList` 풀 출력:
  - `<hh:fontfaces>` 7 언어 그룹별 — 실제 사용 폰트(굴림/맑은 고딕/한컴 솔잎 B/함초롬돋움/휴먼명조 등) 정확히 보존
  - `<hh:charProperties>` charShape 별 fontRef·textColor·shadeColor·height + bold/italic/underline/strikeout 요소
  - `<hh:paraProperties>` paraShape 별 정렬(LEFT/RIGHT/CENTER/JUSTIFY/DISTRIBUTE) + margin + lineSpacing
  - `<hh:styles>` 정의 + `paraPrIDRef`/`charPrIDRef`
  - `<hh:borderFills>` / `<hh:numberings>` / `<hh:bullets>` / `<hh:tabPrs>` 카운트만큼 슬롯 출력 → paraShape 의 참조가 더 이상 dangle 하지 않음
  - 번호 매기기 수준별 형식 문자열 (`^1.`, `^1)`) 보존
  - 글머리표 문자(●/○/■ …) 보존
- section.xml 의 paragraph/run 이 실제 `paraShapeId`/`styleId`/`charShapeId` 를 참조 (이전엔 모두 0)
- 색상 변환: HWP `0xAABBGGRR` → CSS `#RRGGBB` (`colorBgrToHex`)
- `Preview/PrvText.txt` 자동 생성 (한컴 호환 형식, 표 셀은 `<셀텍스트 >` 패턴) — 다른 HWP 뷰어/탐색기에서 썸네일/미리보기 지원

#### HwpxReader / HwpxWriter 개선

- `HwpxWriter.createFromPlainText` 가 OWPML 패키지 규칙을 따르는 spec 호환 .hwpx 를 생성:
  - mimetype 첫 STORED 엔트리, 정확히 `application/owpml`
  - `META-INF/container.xml` + `META-INF/manifest.xml`
  - 적절한 xmlns 선언 (hp/hh/hc/ha/opf/dc)
  - 최소 충실도의 header.xml (charPr/paraPr/style 1세트)
- `HwpxReader.extractText` / `extractHtml` 이 `<hp:p><hp:run><hp:tbl>` 패턴의 paragraph-내장 표를 재귀 탐색 — `<hp:p>` 직속 텍스트가 비어도 셀 안 텍스트를 추출 (이전엔 PrvText 폴백 의존)
- `extractCellText` 가 `<hp:subList>` 안의 paragraph 도 정확히 추출
- `parseTagValue: false` — `<hp:t>1</hp:t>` 의 "1" 같은 숫자형 텍스트가 number 로 자동 변환되는 버그 수정
- 표 셀 rowSpan/colSpan 보존 (변환 → HTML 라운드트립 검증)
- 디버그용 `console.log`/`console.warn` 제거

#### 브라우저 ESM 번들

- `dist/browser/hwpxjs.browser.mjs` (esbuild, 약 540KB)
- 모든 의존성(jszip, cfb, fast-xml-parser, pako) 인라인
- `package.json` `exports.browser` 조건부 경로 + `./browser` 서브패스
- 사용 예: `<script type="module">import { hwpToText } from "@ssabrojs/hwpxjs/browser";</script>` 또는 jsdelivr CDN 직접 로드

#### 테스트 (vitest 도입)

총 59 tests / 7 files. `npm test`, `npm run test:watch` 스크립트.

- 단위 (28 tests): byteReader, record 헤더(비트필드·확장 크기), fileHeader(11종 플래그), format detection, BGR→#RRGGBB
- 통합 (17 tests, 픽스처 자동 탐지): HwpxWriter spec 검증, 1.hwp 표 라운드트립, 여름휴가 안내문.hwp 이미지 BinData 매니페스트, 공고문(안) 셀 병합 + 스타일 정확성
- 견고성 (14 tests): 손상 입력(빈 버퍼/1바이트/잘린 CFB), HWP 3.0 친화적 에러, 미로드 reader, 487KB HWP 파싱 < 5초/변환 < 10초, HTML rowspan 라운드트립, BinData 매니페스트 mime 정확성

### 변경

- `package.json`: description/keywords 갱신, `exports` 의 `browser` 조건 + `./browser` 서브패스 추가
- README 를 실제 공개 API 와 정합화 (아키텍처 개요·브라우저 사용법·rhwp 출처 강화)

### 제거 / 깨진 약속 정리

- `HwpReader` / `HwpConverter` 더미 구현 제거 (하드코딩 샘플 텍스트 반환하던 자리)
- README 의 존재하지 않는 API (`loadFromFile`, `HwpxError`, `processingTime`, `inputPath` 등) 정리

### 검증된 샘플

- `1.hwp` (24KB, 22행×9열 표 + secd/cold/gso) — 표 구조/텍스트 정상
- `여름휴가 안내문.hwp` (487KB, PNG+JPG 이미지 2개) — `BinData/image1.png` + `image2.jpg` 패키징, HTML base64 인라인 OK
- `공고문(안)(26.4.24.).hwp` (80KB, 6×6 셀 병합 표) — 라운드트립: 22 paragraphs / 30 table cells / rowspan 3개(rs=2/3/5) 보존, 숫자 셀("1"~"5") · 영문 차대번호 · 한글 차종 · ☎ 특수문자 모두 정상

### 알려진 제한 (0.3.0 시점)

- 암호화 HWP 미지원 (`HwpEncryptedError`)
- 배포용 ViewText 미지원 (`HwpUnsupportedError`)
- HWP 3.0 미지원
- 머리말/꼬리말/각주는 파싱되나 본문 흐름 안에 출력하지 않음 (별도 master page 매핑은 다음 단계)
- BorderFill 정의는 ID 슬롯만 채움 — 실제 테두리 색/굵기/대각선/그라데이션 미보존
- 번호 매기기 수준별 시작번호는 기본 1
- 차트(CHART_DATA) / OLE / 글맵시 미지원
- 도형은 `line` 좌표만 보존, 사각형/타원/호/다각형/곡선은 종류만

## 0.2.0

- 초기 공개 릴리스 (HWPX 한정)
- 텍스트/HTML 추출, 표/이미지 일부 지원, 템플릿/배치 변환
- CLI: `inspect` / `txt` / `html` / `html:tpl` / `batch` / `batch:tpl` / `write:txt`
