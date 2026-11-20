"use client";
// 비용 청구 검증(엑셀 청구서 ↔ PDF 영수증) 메뉴 자리. 실제 양식 샘플을 받은 뒤 만든다 (2026-11-20, 메뉴만 먼저 만듦).
import ChamferButton from "@/components/ChamferButton";

interface Props {
  onHome: () => void;
}

export default function CostPending({ onHome }: Props) {
  return (
    <section className="hero-bottom">
      <div className="lede">
        <h1 className="lede__title break-keep">
          비용 청구 검증
        </h1>
        <p className="lede__body break-keep">법무사 비용 청구서(엑셀)의 금액을 첨부 영수증(PDF)과 대조합니다. 지금은 준비 중입니다.</p>

        <ChamferButton onClick={onHome} className="mt-6 md:mt-8">
          처음 화면으로
        </ChamferButton>

        <p className="lede__credit break-keep max-md:mt-6">한국자산관리공사 서울동부지역본부 유주연 차장</p>
      </div>
    </section>
  );
}
