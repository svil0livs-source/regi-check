// Design Ref: DESIGN.md §4.4 — 스캔 사진을 글자 읽기 서비스가 줄이지 않는 크기로 손질한다.
// 글자 읽기 서비스(OpenAI)는 사진의 짧은 변을 약 768픽셀로 줄여서 보기 때문에,
// A4 한 장을 통째로 보내면 글자가 너무 작아져 이름을 잘못 읽는다.
// 그래서 (1) 빈 여백을 잘라 내고 (2) 가로로 잘라 높이 STRIP_MAX 이하 조각으로 나눈 뒤
// (3) 서비스가 줄이지 않는 한도(긴 변 2048, 짧은 변 768) 안에서 최대한 확대한다. (작은 글자를 더 크게 보게)
// 자를 자리: 표 사이 빈 줄 → 없으면 표 안의 글자 줄과 줄 사이(세로 칸선만 있는 줄) → 그래도 없으면 겹치게 자르기.
import "server-only";
import sharp from "sharp";

/** 조각 하나의 최대 높이 (작을수록 더 크게 확대할 수 있다) */
const STRIP_MAX = 500;
/** 서비스가 줄이지 않는 크기 한도 */
const LIMIT_LONG = 2048;
const LIMIT_SHORT = 768;
/** 너무 크게 키우면 흐려지므로 최대 배율 */
const MAX_SCALE = 2;
/** 빈 줄로 볼 만큼 어두운 점이 적은 줄 */
const BLANK_ROW_MAX_DARK = 3;
/** 이만큼 이어진 빈 줄이어야 자를 자리로 본다 */
const GAP_MIN_ROWS = 10;
/** 표 안 글자 줄 사이: 세로 칸선 몇 개만 지나가는 줄 */
const LOW_INK_ROW_MAX_DARK = 30;
const LOW_INK_MIN_ROWS = 5;
/** 빈 줄이 없어 억지로 자를 때 겹치게 둘 높이 (줄이 반으로 잘리지 않게) */
const FORCED_OVERLAP = 120;

export interface ScanStrip {
  jpeg: Buffer;
  width: number;
  height: number;
  /** 앞 조각과 겹치는 부분이 있는지 */
  overlapsPrevious: boolean;
}

/** 스캔 사진(JPEG 등)을 손질해 조각들로 나눈다 */
export async function prepareScanStrips(image: Buffer): Promise<ScanStrip[]> {
  const { data, info } = await sharp(image).greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;
  const dark = (x: number, y: number) => data[y * W + x] < 140;

  // 줄별·칸별 어두운 점 개수
  const rowDark = new Array<number>(H).fill(0);
  const colDark = new Array<number>(W).fill(0);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (dark(x, y)) {
        rowDark[y]++;
        colDark[x]++;
      }
    }
  }

  // 1) 글자가 있는 영역만 남기기
  const firstRow = rowDark.findIndex((c) => c > BLANK_ROW_MAX_DARK);
  const lastRow = H - 1 - [...rowDark].reverse().findIndex((c) => c > BLANK_ROW_MAX_DARK);
  const firstCol = colDark.findIndex((c) => c > BLANK_ROW_MAX_DARK);
  const lastCol = W - 1 - [...colDark].reverse().findIndex((c) => c > BLANK_ROW_MAX_DARK);
  if (firstRow < 0 || firstCol < 0) return [];
  const margin = 16;
  const top = Math.max(0, firstRow - margin);
  const bottom = Math.min(H - 1, lastRow + margin);
  const left = Math.max(0, firstCol - margin);
  const right = Math.min(W - 1, lastCol + margin);

  // 2) 자를 자리 후보 찾기 (구간의 가운데). 빈 줄 구간과, 표 안 글자 줄 사이 구간
  const runsWhere = (maxDark: number, minRows: number) => {
    const out: number[] = [];
    for (let y = top, run = 0; y <= bottom + 1; y++) {
      if (y <= bottom && rowDark[y] <= maxDark) run++;
      else {
        if (run >= minRows) out.push(y - Math.ceil(run / 2));
        run = 0;
      }
    }
    return out;
  };
  const blankCuts = runsWhere(BLANK_ROW_MAX_DARK, GAP_MIN_ROWS);
  const lowInkCuts = runsWhere(LOW_INK_ROW_MAX_DARK, LOW_INK_MIN_ROWS);

  // 3) 위에서부터 STRIP_MAX 안에서 가장 아래 자를 자리로 자르기 (빈 줄 우선)
  const ranges: { from: number; to: number; overlapsPrevious: boolean }[] = [];
  let from = top;
  let overlap = false;
  while (from < bottom) {
    if (bottom - from <= STRIP_MAX) {
      ranges.push({ from, to: bottom, overlapsPrevious: overlap });
      break;
    }
    const limit = from + STRIP_MAX;
    const within = (cs: number[]) => cs.filter((c) => c > from + STRIP_MAX / 3 && c <= limit);
    const candidates = within(blankCuts).length ? within(blankCuts) : within(lowInkCuts);
    if (candidates.length) {
      const cut = candidates[candidates.length - 1];
      ranges.push({ from, to: cut, overlapsPrevious: overlap });
      from = cut;
      overlap = false;
    } else {
      ranges.push({ from, to: limit, overlapsPrevious: overlap });
      from = limit - FORCED_OVERLAP;
      overlap = true;
    }
  }

  return Promise.all(
    ranges.map(async (r) => {
      const height = r.to - r.from + 1;
      const width = right - left + 1;
      // 서비스가 줄이지 않는 한도 안에서 최대한 확대
      const long = Math.max(width, height);
      const short = Math.min(width, height);
      const scale = Math.max(1, Math.min(MAX_SCALE, LIMIT_LONG / long, LIMIT_SHORT / short));
      const outW = Math.round(width * scale);
      const outH = Math.round(height * scale);
      const jpeg = await sharp(image)
        .extract({ left, top: r.from, width, height })
        .resize({ width: outW, height: outH, kernel: "lanczos3" })
        .jpeg({ quality: 92 })
        .toBuffer();
      return { jpeg, width: outW, height: outH, overlapsPrevious: r.overlapsPrevious };
    }),
  );
}
