import type { Metadata, Viewport } from "next";
import { Noto_Sans_KR } from "next/font/google";
import "./globals.css";

// 한글용 (디자인 문서의 Helvetica Neue Light에는 한글이 없다). 글자 수가 많아 미리 불러오지 않고 쓸 때 조각으로 받는다.
const notoSansKr = Noto_Sans_KR({ variable: "--font-noto-sans-kr", subsets: ["latin"], weight: ["300", "400", "500", "600"], preload: false });

export const metadata: Metadata = {
  title: "근이전 신청서류 정합성 자동검증 시스템",
  description: "근저당권 이전등기 신청서(한글)와 등기부등본을 항목별로 대조합니다.",
};

export const viewport: Viewport = { themeColor: "#c2ccd3" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className={`${notoSansKr.variable} h-full antialiased`}>
      <head>
        {/* 영문·숫자 글꼴: 디자인 문서(2026-11-13)가 정한 Helvetica Neue Light */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href="https://db.onlinewebfonts.com/c/0e6de1ec911a2e267ff136bbdd384a44?family=Helvetica+Neue+Light" />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
