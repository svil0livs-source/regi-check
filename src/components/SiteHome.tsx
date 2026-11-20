"use client";
// 사이트 첫 화면: 큰 제목 LEGAL VERIFY / 법무정합성 검증시스템, 검증 메뉴로 들어가는 버튼, 오른쪽 아래 유리 카드(검증 메뉴 안내).
// 근이전 검증·비용 검증 두 메뉴로 들어간다 (2026-11-20 사용자 결정). 배치는 근이전 첫 화면(Hero)과 같다.
import ChamferButton from "@/components/ChamferButton";
import GlassCard from "@/components/GlassCard";

/** 사이트 안의 검증 메뉴. 위쪽 메뉴 창과 이 화면 카드가 같은 목록을 쓴다 */
export type ToolId = "regi" | "cost";
export const TOOLS: { id: ToolId; label: string; text: string }[] = [
  { id: "regi", label: "근이전 검증", text: "근저당권 이전등기 신청서류(한글 파일)를 등기부등본 PDF와 항목별로 대조합니다." },
  { id: "cost", label: "비용 검증", text: "법무사 비용 청구서 PDF의 청구금액을 영수증 스캔 PDF의 납부금액과 항목별로 대조합니다." },
];

interface Props {
  /** 검증 메뉴로 들어가기 */
  onOpen: (id: ToolId) => void;
}

export default function SiteHome({ onOpen }: Props) {
  return (
    <section className="hero-bottom">
      <div className="lede">
        {/* 위계: LEGAL VERIFY가 가장 크고, 바로 아래 한글 이름을 조금 작게 (2026-11-20 지시서) */}
        <h1 className="break-keep">
          <span className="site-title">LEGAL VERIFY</span>
          <span className="site-subtitle">법무정합성 검증시스템</span>
        </h1>
        <p className="lede__body break-keep">한 글자도 놓치지 않는 서류 대조. 법무 서류를 원본 서류와 항목별로 대조해 틀린 곳을 찾아 줍니다.</p>

        <div className="mt-6 flex flex-col gap-3 md:mt-8">
          {TOOLS.map((t) => (
            <ChamferButton key={t.id} onClick={() => onOpen(t.id)}>
              {t.label}
            </ChamferButton>
          ))}
        </div>

        {/* 소속·이름 표시 */}
        <p className="lede__credit break-keep max-md:mt-6">한국자산관리공사 서울동부지역본부 유주연 차장</p>
      </div>

      <GlassCard>
        <div className="card__head">
          <h2 className="card__title">검증 메뉴</h2>
          <span className="card__index">{`//0${TOOLS.length}`}</span>
        </div>

        <div className="card__body break-keep">
          {TOOLS.map((t) => (
            <button key={t.id} onClick={() => onOpen(t.id)} className="finding block w-full text-left transition-opacity duration-300 hover:opacity-60">
              <h3 className="finding__title">{t.label}</h3>
              <p className="finding__text">{t.text}</p>
            </button>
          ))}
        </div>

        <svg className="card__wave" viewBox="0 0 220 50" fill="none" aria-hidden="true">
          <path
            d="M0 30 C10 30 12 45 18 45 C24 45 26 10 34 10 C42 10 44 40 52 40 C60 40 62 5 70 5 C78 5 80 42 88 42 C96 42 98 15 106 15 C114 15 116 38 124 38 C132 38 134 20 142 20 C150 20 152 35 160 35 C168 35 170 22 178 22 C186 22 188 32 196 32 C204 32 210 28 220 28"
            stroke="black"
            strokeWidth="1.8"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      </GlassCard>
    </section>
  );
}
