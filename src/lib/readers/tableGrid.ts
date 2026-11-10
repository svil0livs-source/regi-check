// Design Ref: DESIGN.md §4.4 — 스캔한 등기부 페이지에서 표의 칸(셀)을 찾는다. (2026-11-06 실제 스캔본 대응)
// 실제 등기부는 300dpi 스캔본이고, 표 선이 또렷하다. 줄 단위로 읽으면 칸이 섞여 근저당권 표가 조각나므로,
// 표 선을 찾아 칸마다 따로 읽는다. 외부 서비스를 부르지 않는 순수 계산이다.

/** 흑백 사진 (한 바이트 = 한 점의 밝기, 0 검정 ~ 255 흰색) */
export interface GrayImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 표의 한 줄(가로선 두 개 사이)과 그 안의 칸들 */
export interface GridRow extends Box {
  cells: Box[];
}

/** 이보다 어두우면 검은 점으로 본다 */
const DARK = 150;

const isDark = (img: GrayImage, x: number, y: number) => img.data[y * img.width + x] < DARK;

/**
 * 가로선: 표의 왼쪽 끝 가까이에서 오른쪽 끝 가까이까지 이어진 줄 (붙은 줄은 하나로).
 * 스캔으로 선이 군데군데 끊겨도 이어 보고, 칸 안의 취소선(짧고 표 양 끝에 닿지 않음)은 빼려고
 * 줄 전체에서 검은 부분이 페이지 폭의 minFrac 이상이고 왼쪽 끝은 15%, 오른쪽 끝은 8% 안쪽에 있어야 한다.
 */
export function findHorizontalLines(img: GrayImage, minFrac = 0.6): { y: number; x0: number; x1: number }[] {
  const out: { y: number; x0: number; x1: number }[] = [];
  let group: { y: number; x0: number; x1: number }[] = [];
  const flush = () => {
    if (!group.length) return;
    const mid = group[Math.floor(group.length / 2)];
    out.push({ y: mid.y, x0: Math.min(...group.map((g) => g.x0)), x1: Math.max(...group.map((g) => g.x1)) });
    group = [];
  };
  for (let y = 0; y < img.height; y++) {
    // 끊김 6점까지는 이어 본 덩어리들 중 40점 이상인 것만 센다
    let covered = 0, x0 = -1, x1 = -1, start = -1, last = -10;
    const close = () => {
      if (start >= 0 && last - start >= 40) {
        covered += last - start + 1;
        if (x0 < 0) x0 = start;
        x1 = last;
      }
    };
    for (let x = 0; x < img.width; x++) {
      // 스캔이 살짝 기울어 선이 위아래로 몇 점 어긋나도 한 줄로 본다
      let dark = false;
      for (let dy = -3; dy <= 3 && !dark; dy++) dark = y + dy >= 0 && y + dy < img.height && isDark(img, x, y + dy);
      if (!dark) continue;
      if (x - last > 6) {
        close();
        start = x;
      }
      last = x;
    }
    close();
    const isLine = covered >= img.width * minFrac && x0 < img.width * 0.15 && x1 > img.width * 0.92;
    if (isLine) {
      if (group.length && y - group[group.length - 1].y > 2) flush();
      group.push({ y, x0, x1 });
    } else if (group.length && y - group[group.length - 1].y > 2) flush();
  }
  flush();
  return out;
}

/** 두 가로선 사이(띠)에서 세로선의 x 위치들: 띠 높이의 대부분이 검은 세로 줄 (붙은 줄은 하나로) */
export function findVerticalLines(img: GrayImage, band: Box, minFrac = 0.85): number[] {
  const top = band.y0 + 3, bottom = band.y1 - 3;
  const h = bottom - top;
  if (h < 8) return [];
  const xs: number[] = [];
  for (let x = Math.max(0, band.x0 - 4); x <= Math.min(img.width - 1, band.x1 + 4); x++) {
    let dark = 0;
    for (let y = top; y < bottom; y++) if (isDark(img, x, y) || (x > 0 && isDark(img, x - 1, y)) || (x + 1 < img.width && isDark(img, x + 1, y))) dark++;
    if (dark >= h * minFrac) xs.push(x);
  }
  const out: number[] = [];
  let g: number[] = [];
  for (const x of xs) {
    if (g.length && x - g[g.length - 1] > 2) {
      out.push(g[Math.floor(g.length / 2)]);
      g = [];
    }
    g.push(x);
  }
  if (g.length) out.push(g[Math.floor(g.length / 2)]);
  return out;
}

