"use client";
// 화면 전체에 깔리는 배경 영상 (사용자 제공 디자인 문서, 2026-11-13). 막·색을 입히지 않고 그대로 보여 준다.
// 영상이 안 나오면 바탕색(#c2ccd3)만 보인다. 움직임 줄이기 설정이면 영상을 멈춘다.
import { useEffect, useRef } from "react";

// 디자인 문서의 원본 영상은 HEVC 형식이라 나오지 않는 브라우저가 많다(파이어폭스, 그래픽 가속이 없는 PC의 크롬 등).
// 그래서 같은 영상을 어디서나 나오는 형식(H.264, VP9)으로 바꿔 사이트에 직접 싣는다. 외부 서버에 기대지 않는다.
// 원본: https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260816_125506_3a597378-ec85-4ebd-bd22-03b45508ac62.mp4

export default function BackgroundVideo() {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      if (mq.matches) video.pause();
      else video.play().catch(() => {});
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  return (
    <video ref={ref} id="bg-video" className="bg-video" aria-hidden="true" autoPlay muted loop playsInline preload="auto">
      <source src="/bg/glass.mp4" type="video/mp4" />
      <source src="/bg/glass.webm" type="video/webm" />
    </video>
  );
}
