# NPM 패키지 배포 가이드

이 문서는 `@ssabrojs/hwpxjs` 패키지를 NPM에 배포하는 방법을 설명합니다.

## 1. NPM 계정 준비

```bash
# NPM 계정이 없다면 회원가입
npm adduser

# 이미 계정이 있다면 로그인
npm login

# 로그인 상태 확인
npm whoami
```

## 2. 패키지 설정 확인

현재 `package.json`이 올바르게 구성되어 있습니다:

- ✅ **이름**: `@ssabrojs/hwpxjs` (스코프 패키지)
- ✅ **버전**: `0.1.0`
- ✅ **작성자**: `ssabro <ssabro@gmail.com>`
- ✅ **저장소**: `https://github.com/ssabro/hwpxjs.git`
- ✅ **라이선스**: MIT
- ✅ **공개 설정**: `publishConfig.access: "public"`

## 3. 빌드 및 테스트

```bash
# 프로젝트 빌드
npm run build

# 빌드 결과 확인
ls dist/

# CLI 기능 테스트
node dist/cli.js --help
node dist/cli.js txt test/test1.hwpx
node dist/cli.js html test/test1.hwpx > test1.html
```

## 4. 배포 미리보기

```bash
# 실제로 배포될 파일들 미리보기
npm pack --dry-run

# 로컬 패키지 생성 (테스트용)
npm pack
```

생성된 `.tgz` 파일로 로컬 테스트:

```bash
# 글로벌 설치 테스트
npm install -g ssabrojs-hwpxjs-0.1.0.tgz

# CLI 명령어 테스트
hwpxjs txt test/test1.hwpx
hwpx html test/test1.hwpx
```

## 5. NPM에 배포

### 정식 배포

```bash
npm publish
```

### 베타 버전 배포

```bash
npm publish --tag beta
```

## 6. 배포 후 확인

```bash
# 배포된 패키지 정보 확인
npm view @ssabrojs/hwpxjs

# 다른 환경에서 설치 테스트
npm install -g @ssabrojs/hwpxjs

# 설치 확인
hwpxjs --help
```

## 7. 패키지 사용법

### 글로벌 설치

```bash
npm install -g @ssabrojs/hwpxjs
```

### 프로젝트에 설치

```bash
npm install @ssabrojs/hwpxjs
```

### CLI 사용 예시

```bash
# 텍스트 추출
hwpxjs txt document.hwpx

# HTML 변환 (이미지 포함)
hwpxjs html document.hwpx

# 문서 정보 확인
hwpxjs inspect document.hwpx

# 일괄 처리
hwpxjs batch input_folder output_folder

# 텍스트 파일에서 HWPX 생성
hwpxjs write:txt output.hwpx input.txt
```

### 프로그래밍 API 사용

```javascript
import HwpxReader from '@ssabrojs/hwpxjs';

const reader = new HwpxReader();
await reader.loadFromFile('document.hwpx');

// 텍스트 추출
const text = await reader.extractText();

// HTML 변환 (이미지 임베드)
const html = await reader.extractHtml({ embedImages: true });

// 문서 정보
const info = await reader.getDocumentInfo();
```

## 8. 버전 업데이트

### 패치 버전 (버그 수정)

```bash
npm version patch  # 0.1.0 → 0.1.1
npm publish
```

### 마이너 버전 (새 기능)

```bash
npm version minor  # 0.1.0 → 0.2.0
npm publish
```

### 메이저 버전 (호환성 변경)

```bash
npm version major  # 0.1.0 → 1.0.0
npm publish
```

## 9. 주요 특징

- ✨ **완전한 HWPX 지원**: 텍스트, 이미지, 테이블, 스타일 추출
- 🖼️ **이미지 처리**: Base64 임베딩으로 완전한 HTML 생성
- 📝 **템플릿 지원**: JSON 데이터로 동적 문서 생성
- 🚀 **CLI 도구**: 명령줄에서 바로 사용 가능
- 📦 **TypeScript**: 완전한 타입 지원
- 🔄 **일괄 처리**: 폴더 단위 변환 지원

## 10. 문제 해결

### 권한 오류

```bash
# NPM 로그인 다시 시도
npm logout
npm login
```

### 패키지 이름 충돌

- 스코프 패키지(`@ssabrojs/hwpxjs`)이므로 일반적으로 충돌하지 않음
- 필요시 다른 스코프나 이름으로 변경

### 빌드 오류

```bash
# 클린 빌드
npm run clean
npm run build
```

## 11. 관련 링크

- **GitHub 저장소**: https://github.com/ssabro/hwpxjs
- **NPM 패키지**: https://www.npmjs.com/package/@ssabrojs/hwpxjs (배포 후)
- **이슈 트래커**: https://github.com/ssabro/hwpxjs/issues
- **HWPX 포맷 문서**: https://tech.hancom.com/hwpxformat/