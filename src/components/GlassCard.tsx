"use client";
// 굴절 유리 카드 (사용자 제공 디자인 문서, 2026-11-13).
// 배경 영상의 지금 장면을 2D 캔버스에 매 프레임 그리고, SVG 필터로 가장자리를 굴절·색 번짐시켜 두꺼운 유리처럼 보이게 한다.
import { useEffect, useRef, type ReactNode } from "react";

const DUP_PIXEL_RATIO = 1;

export default function GlassCard({ children }: { children: ReactNode }) {
  const cardRef = useRef<HTMLElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const card = cardRef.current;
    const box = boxRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!card || !box || !canvas || !ctx) return;
    let raf = 0;

    const frame = () => {
      raf = requestAnimationFrame(frame);
      const video = document.getElementById("bg-video") as HTMLVideoElement | null;
      const rect = card.getBoundingClientRect();
      if (!video || !rect.width || !rect.height || !video.videoWidth || !video.videoHeight) return;

      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // Sizing the duplicate to the viewport rather than the card is deliberate.
      // The filter shifts each colour channel by a different amount, so the
      // filtered element's own leading edges show hard channel-separation bands.
      // At viewport size those bands fall outside the card and only clean
      // refraction shows.
      box.style.left = `${-rect.left}px`;
      box.style.top = `${-rect.top}px`;
      box.style.width = `${vw}px`;
      box.style.height = `${vh}px`;

      // The duplicate stays at 1× even on retina.
      // The SVG filter's cost scales with pixel count, and what shows through
      // is a soft refraction where 4× the filter work buys nothing.
      const w = Math.round(vw * DUP_PIXEL_RATIO);
      const h = Math.round(vh * DUP_PIXEL_RATIO);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      // 배경 영상의 object-fit: cover와 똑같이 잘라 그린다
      const cover = Math.max(vw / video.videoWidth, vh / video.videoHeight);
      const sw = vw / cover;
      const sh = vh / cover;
      const sx = (video.videoWidth - sw) / 2;
      const sy = (video.videoHeight - sh) / 2;
      try {
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
      } catch {
        // 아직 장면이 풀리지 않았으면 다음 프레임에 다시 그린다
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <aside ref={cardRef} className="card group">
      <svg className="absolute" width="0" height="0" aria-hidden="true" focusable="false">
        <defs>
          <filter id="liquid-glass-refraction" x="-30%" y="-30%" width="160%" height="160%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.012 0.015" numOctaves="3" result="noise" />
            <feColorMatrix in="SourceAlpha" type="matrix" result="boosted_alpha" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 100 0" />
            <feGaussianBlur in="boosted_alpha" stdDeviation="45" result="blurred_alpha" />
            <feComponentTransfer in="blurred_alpha" result="edge_mask">
              <feFuncA type="linear" slope="-1.3" intercept="1" />
            </feComponentTransfer>
            <feComposite in="noise" in2="edge_mask" operator="arithmetic" k1="1" k2="0" k3="0" k4="0" result="masked_noise" />
            <feDisplacementMap in="SourceGraphic" in2="masked_noise" scale="65" xChannelSelector="R" yChannelSelector="G" result="red_displaced" />
            <feColorMatrix in="red_displaced" type="matrix" result="red" values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" />
            <feDisplacementMap in="SourceGraphic" in2="masked_noise" scale="56" xChannelSelector="R" yChannelSelector="G" result="green_displaced" />
            <feColorMatrix in="green_displaced" type="matrix" result="green" values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0" />
            <feDisplacementMap in="SourceGraphic" in2="masked_noise" scale="47" xChannelSelector="R" yChannelSelector="G" result="blue_displaced" />
            <feColorMatrix in="blue_displaced" type="matrix" result="blue" values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0" />
            <feBlend in="red" in2="green" mode="screen" result="rg" />
            <feBlend in="rg" in2="blue" mode="screen" result="chromatic_dispersion" />
          </filter>
        </defs>
      </svg>
      <div id="dup-video-container" ref={boxRef}>
        <canvas id="dup-image" ref={canvasRef} />
      </div>
      <div className="card__frost" aria-hidden="true" />
      {children}
    </aside>
  );
}
