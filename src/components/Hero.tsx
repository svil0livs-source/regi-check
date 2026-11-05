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
}

export default function Hero({ dragging, storedCount, blocking, onPick, onInfo }: Props) {
  const reduce = useReducedMotion();
  const fade = (delay: number, y = 10) => ({
    initial: reduce ? false : { opacity: 0, y },
    animate: { opacity: 1, y: 0 },
    transition: { delay, duration: 0.7, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] },
  });

  return (
    <section className="relative flex flex-1 flex-col items-center justify-center px-6 pb-16">
      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col items-center justify-center gap-10 text-center sm:gap-12">
        <motion.p
          {...fade(0.1)}
          className="text-[11px] font-medium uppercase tracking-[0.2em] text-white/80 sm:text-[10px] [text-shadow:0_1px_14px_rgba(0,0,0,0.75)]"
        >
          근저당권 이전등기 · 서류 자동 대조
        </motion.p>

        <motion.h1
          initial={reduce ? false : { opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
          className="max-w-[900px] break-keep bg-gradient-to-b from-white to-white/70 bg-clip-text font-serif text-4xl font-normal leading-[1.15] text-transparent md:text-6xl md:leading-[1.1]"
        >
          한 글자도 놓치지 않는
          <br className="hidden md:block" /> 서류 대조
        </motion.h1>

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
            건별 폴더(한글 .hwp 1개 + 등기부등본 PDF 1개)를 끌어다 놓아도 됩니다.
            <br className="hidden sm:block" /> 한 번에 30건까지, 파일은 20MB 이하.
          </p>

          <button
            onClick={onInfo}
            className="rounded text-[13px] font-medium tracking-wide text-white/80 transition-opacity duration-300 hover:opacity-70 [text-shadow:0_1px_14px_rgba(0,0,0,0.75)]"
          >
            검증 기준 보기
          </button>
        </motion.div>

        {storedCount > 0 && (
          <motion.p {...fade(0.6, 6)} className="glass-pill max-w-md break-keep px-5 py-2.5 text-xs text-white/80">
            이전에 끝난 결과 {storedCount}건이 남아 있습니다. 같은 폴더를 다시 고르면 끝난 건은 건너뛰고 이어서 처리합니다.
          </motion.p>
        )}
        {blocking && (
          <p role="alert" className="glass-pill max-w-md border border-red-300/30 px-5 py-2.5 text-xs text-red-200">
            {blocking}
          </p>
        )}
      </div>
    </section>
  );
}
