// 배경: 보라·남색 빛 덩어리가 천천히 떠다니는 「오로라」 (2026-11-13 사용자 선택).
// 외부 영상(Mux)이 안 나오는 일이 있어서, 사이트가 직접 그리는 CSS 배경으로 바꿨다. 외부 서비스에 기대지 않는다.
// 장식일 뿐이며 서류나 개인정보와 관계없다. 「움직임 줄이기」를 켠 사용자에게는 globals.css가 움직임을 멈춘다.

/** 빛 덩어리 하나: 위치·크기·색·움직임 */
const BLOBS = [
  { className: "aurora-blob aurora-a", style: { left: "42%", top: "-22%", width: "70vmax", height: "58vmax", background: "radial-gradient(closest-side, rgba(124,84,255,0.62), rgba(124,84,255,0.22) 55%, transparent)" } },
  { className: "aurora-blob aurora-b", style: { left: "-22%", top: "36%", width: "66vmax", height: "56vmax", background: "radial-gradient(closest-side, rgba(52,96,255,0.5), rgba(52,96,255,0.18) 55%, transparent)" } },
  { className: "aurora-blob aurora-c", style: { left: "30%", top: "48%", width: "50vmax", height: "42vmax", background: "radial-gradient(closest-side, rgba(210,70,200,0.3), rgba(210,70,200,0.1) 55%, transparent)" } },
] as const;

export default function AuroraBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[#05030d]" aria-hidden="true">
      {BLOBS.map((b) => (
        <div key={b.className} className={b.className} style={b.style} />
      ))}
    </div>
  );
}
