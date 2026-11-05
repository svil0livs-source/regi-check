import type { Metadata, Viewport } from "next";
import { Inter, Instrument_Serif, Noto_Serif_KR } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], weight: ["300", "400", "500", "600"] });
const instrument = Instrument_Serif({ variable: "--font-instrument", subsets: ["latin"], weight: "400", style: ["normal", "italic"] });
// 한글 제목용 (Instrument Serif에 한글이 없다). 글자 수가 많아 미리 불러오지 않고 쓸 때 조각으로 받는다.
const notoSerifKr = Noto_Serif_KR({ variable: "--font-noto-serif-kr", subsets: ["latin"], weight: ["300", "400"], preload: false });

export const metadata: Metadata = {
  title: "근이전 서류 검증기",
  description: "근저당권 이전등기 신청서(한글)와 등기부등본을 항목별로 대조합니다.",
};

export const viewport: Viewport = { themeColor: "#000000" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className={`${inter.variable} ${instrument.variable} ${notoSerifKr.variable} h-full antialiased`}>
      <body className="min-h-full bg-black text-white">{children}</body>
    </html>
  );
}
