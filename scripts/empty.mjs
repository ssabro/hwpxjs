// Browser-safe stub for Node-only modules (fs, path).
// cfb 패키지가 require('fs') 등을 시도해도 빈 객체를 받아 fallback 경로로 동작.
export default {};
export const readFileSync = () => { throw new Error("fs not available in browser"); };
export const writeFileSync = () => { throw new Error("fs not available in browser"); };
