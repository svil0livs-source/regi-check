"use client";
// 「검증 기준」「개인정보」 안내 창 (유리 패널). Esc 또는 바깥을 눌러 닫는다.
import { useEffect, useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";

export type InfoTopic = "rules" | "privacy";

const CONTENT: Record<InfoTopic, { title: string; items: string[] }> = {
  rules: {
    title: "검증 기준",
    items: [
      "등기부등본이 정답입니다. 한글 신청서 값이 다르면 불일치입니다.",
      "대조 항목: 당사자(근저당권자·양수인·채무자·소유자), 부동산(소재·지번·호수·전유 면적), 채권최고액, 접수번호와 등기날짜(원래 근저당권·이전등기 둘 다), 근저당권자·양수인의 등록번호 앞 6자리.",
      "공백·쉼표 차이는 같은 값으로 봅니다. 한자는 인식하지 않고 지운 뒤 비교합니다.",
      "이름은 한 글자, 금액·번호는 한 자리라도 다르면 불일치입니다.",
      "글자가 흐리거나 확신할 수 없으면 「일치」라고 하지 않고 「확인 필요」로 표시합니다.",
      "결과는 「전부 일치」 / 「불일치 있음」 / 「확인 필요」 중 하나이며, 불일치와 확인 필요가 함께 있으면 「불일치 있음」입니다.",
    ],
  },
  privacy: {
    title: "개인정보",
    items: [
      "스캔한 등기부는 이 서버 안에서 글자로 읽으며, 서류를 외부 서비스로 보내지 않습니다.",
      "주민등록번호(법인등록번호)는 앞 6자리만 읽어 대조하고, 뒷자리는 읽지도 저장하지도 않습니다.",
      "읽은 원문은 처리하는 동안에만 쓰고 바로 버리며, 로그에도 남기지 않습니다.",
      "끝난 건의 결과(서류 파일이 아니라 대조 결과만)는 「이전 결과」에서 다시 볼 수 있도록 이 브라우저에만 보관합니다. 서버에는 저장하지 않으며, 「이전 결과」 화면의 「기록 지우기」로 지울 수 있습니다.",
    ],
  },
};

interface Props {
  topic: InfoTopic | null;
  onClose: () => void;
}

export default function InfoModal({ topic, onClose }: Props) {
  const reduce = useReducedMotion();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!topic) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [topic, onClose]);

  return (
    <AnimatePresence>
      {topic && (
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
            aria-label={CONTENT[topic].title}
            className="glass-panel liquid-glass relative w-full max-w-xl rounded-3xl p-7 text-white sm:p-9"
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
            <h2 className="mb-5 font-serif text-3xl font-normal">{CONTENT[topic].title}</h2>
            <ul className="space-y-3 break-keep text-sm leading-relaxed text-white/80">
              {CONTENT[topic].items.map((t) => (
                <li key={t} className="flex gap-3">
                  <span aria-hidden className="mt-2 h-1 w-1 flex-none rounded-full bg-white/60" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
