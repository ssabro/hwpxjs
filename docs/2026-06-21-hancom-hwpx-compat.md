# HWPX writer 한컴 호환성 패치 + 로컬 이미지 임베드

작성: shyang · 2026-06-21

## 배경 / 문제

`markdownToHwpx` / `htmlToHwpx` / `HwpxWriter` 로 생성한 `.hwpx` 가 **한컴오피스(한글)에서 열리지 않았다.** 라이브러리 자체 `HwpxReader` round-trip 테스트는 통과했지만(관대한 파서), 실제 한글에서는 두 가지 증상이 났다.

1. **ZIP 바이트가 본문에 평문으로 노출** — 한글이 HWPX 로 인식조차 못 함.
2. mimetype 만 고치면 **"파일이 손상되었습니다"** — 패키지는 인식하나 내부 OWPML 을 파싱 실패.

## 근본 원인 (실제 한글에서 재현·확정)

| # | 원인 | 위치 |
| --- | --- | --- |
| 1 | mimetype 값이 `application/owpml` (표준은 `application/hwp+zip`). 한글은 ZIP offset 38 의 매직 문자열로 HWPX 를 감지하므로 불일치 시 평문 폴백. | `hwpxBuilder.ts`, `writer.ts` |
| 2 | **OWPML 속성에 네임스페이스 prefix 부착** (`<hh:charPr hh:id=…>`). 표준은 요소만 prefix, **속성은 prefix 없음**(`<hh:charPr id=…>`). 한글이 속성 인식 실패 → 필수 속성 누락. | 전역 |
| 3 | 첫 문단 `<hp:secPr>`(페이지 설정) 미생성 — 한글이 섹션 구성에 필요. | `hwpxBuilder.ts`, `writer.ts` |

부수 정합: head 루트 풀 네임스페이스 + `version`/`secCnt`, 폰트 `name`→`face`, `tabPrs`→`tabProperties`, `<hp:p>` 고유 `id`, spine 에 `header` itemref, 표 셀 구조(`cellAddr`/`cellSpan`/`cellSz` + `sz`/`pos`).

## 변경 사항

- **공통 헬퍼** `src/lib/hwp/owpml.ts` 신설 — mimetype 상수, 풀 네임스페이스, `DEFAULT_LINESEG`, `SEC_PR_XML`, `makeParaId`, `escapeXml`. writer/builder 중복 제거.
- **`hwpxBuilder.ts`** — 위 근본 원인 1·2·3 + 부수 정합 전부 적용. 표는 한컴 구조(`<hp:cellAddr>`/`<hp:cellSpan>`/`<hp:cellSz>` + `<hp:sz>`/`<hp:pos>`)로, 이미지는 풀 `<hp:pic>`(orgSz/curSz/renderingInfo/imgRect/sz/pos)로.
- **`writer.ts`** (평문 경로) — 동일 컨벤션, 공통 헬퍼 재사용, borderFill/numbering/tabProperties 보강.
- **`htmlReader.ts`** — HTML 병합표 좌표를 **점유 그리드(occupancy grid)** 로 계산 (rowspan/colspan 점유 칸 반영, `colAddr`/`rowAddr` 정확화).
- **`hwpxReader.ts`** — `application/hwp+zip` mimetype 허용; 표 span 을 **구형(속성 `@colSpan`) + 신형(자식 `<hp:cellSpan>`) 모두** 읽도록 보강(회귀 방지).
- **`errors.ts`** — 에러 메시지 mimetype 문구 갱신.

## 로컬 이미지 임베드 (부가기능)

`data:` URI 외에 `file://`·로컬/상대 경로 이미지를 임베드하는 `imageResolver` 옵션 도입.

- **코어**(`mdReader`/`htmlReader`/`index`)는 resolver 를 주입받기만 함 → 브라우저 번들 무영향(Node API import 없음).
- **CLI**(`cli.ts`)는 fs 기반 resolver 를 자동 주입 → `md:hwpx`/`html:hwpx` 에서 로컬 이미지 자동 임베드.
- `data:` URI 는 resolver 없이도 항상 동작(브라우저 포함).

```ts
import { markdownToHwpx } from "@ssabrojs/hwpxjs";
import { readFileSync } from "node:fs";

await markdownToHwpx(md, {
  imageResolver: (src) => {
    if (/^data:|^https?:/.test(src)) return null;
    return { data: new Uint8Array(readFileSync(src)), extension: "png" };
  },
});
```

이로써 브라우저(data URI) + Node(로컬 파일) 양쪽 이미지를 모두 지원한다.

## 검증

- **단위/통합/정합 테스트 109개 전부 통과** — 신규 `owpml-compat`(한컴 컨벤션), `e2e`(md / md→html 두 경로), `image-resolver` 포함. 기존 round-trip 은 reader 의 `removeNSPrefix` 덕에 유지, prefix 가정 어설션은 신 컨벤션으로 갱신.
- **실제 한글(hwp MCP) 검증**:
  - 텍스트 문서 — 정상 열림(이전: ZIP 평문)
  - 표(단순 3×4, 병합 rowspan) — `get_tables` 로 구조 확인
  - 이미지 문서(data URI / 로컬 파일) — 정상 열림(이전: 크래시)

## 한계 / 후속

- 다중 섹션(HWP→HWPX) 의 섹션별 페이지설정 보존은 범위 밖(현재 secPr 상수 복제로 "열림"만 보장). `HwpSection` IR 확장이 후속 과제.
- 이미지 표시 크기는 고정값(40000×30000 HWPUNIT) — 원본 픽셀 비율 보존은 PNG/JPG 헤더 파싱 후속.
- 테스트 픽스처(`etc/`)는 비커밋(.gitignore) — `it.runIf` 로 픽스처 없는 환경에선 skip.
