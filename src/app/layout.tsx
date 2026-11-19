import type { Metadata, Viewport } from "next";
import { Noto_Sans_KR } from "next/font/google";
import "./globals.css";

// 한글·영문·숫자 모두 이 글꼴 하나로 그린다. 빌드할 때 사이트 안에 담겨 외부 글꼴 사이트에 기대지 않는다
// (디자인 문서의 Helvetica Neue Light는 외부 사이트에서 불러와야 해서 뺐다, 2026-11-15 사용자 결정).
// 글자 수가 많아 미리 불러오지 않고 쓸 때 조각으로 받는다.
// 굵기를 하나씩 나눠 적으면 일부 글자만 굵게 나오는 일이 있어, 굵기 전체를 한 벌(가변 글꼴)로 받는다 (2026-11-13).
const notoSansKr = Noto_Sans_KR({ variable: "--font-noto-sans-kr", subsets: ["latin"], preload: false });

export const metadata: Metadata = {
  title: "LEGAL VERIFY · 법무정합성 검증시스템",
  description: "근저당권 이전등기 신청서(한글)와 등기부등본을 항목별로 대조합니다.",
};

export const viewport: Viewport = { themeColor: "#c2ccd3" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className={`${notoSansKr.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
