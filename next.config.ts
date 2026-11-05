import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // Tesseract(글자 읽기)는 작업 스레드·wasm 파일을 직접 불러오므로 번들하지 않고 Node.js require로 쓴다
  serverExternalPackages: ["tesseract.js"],
  // 배포 시 한국어 학습 데이터와 엔진 파일이 서버 기능에 함께 들어가도록 지정
  outputFileTracingIncludes: {
    "/api/verify": [
      "./node_modules/@tesseract.js-data/kor/4.0.0_best_int/**/*",
      "./node_modules/tesseract.js/src/worker-script/**/*",
      "./node_modules/tesseract.js-core/**/*",
    ],
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
