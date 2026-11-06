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
export function hasInk(img: GrayImage, b: Box): boolean {
  let dark = 0, total = 0;
  for (let y = b.y0; y < b.y1; y += 2) for (let x = b.x0; x < b.x1; x += 2) {
    total++;
    if (isDark(img, x, y)) dark++;
  }
  return total > 0 && dark / total > 0.003;
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
  if (w < 20 || h < 6) return false;
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
