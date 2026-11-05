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
      // 작업 스레드가 불러오는 파일은 자동으로 따라가지 못해서 tesseract.js 전체와 그 의존 패키지를 직접 지정한다
      "./node_modules/tesseract.js/**/*",
      "./node_modules/tesseract.js-core/**/*",
      "./node_modules/{bmp-js,zlibjs,regenerator-runtime,wasm-feature-detect,is-url,idb-keyval,node-fetch,whatwg-url,tr46,webidl-conversions}/**/*",
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
