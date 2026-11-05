"use client";
// 떠 있는 유리 네비게이션 바. 문서의 Sign Up/Login 자리에는 이 도구에 맞는 버튼(새 검증 시작)을 둔다.
import Link from "next/link";
import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { FileCheck2, Menu, X } from "lucide-react";

export interface NavLink {
  id: string;
  label: string;
}

interface Props {
  links: NavLink[];
  onLink: (id: string) => void;
  /** 오른쪽 버튼 (보이지 않게 하려면 null) */
  action: { label: string; onClick: () => void } | null;
}

export default function Navbar({ links, onLink, action }: Props) {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();

  return (
    <motion.header
      initial={reduce ? false : { y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className="relative z-20 w-full px-4 py-4 sm:px-6 sm:py-6"
    >
      <nav aria-label="주 메뉴" className="liquid-glass mx-auto flex max-w-5xl items-center justify-between rounded-full px-5 py-3 sm:px-6">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2 rounded-full" aria-label="서류 검증기 처음 화면">
            <FileCheck2 size={24} className="text-white" aria-hidden />
            <span className="text-lg font-semibold text-white">서류 검증기</span>
          </Link>
          <ul className="hidden items-center gap-8 md:flex">
            {links.map((l) => (
              <li key={l.id}>
                <button
                  onClick={() => onLink(l.id)}
                  className="rounded text-sm font-medium text-white/80 transition-colors duration-300 hover:text-white"
                >
                  {l.label}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-center gap-2">
          {action && (
            <button
              onClick={action.onClick}
              className="liquid-glass hidden rounded-full px-6 py-2 text-sm font-medium text-white transition-opacity duration-300 hover:opacity-80 sm:block"
            >
              {action.label}
            </button>
          )}
          <button
            className="rounded-full p-2 text-white md:hidden"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? "메뉴 닫기" : "메뉴 열기"}
          >
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </nav>

      <AnimatePresence>
        {open && (
          <motion.div
            id="mobile-menu"
            initial={reduce ? false : { opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="liquid-glass glass-pill mx-auto mt-3 max-w-5xl !rounded-3xl p-3 md:hidden"
          >
            <ul className="flex flex-col">
              {links.map((l) => (
                <li key={l.id}>
                  <button
                    onClick={() => {
                      setOpen(false);
                      onLink(l.id);
                    }}
                    className="w-full rounded-2xl px-4 py-3 text-left text-sm font-medium text-white/90 hover:bg-white/5"
                  >
                    {l.label}
                  </button>
                </li>
              ))}
              {action && (
                <li>
                  <button
                    onClick={() => {
                      setOpen(false);
                      action.onClick();
                    }}
                    className="w-full rounded-2xl px-4 py-3 text-left text-sm font-medium text-white hover:bg-white/5"
                  >
                    {action.label}
                  </button>
                </li>
              )}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.header>
  );
}
