"use client";
// 배경: 계속 움직이는 액체 영상 (Mux HLS 스트림). 정지 이미지나 CSS 흉내가 아니라 실제 영상이다.
// Safari는 기본 HLS 재생, 그 밖의 브라우저는 hls.js로 재생한다. 영상은 모든 화면 요소 뒤에 둔다.
// 기본 재생을 지원한다고 답하고도 실제로는 못 트는 브라우저가 있어서, 기본 재생이 실패하면 hls.js로 넘어간다.
// 이 영상은 장식일 뿐이며 서류나 개인정보와 관계없다.
import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";

const SRC = "https://stream.mux.com/kimF2ha9zLrX64H00UgLGPflCzNtl1T0215MlAmeOztv8.m3u8";
/** 이 시간 안에 재생이 시작되지 않으면 대체 배경을 보여 준다 */
const START_TIMEOUT_MS = 12000;

export default function BackgroundVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    // 「움직임 줄이기」를 켠 사용자에게는 영상을 불러오지 않는다. 화면은 CSS(motion-reduce)가 정지된 대체 배경으로 바꾼다 (CHECK 17번)
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let hls: Hls | null = null;
    let cancelled = false;

    const fail = () => !cancelled && setFailed(true);
    // 이 시간 안에 재생이 시작되지 않으면 대체 배경을 보여 준다
    const timer = setTimeout(() => {
      if (video.readyState < 3 || video.paused) fail();
    }, START_TIMEOUT_MS);
    const onPlaying = () => {
      if (cancelled) return;
      clearTimeout(timer);
      setFailed(false);
    };
    const play = () => {
      // 자동 재생이 막혀도 화면은 그대로 두고, 다음 사용자 동작 때 다시 시도한다
      video.play().catch(() => {
        window.addEventListener(
          "pointerdown",
          () => {
            video.play().catch(() => {});
          },
          { once: true },
        );
      });
    };

    const startHls = () => {
      if (!Hls.isSupported()) return fail();
      hls = new Hls({ enableWorker: true, lowLatencyMode: false, capLevelToPlayerSize: true });
      hls.loadSource(SRC);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, play);
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && data.details !== Hls.ErrorDetails.MANIFEST_LOAD_ERROR) hls?.startLoad();
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls?.recoverMediaError();
        else fail();
      });
    };

    const onNativeError = () => {
      // 기본 재생 실패 → 처음 상태로 되돌리고 hls.js로 다시 시도
      video.removeEventListener("error", onNativeError);
      video.removeAttribute("src");
      video.load();
      startHls();
    };

    video.addEventListener("playing", onPlaying);
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = SRC;
      video.addEventListener("error", onNativeError);
      video.addEventListener("loadedmetadata", play, { once: true });
    } else {
      startHls();
    }

    return () => {
      cancelled = true;
      clearTimeout(timer);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("error", onNativeError);
      video.removeEventListener("loadedmetadata", play);
      hls?.destroy();
    };
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-black" aria-hidden="true">
      {/* 영상이 안 나올 때를 위한 은은한 대체 배경 (어두운 보라·남색 빛) */}
      <div
        className={`absolute inset-0 transition-opacity duration-1000 ${failed ? "opacity-100" : "opacity-0"} motion-reduce:opacity-100`}
        style={{
          background:
            "radial-gradient(60% 50% at 70% 30%, rgba(120,80,255,0.35), transparent 70%), radial-gradient(50% 45% at 25% 70%, rgba(60,90,255,0.28), transparent 70%), #000",
        }}
      />
      <video
        ref={videoRef}
        className="relative h-full w-full object-cover opacity-100 motion-reduce:hidden"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        tabIndex={-1}
      />
    </div>
  );
}
