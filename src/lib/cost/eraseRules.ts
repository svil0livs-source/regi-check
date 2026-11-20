// 비용 검증: 스캔 페이지에서 표의 가로·세로 선을 지운다 (2026-11-20).
// 청구서·영수증은 대부분 표라서 선이 글자와 붙어 읽히거나 칸이 다른 덩어리로 나뉘어 줄이 끊어진다.
// 글자 획보다 훨씬 긴 검은 줄(기본 1cm 이상)만 흰색으로 바꾸고, 흐릿한 선 가장자리 한 점씩도 함께 지운다. 순수 계산이다.
import type { GrayImage } from "@/lib/readers/tableGrid";

const DARK = 180;
const EDGE = 230;

/** minRun: 이 길이(점) 이상 이어진 검은 줄만 선으로 본다. 200dpi에서 80점 ≈ 1cm */
export function eraseRules(img: GrayImage, minRun = 80): Uint8Array {
  const { width: W, height: H, data } = img;
  const out = new Uint8Array(data);
  const wipe = (i: number) => (out[i] = 255);
  // 가로선
  for (let y = 0; y < H; y++) {
    let x = 0;
    while (x < W) {
      if (data[y * W + x] >= DARK) {
        x++;
        continue;
      }
      let e = x;
      while (e < W && data[y * W + e] < DARK) e++;
      if (e - x >= minRun) {
        for (let k = x; k < e; k++) {
          wipe(y * W + k);
          if (y > 0 && data[(y - 1) * W + k] < EDGE) wipe((y - 1) * W + k);
          if (y + 1 < H && data[(y + 1) * W + k] < EDGE) wipe((y + 1) * W + k);
        }
      }
      x = e;
    }
  }
  // 세로선
  for (let x = 0; x < W; x++) {
    let y = 0;
    while (y < H) {
      if (data[y * W + x] >= DARK) {
        y++;
        continue;
      }
      let e = y;
      while (e < H && data[e * W + x] < DARK) e++;
      if (e - y >= minRun) {
        for (let k = y; k < e; k++) {
          wipe(k * W + x);
          if (x > 0 && data[k * W + x - 1] < EDGE) wipe(k * W + x - 1);
          if (x + 1 < W && data[k * W + x + 1] < EDGE) wipe(k * W + x + 1);
        }
      }
      y = e;
    }
  }
  return out;
}
