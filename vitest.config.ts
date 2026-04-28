import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // 테스트는 src 의 .ts 를 직접 import 한다 (build 결과가 아닌). vitest 가 ts 변환 처리.
    pool: "threads",
  },
});