/** 칸 안에 글자가 있는지 (검은 점 비율) */
export function hasInk(img: GrayImage, b: Box, min = 25): boolean {
  let dark = 0, total = 0;
  for (let y = b.y0; y < b.y1; y += 2) for (let x = b.x0; x < b.x1; x += 2) {
    total++;
    if (isDark(img, x, y)) dark++;
  }
  // 비율이 아니라 개수로 본다: 키 큰 칸에 숫자 하나만 있으면(순위번호 "6") 비율이 아주 작다
  return total > 0 && dark >= min;
}

/**
 * 페이지의 표 줄과 칸을 찾는다.
 * 가로선 두 개 사이가 한 줄이고, 그 사이 세로선으로 칸을 나눈다. 세로선이 없으면(제목 줄) 칸 하나.
 * 칸 경계에서 선 두께만큼 안쪽으로 잘라 선이 글자로 읽히지 않게 한다.
 */
export function findGrid(img: GrayImage): GridRow[] {
  const lines = findHorizontalLines(img);
  const rows: GridRow[] = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    const a = lines[i], b = lines[i + 1];
    if (b.y - a.y < 25) continue; // 겹선(두 줄 테두리)은 줄이 아니다
    const band: Box = { x0: Math.max(a.x0, b.x0) - 2, y0: a.y, x1: Math.min(a.x1, b.x1) + 2, y1: b.y };
        const vx = findVerticalLines(img, band).filter((x) => x > band.x0 + 10 && x < band.x1 - 10);
    const edges = [band.x0, ...vx, band.x1];
    const cells: Box[] = [];
    for (let k = 0; k + 1 < edges.length; k++) {
      const c = { x0: edges[k] + 5, y0: band.y0 + 5, x1: edges[k + 1] - 5, y1: band.y1 - 4 };
      if (c.x1 - c.x0 > 10) cells.push(c);
    }
    rows.push({ ...band, cells });
  }
  return rows;
}

/**
 * 줄 하나(글자 줄의 상자)에 취소선이 그어졌는지: 글자 높이 가운데쯤에 줄 폭 대부분을 가로지르는 검은 선이 있으면 말소된 글자.
 * 말소된 등기·옛 주소는 등기부에 취소선으로 남아 있다.
 */
export function isStruck(img: GrayImage, line: Box): boolean {
  const w = line.x1 - line.x0;
  const h = line.y1 - line.y0;
  // 글자 한두 개짜리 줄(순위번호 "6" 등)은 글자 자체의 가로획을 취소선으로 오해하기 쉬워 보지 않는다
  if (w < 20 || h < 6 || w < h * 2.5) return false;
  for (let y = line.y0 + Math.floor(h * 0.2); y <= line.y0 + Math.ceil(h * 0.85); y++) {
    let run = 0, best = 0, gap = 0;
    for (let x = line.x0; x < line.x1; x++) {
      if (isDark(img, x, y)) {
        run += gap + 1;
        gap = 0;
      } else if (run > 0 && gap < 2) gap++;
      else {
        best = Math.max(best, run);
        run = 0;
        gap = 0;
      }
    }
    best = Math.max(best, run);
    if (best >= w * 0.45) return true;
  }
  return false;
}

