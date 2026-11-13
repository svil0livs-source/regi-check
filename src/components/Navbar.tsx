"use client";
// 위쪽 메뉴 줄: 왼쪽 「메뉴」(왼쪽에서 미끄러져 나오는 창), 가운데 REGI-CHECK(첫 화면으로), 오른쪽 점 + 버튼. (디자인 문서, 2026-11-13)
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowIcon } from "@/components/ChamferButton";

export interface NavLink {
  id: string;
  label: string;
}

interface Props {
  links: NavLink[];
  onLink: (id: string) => void;
  /** 오른쪽 버튼 */
  action: { label: string; onClick: () => void };
  /** 가운데 REGI-CHECK를 누르면 첫 화면으로 */
  onHome: () => void;
}

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export default function Navbar({ links, onLink, action, onHome }: Props) {
  const [open, setOpen] = useState(false);
  const openRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  /** 메뉴를 열고 닫는 한 곳: 열면 「닫기」로, 닫으면 「메뉴」로 초점을 옮긴다 */
  const setMenu = useCallback((next: boolean) => {
    setOpen(next);
    // 숨겨진 동안에는 초점을 받을 수 없어서 화면이 바뀐 다음에 옮긴다
    requestAnimationFrame(() => (next ? closeRef : openRef).current?.focus({ preventScroll: true }));
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setMenu]);

  return (
    <>
      <nav className="nav" aria-label="주 메뉴">
        <button ref={openRef} id="menu-open" className="nav__item" aria-expanded={open} aria-controls="menu" aria-label="메뉴 열기" onClick={() => setMenu(true)}>
          <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
            <path d="M4 6h16" />
            <path d="M4 12h16" />
            <path d="M4 18h16" />
          </svg>
          <span className="nav__label nav__label--menu">메뉴</span>
        </button>

        <Link
          href="/"
          className="nav__brand"
          aria-label="REGI-CHECK 처음 화면"
          onClick={(e) => {
            // 같은 주소라 이동이 일어나지 않으므로 화면 상태를 직접 첫 화면으로 되돌린다
            e.preventDefault();
            onHome();
          }}
        >
          REGI-CHECK
        </Link>

        <button className="nav__item" onClick={action.onClick}>
          <span className="nav__dot" aria-hidden="true" />
          <span className="nav__label">{action.label}</span>
        </button>
      </nav>

      <div id="menu" className={`menu ${open ? "is-open" : ""}`} role="dialog" aria-modal="true" aria-label="메뉴">
        <div className="menu__backdrop" onClick={() => setMenu(false)} />
        <div className="menu__panel">
          <button ref={closeRef} className="menu__close" onClick={() => setMenu(false)}>
            <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
            닫기
          </button>
          <div className="menu__nav">
            {links.map((l) => (
              <button
                key={l.id}
                className="menu__link"
                onClick={() => {
                  setMenu(false);
                  onLink(l.id);
                }}
              >
                <span className="menu__linkText">{l.label}</span>
                <ArrowIcon className="menu__arrow icon" />
              </button>
            ))}
          </div>
          <div className="menu__foot">
            <span className="menu__footLabel">REGI-CHECK · REAL ESTATE REGISTRATION DOCUMENT CHECK</span>
            <span className="menu__mail break-keep">한국자산관리공사 서울동부지역본부 유주연 차장</span>
          </div>
        </div>
      </div>
    </>
  );
}
