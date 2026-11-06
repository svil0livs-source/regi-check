"use client";
// 「폴더 선택」을 누르면 뜨는 업로드 창: 폴더를 끌어다 놓는 자리 + 「폴더 찾아보기」 버튼. Esc 또는 바깥을 눌러 닫는다.
// 실제로 파일을 받는 일은 Verifier(화면 전체의 끌어다 놓기와 숨은 폴더 입력)가 하고, 이 창은 안내와 버튼만 맡는다.
import { useEffect, useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { FolderOpen, X } from "lucide-react";

interface Props {
  open: boolean;
  /** 폴더를 끌고 와서 화면 위에 있는 중 */
  dragging: boolean;
  onClose: () => void;
  /** 「폴더 찾아보기」: 컴퓨터의 폴더 선택 창을 연다 */
  onBrowse: () => void;
}

export default function UploadModal({ open, dragging, onClose, onBrowse }: Props) {
  const reduce = useReducedMotion();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          onClick={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="폴더 올리기"
            className="glass-panel liquid-glass relative w-full max-w-2xl rounded-3xl p-6 text-white sm:p-9"
            initial={reduce ? false : { opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.97 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              ref={closeRef}
              onClick={onClose}
              aria-label="닫기"
              className="absolute right-5 top-5 rounded-full p-1.5 text-white/70 transition-colors hover:text-white"
            >
              <X size={20} />
            </button>
            <h2 className="mb-1 font-serif text-3xl font-normal">폴더 올리기</h2>
            <p className="mb-6 break-keep text-sm text-white/70">한글 파일과 등기부등본 PDF가 든 폴더를 여러 개 한꺼번에 올릴 수 있습니다. 한 폴더에 여러 건이면 파일 이름의 같은 값(예: 채무자 이름)으로 한글 파일과 PDF를 짝짓습니다.</p>

            <div
              className={`flex flex-col items-center justify-center gap-5 rounded-2xl border-2 border-dashed px-6 py-14 text-center transition-colors duration-200 ${
                dragging ? "border-white/80 bg-white/15" : "border-white/30 bg-white/5"
              }`}
            >
              <FolderOpen size={40} aria-hidden className="text-white/80" />
              <p className="break-keep font-serif text-2xl">{dragging ? "여기에 놓으세요" : "여기에 폴더를 끌어다 놓으세요"}</p>
              <p className="text-xs text-white/60">또는</p>
              <button
                onClick={onBrowse}
                className="glass-pill border border-white/20 px-8 py-2.5 text-sm text-white/90 transition-colors duration-300 hover:border-white/50"
              >
                폴더 찾아보기
              </button>
            </div>

            <p className="mt-5 break-keep text-center text-xs text-white/60">한 번에 30건(한글 파일 30개)까지, 파일 하나 6000KB 이하.</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
