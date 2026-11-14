// 모서리 두 곳(왼쪽 위·오른쪽 아래)을 깎은 버튼: 흐린 유리 받침 + 가는 테두리 + 글자 + 오른쪽 화살표 (디자인 문서, 2026-11-13)
import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  /** 표 위·창 안에 쓰는 작은 크기 */
  small?: boolean;
  /** 화살표 대신 쓸 아이콘 */
  icon?: ReactNode;
  className?: string;
}

export const ArrowIcon = ({ className = "icon" }: { className?: string }) => (
  <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </svg>
);

export default function ChamferButton({ children, onClick, disabled, small, icon, className = "" }: Props) {
  // 깎인 모서리가 찌그러지지 않게 버튼 크기와 같은 비율의 그림 틀을 쓴다
  const [w, h] = small ? [180, 42] : [260, 48];
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`chamfer ${small ? "chamfer--sm" : ""} ${className}`}>
      <span className="chamfer__glass" aria-hidden="true" />
      <svg className="chamfer__outline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
        <polygon points={`14,0 ${w},0 ${w},${h - 14} ${w - 14},${h} 0,${h} 0,14`} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="chamfer__label">{children}</span>
      {icon ?? <ArrowIcon />}
    </button>
  );
}
