"use client";
// 첫 화면 중앙: 작은 문구 → 큰 세리프 제목 → 유리 알약 버튼(폴더 선택) → 보조 링크.
// 문서의 이메일 신청 자리에는 이 도구의 핵심 동작인 "폴더 올리기"를 둔다.
import { motion, useReducedMotion } from "motion/react";
import { FolderOpen } from "lucide-react";

interface Props {
  dragging: boolean;
  /** 이전에 끝난 결과가 남아 있을 때 건 수 */
  storedCount: number;
  blocking: string | null;
  onPick: () => void;
  onInfo: () => void;
  /** 「이전 결과 보기」 */
  onHistory: () => void;
}

export default function Hero({ dragging, storedCount, blocking, onPick, onInfo, onHistory }: Props) {
  const reduce = useReducedMotion();
  const fade = (delay: number, y = 10) => ({
    initial: reduce ? false : { opacity: 0, y },
    animate: { opacity: 1, y: 0 },
    transition: { delay, duration: 0.7, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] },
  });

  return (
    <section className="relative flex flex-1 flex-col items-center justify-center px-6 pb-16">
      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col items-center justify-center gap-10 text-center sm:gap-12">
        <div className="flex flex-col items-center gap-5">
          <motion.h1
            initial={reduce ? false : { opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
            className="max-w-[900px] break-keep bg-gradient-to-b from-white to-white/70 bg-clip-text font-serif text-4xl font-normal leading-[1.15] text-transparent md:text-6xl md:leading-[1.1]"
          >
            근이전 신청서류 정합성
            <br /> 자동검증 시스템
          </motion.h1>
          <motion.p
            {...fade(0.2)}
            className="break-keep text-sm font-medium tracking-wide text-white/80 [text-shadow:0_1px_14px_rgba(0,0,0,0.75)]"
          >
            한 글자도 놓치지 않는 서류 대조
          </motion.p>
        </div>

        <motion.div {...fade(0.4)} className="flex flex-col items-center gap-6">
          <button
            onClick={onPick}
            className={`glass-pill group flex items-center gap-3 border px-10 py-3 text-sm text-white/90 backdrop-blur transition-colors duration-300 hover:border-white/40 ${
              dragging ? "border-white/70 bg-white/10" : "border-white/10"
            }`}
          >
            <FolderOpen size={16} aria-hidden className="opacity-80" />
            {dragging ? "여기에 놓으세요" : "폴더 선택"}
          </button>

          <p className="max-w-md break-keep text-xs leading-relaxed text-white/75 [text-shadow:0_1px_14px_rgba(0,0,0,0.75)]">
            한글 파일과 등기부등본 PDF가 든 폴더를 끌어다 놓아도 됩니다. 한 폴더에 여러 건이면 파일 이름의 같은 값(예: 채무자 이름)으로 짝짓습니다.
            <br className="hidden sm:block" /> 한 번에 30건(한글 파일 30개)까지. 파일 크기 제한은 없습니다.
          </p>

          <button
            onClick={onInfo}
            className="rounded text-[13px] font-medium tracking-wide text-white/80 transition-opacity duration-300 hover:opacity-70 [text-shadow:0_1px_14px_rgba(0,0,0,0.75)]"
          >
            검증 기준 보기
          </button>
        </motion.div>

        {storedCount > 0 && (
          <motion.div {...fade(0.6, 6)} className="glass-pill flex max-w-md flex-col items-center gap-1.5 px-5 py-3 text-xs text-white/80">
            <p className="break-keep text-center">
              이전에 끝난 결과 {storedCount}건이 남아 있습니다. 같은 폴더를 다시 고르면 끝난 건은 건너뛰고 이어서 처리합니다.
            </p>
            <button onClick={onHistory} className="rounded text-[13px] font-medium text-violet-200 hover:text-white hover:underline">
              이전 결과 보기
            </button>
          </motion.div>
        )}
        {blocking && (
          <p role="alert" className="glass-pill max-w-md border border-red-300/30 px-5 py-2.5 text-xs text-red-200">
            {blocking}
          </p>
        )}
      </div>

      {/* 소속·이름 표시 (첫 화면 맨 아래) */}
      <motion.p
        {...fade(0.8, 0)}
        className="absolute bottom-7 left-0 right-0 break-keep px-6 text-center font-[family-name:var(--font-gowun-batang)] text-[15px] tracking-[0.06em] text-white/80 sm:text-lg [text-shadow:0_1px_14px_rgba(0,0,0,0.75)]"
      >
        한국자산관리공사 서울동부지역본부 유주연 차장
      </motion.p>
    </section>
  );
}