/** 상자 안 글자 덩어리(세로로 빈 틈 없이 이어진 검은 점 묶음)의 가로 범위와 세로 범위 */
export interface Glyph {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** 상자 안을 세로 빈 틈(2점 이상)으로 나눠 글자 덩어리들을 왼쪽부터 돌려준다 */
export function glyphs(img: GrayImage, b: Box): Glyph[] {
  const out: Glyph[] = [];
  let cur: Glyph | null = null;
  let gap = 0;
  for (let x = b.x0; x < b.x1; x++) {
    let top = -1, bottom = -1;
    for (let y = b.y0; y < b.y1; y++) if (isDark(img, x, y)) {
      if (top < 0) top = y;
      bottom = y;
    }
    if (top >= 0) {
      if (cur && gap < 2) {
        cur.x1 = x;
        cur.y0 = Math.min(cur.y0, top);
        cur.y1 = Math.max(cur.y1, bottom);
      } else {
        if (cur) out.push(cur);
        cur = { x0: x, x1: x, y0: top, y1: bottom };
      }
      gap = 0;
    } else gap++;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * 면적 숫자 뒤에 붙은 단위 기호(m²)가 시작하는 x 위치 후보들 (앞의 것이 더 그럴듯함). 못 찾으면 빈 배열.
 * 등기부의 ㎡는 "m" 뒤에 작은 위첨자 "²"가 붙은 모양이라 글자 읽기가 "1"·"'"·"ㅁ" 등으로 잘못 읽는다.
 * - 맨 끝 덩어리가 줄 높이의 절반보다 작고 위쪽에 떠 있으면 위첨자 "²" → 그 앞 덩어리가 "m"
 * - 위첨자가 m에 붙어 한 덩어리면, 맨 끝 덩어리가 숫자들보다 눈에 띄게 넓으면 그것이 "m²"
 * - 마지막 숫자가 m에 붙어 한 덩어리면(예: "2m", 2026-11-06 시험 서류·실제 스캔), 덩어리 안에서 나눈다:
 *   숫자는 줄 위쪽까지 올라가고 m은 소문자 높이에서 시작하므로, 숫자 쪽에서 처음으로 위쪽에 잉크가 없는 세로줄이 m의 시작.
 *   경계가 한두 점 어긋날 수 있어 조금 오른쪽 자리도 후보로 함께 돌려준다 (읽은 숫자가 맞는지는 부르는 쪽이 확인한다).
 */
export function unitGlyphCuts(img: GrayImage, b: Box): number[] {
  const gs = glyphs(img, b).filter((g) => g.x1 - g.x0 >= 1 && g.y1 - g.y0 >= 2);
  if (gs.length < 3) return [];
  const lineTop = Math.min(...gs.map((g) => g.y0));
  const lineBottom = Math.max(...gs.map((g) => g.y1));
  const h = lineBottom - lineTop;
  const last = gs[gs.length - 1];
  const raised = last.y1 - last.y0 < h * 0.5 && last.y1 < lineTop + h * 0.6;
  // 숫자 덩어리 폭의 가운데값 (점 "."은 좁아서 뺀다)
  const body = raised ? gs.slice(0, -2) : gs.slice(0, -1);
  const widths = body.map((g) => g.x1 - g.x0).filter((w) => w > h * 0.25).sort((a, b) => a - b);
  const median = widths.length ? widths[Math.floor(widths.length / 2)] : 0;
  // 세로줄 x에 줄 위쪽(소문자 m보다 높은 곳) 잉크가 있는지
  const highY = lineTop + Math.round(h * 0.3);
  const tall = (x: number) => {
    for (let y = lineTop; y < highY; y++) if (isDark(img, x, y)) return true;
    return false;
  };
  /** 덩어리 g 안에서 숫자와 m을 나눈 자리 후보. 앞쪽이 숫자가 아니면(덩어리 전체가 단위) [g.x0] */
  const split = (g: Glyph): number[] => {
    if (!median || g.x1 - g.x0 <= median * 1.3) return [g.x0];
    let digit = false;
    for (let x = g.x0; x <= Math.min(g.x1, g.x0 + median); x++) if (tall(x)) digit = true;
    if (!digit) return [g.x0];
    for (let x = g.x0 + Math.round(median * 0.5); x <= g.x1; x++) {
      if (tall(x)) continue;
      const step = Math.max(1, Math.round(median * 0.1));
      return [x, x + step, x + 2 * step].filter((c) => c < g.x1);
    }
    return [g.x0];
  };
  if (raised) {
    // "m"은 획 사이 틈 때문에 여러 덩어리로 나뉘기도 한다. 숫자보다 키가 작은(소문자 높이) 덩어리는 m의 일부로 본다.
    // (소수점 "."은 아주 작아서 m의 일부로 보지 않는다)
    let k = gs.length - 2;
    const isLower = (g: Glyph) => g.y1 - g.y0 > h * 0.4 && g.y0 > lineTop + h * 0.2;
    if (!isLower(gs[k])) return split(gs[k]);
    while (k > 0 && isLower(gs[k - 1])) k--;
    return [gs[k].x0];
  }
  if (!median) return [];
  return last.x1 - last.x0 > median * 1.3 ? split(last) : [];
}

/** 단위 기호 시작 자리의 가장 그럴듯한 후보 (없으면 null) */
export const unitGlyphStart = (img: GrayImage, b: Box): number | null => unitGlyphCuts(img, b)[0] ?? null;

/**
 * 칸 안의 손글씨(볼펜 동그라미·체크 표시 등)를 지운 흑백 사진을 돌려준다 (2026-11-06 사용자 요청: 필기는 무시).
 * 이어진 검은 점 묶음마다 크기를 보고, 인쇄 글자로 볼 수 없는 것만 흰색으로 지운다.
 *   - 인쇄 글자(300dpi에서 높이 약 30점)보다 훨씬 높은 묶음 (동그라미·긴 획)
 *   - 크기는 글자만 한데 속이 거의 빈 묶음 (체크 표시 ✓)
 * 칸 안의 취소선은 지우지 않는다(가로로 길고 낮아서 위 조건에 걸리지 않음).
 */
export function withoutHandwriting(img: GrayImage, b: Box, faintToo = false): Uint8Array {
  const w = b.x1 - b.x0, h = b.y1 - b.y0;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) out.set(img.data.subarray((b.y0 + y) * img.width + b.x0, (b.y0 + y) * img.width + b.x0 + w), y * w);
  const unit = img.width / 2480; // 300dpi A4 폭 기준 배율
  // 볼펜 자국은 인쇄 글자보다 옅은 회색이라, 묶음을 찾을 때는 옅은 점까지 센다
  const INK = 215;
  // 인쇄 글자의 진한 부분 (이보다 진한 점은 손글씨 묶음 안에 있어도 지우지 않는다)
  const PRINT = 110;
  const FAINT = 160;
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || out[start] >= INK) continue;
    // 묶음 하나를 모은다 (8방향으로 이어진 검은 점)
    const pts: number[] = [];
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      pts.push(p);
      const px = p % w, py = (p - px) / w;
      if (px < x0) x0 = px;
      if (px > x1) x1 = px;
      if (py < y0) y0 = py;
      if (py > y1) y1 = py;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = px + dx, ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (!seen[q] && out[q] < INK) {
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const fill = pts.length / (bw * bh);
    const tooTall = bh > 55 * unit;
    const hollow = bw > 30 * unit && bh > 30 * unit && fill < 0.1;
    // 볼펜 선이 인쇄 글자에 닿으면 한 묶음이 된다. 묶음 전체가 아니라 옅은 점(볼펜)만 지우고 진한 점(인쇄)은 남긴다
    if (tooTall || hollow) for (const p of pts) if (out[p] >= PRINT) out[p] = 255;
    // 순위번호 칸의 먼지 같은 작은 점은 숫자를 잘못 읽게 한다
    else if (faintToo && pts.length < 15 * unit * unit) for (const p of pts) out[p] = 255;
  }
  // 옅게 끊긴 볼펜 자국은 작은 조각으로 남아 묶음 크기로 못 거른다. faintToo면(순위번호 칸처럼 굵은 숫자만 있는 칸)
  // 옅은 점을 모두 흰색으로 둔다. 다른 칸은 옅게 찍힌 인쇄 글자까지 지울 수 있어 하지 않는다
  // 단, 진한 인쇄 획 바로 옆(2점 안)의 옅은 점은 글자 가장자리라 남긴다 (지우면 8이 6처럼 가늘어진다)
  if (faintToo) {
    const nearPrint = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (out[y * w + x] >= PRINT) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h) nearPrint[ny * w + nx] = 1;
      }
    }
    for (let i = 0; i < out.length; i++) if (out[i] >= FAINT && !nearPrint[i]) out[i] = 255;
  }
  return out;
}
