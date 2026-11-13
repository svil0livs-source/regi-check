"use client";
// 첫 화면: 왼쪽 위에 제목·설명·「폴더 선택」 버튼, 오른쪽 아래에 굴절 유리 카드(검증 순서). (디자인 문서, 2026-11-13)
// 좁은 화면에서는 위아래로 쌓는다.
import { FolderOpen } from "lucide-react";
import ChamferButton from "@/components/ChamferButton";
import GlassCard from "@/components/GlassCard";

interface Props {
  dragging: boolean;
  /** 이전에 끝난 결과가 남아 있을 때 건 수 */
  storedCount: number;
  blocking: string | null;
  onPick: () => void;
  /** 「이전 결과 보기」 */
  onHistory: () => void;
}

export default function Hero({ dragging, storedCount, blocking, onPick, onHistory }: Props) {
  return (
    <section className="hero-bottom">
      <div className="lede">
        <h1 className="lede__title break-keep">
          근이전 신청서류 정합성
          <br />
          자동검증 시스템
        </h1>
        <p className="lede__body break-keep">한 글자도 놓치지 않는 서류 대조. 근저당권 이전등기 신청서류를 등기부등본과 항목별로 대조합니다.</p>

        <ChamferButton onClick={onPick} className="mt-6 md:mt-8" icon={dragging ? <FolderOpen size={16} strokeWidth={1.5} aria-hidden className="icon" /> : undefined}>
          {dragging ? "여기에 놓으세요" : "폴더 선택"}
        </ChamferButton>

        {storedCount > 0 && (
          <p className="lede__body break-keep">
            이전에 끝난 결과 {storedCount}건이 남아 있습니다. 같은 폴더를 다시 고르면 끝난 건은 건너뛰고 이어서 처리합니다.{" "}
            <button onClick={onHistory} className="rounded text-black underline underline-offset-4 transition-opacity duration-300 hover:opacity-60">
              이전 결과 보기
            </button>
          </p>
        )}
        {blocking && (
          <p role="alert" className="mt-4 max-w-[280px] break-keep border-l-2 border-red-700 bg-white/60 px-3 py-2 text-xs leading-relaxed text-red-800 backdrop-blur">
            {blocking}
          </p>
        )}

        {/* 소속·이름 표시 */}
        <p className="lede__credit break-keep max-md:mt-6">한국자산관리공사 서울동부지역본부 유주연 차장</p>
      </div>

      <GlassCard>
        <div className="card__head">
          <h2 className="card__title">검증 순서</h2>
          <span className="card__index">{"//02"}</span>
        </div>

        <div className="card__body break-keep">
          <div className="finding">
            <h3 className="finding__title">폴더째 올리기</h3>
            <p className="finding__text">한글 파일과 등기부등본 PDF가 든 폴더를 끌어다 놓습니다. 한 번에 30건까지, 파일 크기 제한은 없습니다.</p>
          </div>
          <div className="finding">
            <h3 className="finding__title">등기부등본이 정답</h3>
            <p className="finding__text">항목마다 글자 그대로 대조하고, 확신할 수 없으면 「확인 필요」로 표시합니다.</p>
          </div>
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
