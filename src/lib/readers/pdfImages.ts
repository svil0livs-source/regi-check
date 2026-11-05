// Design Ref: DESIGN.md §4.4 — 스캔 PDF에서 페이지마다 스캔 사진 한 장을 꺼낸다 (Tesseract 글자 읽기용).
// 2026-11-05 보완: JPEG(DCTDecode)만 꺼내던 것을 넓혀
//   - Flate(무손실 압축) 회색조·컬러·흑백(1비트) 사진, 필터를 겹쳐 쓴 [Flate, DCT] 사진도 꺼낸다.
//   - 페이지 순서는 PDF의 페이지 목록(/Pages → /Kids) 순서를 따른다. 못 읽으면 파일 안 순서.
//   - 페이지마다 가장 큰 사진만 쓴다(로고·도장 같은 작은 사진은 페이지로 보지 않음).
//   - CCITT·JBIG2·JPEG2000 방식은 읽을 수 없다고 이유를 알린다(고치지 않고 「처리 실패」).
// 서버에서만 쓴다. 서류 내용은 로그에 남기지 않는다.
import "server-only";
import { inflateSync } from "node:zlib";
import sharp from "sharp";

/** 꺼낸 페이지 사진 (sharp가 읽을 수 있는 JPEG 또는 PNG) */
export type PageImage = Buffer;

/** 읽을 수 없는 사진 방식이 있을 때 */
export class PdfImageError extends Error {}

/** 페이지 사진으로 볼 최소 크기(픽셀). 이보다 작으면 로고·도장으로 본다 */
const MIN_SIDE = 300;

interface PdfObject {
  dict: string;
  /** stream 본문 (있으면) */
  data?: Buffer;
}

/** "12 0 obj << … >> stream … endstream endobj" 들을 번호별로 모은다 */
function readObjects(b: Buffer): Map<number, PdfObject> {
  const text = b.toString("latin1");
  const objs = new Map<number, PdfObject>();
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const id = Number(m[1]);
    const bodyStart = m.index + m[0].length;
    const endobj = text.indexOf("endobj", bodyStart);
    if (endobj === -1) break;
    const streamAt = text.indexOf("stream", bodyStart);
    if (streamAt !== -1 && streamAt < endobj && text.slice(bodyStart, streamAt).includes(">>")) {
      let start = streamAt + "stream".length;
      if (b[start] === 0x0d) start++;
      if (b[start] === 0x0a) start++;
      const end = text.indexOf("endstream", start);
      const stop = end === -1 ? endobj : end;
      // endstream 앞의 줄바꿈은 본문이 아니다
      let dataEnd = stop;
      if (b[dataEnd - 1] === 0x0a) dataEnd--;
      if (b[dataEnd - 1] === 0x0d) dataEnd--;
      objs.set(id, { dict: text.slice(bodyStart, streamAt), data: b.subarray(start, dataEnd) });
      re.lastIndex = (end === -1 ? endobj : end) + 1;
    } else {
      objs.set(id, { dict: text.slice(bodyStart, endobj) });
      re.lastIndex = endobj + 1;
    }
  }
  return objs;
}

const num = (dict: string, key: string) => {
  const m = new RegExp(`/${key}\\s+(\\d+)`).exec(dict);
  return m ? Number(m[1]) : undefined;
};
const ref = (dict: string, key: string) => {
  const m = new RegExp(`/${key}\\s+(\\d+)\\s+\\d+\\s+R`).exec(dict);
  return m ? Number(m[1]) : undefined;
};
/** /Filter 값 목록 (이름 하나 또는 배열) */
function filters(dict: string): string[] {
  const m = /\/Filter\s*(\[[^\]]*\]|\/\w+)/.exec(dict);
  if (!m) return [];
  return [...m[1].matchAll(/\/(\w+)/g)].map((x) => x[1]);
}
/** 사전 안에서 /Key << … >> 부분을 꺼낸다 (중첩 고려) */
function subDict(dict: string, key: string): string | undefined {
  const at = dict.indexOf(`/${key}`);
  if (at === -1) return undefined;
  const open = dict.indexOf("<<", at);
  const nextSlash = dict.slice(at + key.length + 1).search(/\S/);
  if (open === -1 || open > at + key.length + 1 + nextSlash) return undefined;
  let depth = 0;
  for (let i = open; i < dict.length - 1; i++) {
    if (dict[i] === "<" && dict[i + 1] === "<") {
      depth++;
      i++;
    } else if (dict[i] === ">" && dict[i + 1] === ">") {
      depth--;
      i++;
      if (depth === 0) return dict.slice(open, i + 1);
    }
  }
  return undefined;
}

/** 페이지 목록 순서대로 페이지 객체 번호 */
function pageOrder(objs: Map<number, PdfObject>): number[] {
  const catalog = [...objs.values()].find((o) => /\/Type\s*\/Catalog/.test(o.dict));
  const root = catalog ? ref(catalog.dict, "Pages") : undefined;
  const out: number[] = [];
  const seen = new Set<number>();
  const walk = (id: number) => {
    if (seen.has(id)) return;
    seen.add(id);
    const o = objs.get(id);
    if (!o) return;
    if (/\/Type\s*\/Pages\b/.test(o.dict)) {
      const kids = /\/Kids\s*\[([^\]]*)\]/.exec(o.dict)?.[1] ?? "";
      for (const k of kids.matchAll(/(\d+)\s+\d+\s+R/g)) walk(Number(k[1]));
    } else if (/\/Type\s*\/Page\b/.test(o.dict)) out.push(id);
  };
  if (root !== undefined) walk(root);
  return out;
}

/** 페이지가 쓰는 사진 객체 번호들 */
function pageImageIds(objs: Map<number, PdfObject>, pageId: number): number[] {
  const page = objs.get(pageId);
  if (!page) return [];
  let res = subDict(page.dict, "Resources");
  const resRef = res ? undefined : ref(page.dict, "Resources");
  if (resRef !== undefined) res = objs.get(resRef)?.dict;
  if (!res) return [];
  let xo = subDict(res, "XObject");
  const xoRef = xo ? undefined : ref(res, "XObject");
  if (xoRef !== undefined) xo = objs.get(xoRef)?.dict;
  if (!xo) return [];
  return [...xo.matchAll(/\/[\w.-]+\s+(\d+)\s+\d+\s+R/g)].map((m) => Number(m[1]));
}

const isImage = (o: PdfObject | undefined): o is Required<PdfObject> => !!o?.data && /\/Subtype\s*\/Image/.test(o.dict);

/** 사진의 색 공간: DeviceGray / DeviceRGB (ICCBased는 성분 수 N으로 판단). 그 밖(Indexed 등)은 그대로 이름을 돌려준다 */
function colorSpaceOf(dict: string, objs: Map<number, PdfObject>): string | undefined {
  let v = /\/ColorSpace\s*(\[[^\]]*\]|\/\w+|\d+\s+\d+\s+R)/.exec(dict)?.[1];
  if (!v) return undefined;
  const r = /^(\d+)\s+\d+\s+R$/.exec(v);
  if (r) v = objs.get(Number(r[1]))?.dict.trim() ?? "";
  if (/ICCBased/.test(v)) {
    const icc = /ICCBased\s+(\d+)\s+\d+\s+R/.exec(v)?.[1];
    const n = icc ? num(objs.get(Number(icc))?.dict ?? "", "N") : undefined;
    return n === 3 ? "DeviceRGB" : n === 1 ? "DeviceGray" : `ICC${n ?? ""}`;
  }
  return /\/(\w+)/.exec(v)?.[1];
}

/** PNG 예측자(Predictor 10~15)를 되돌린다 */
function undoPngPredictor(data: Buffer, rowBytes: number, bpp: number): Buffer {
  const rows = Math.floor(data.length / (rowBytes + 1));
  const out = Buffer.alloc(rows * rowBytes);
  for (let r = 0; r < rows; r++) {
    const type = data[r * (rowBytes + 1)];
    const src = data.subarray(r * (rowBytes + 1) + 1, (r + 1) * (rowBytes + 1));
    const cur = out.subarray(r * rowBytes, (r + 1) * rowBytes);
    const prev = r > 0 ? out.subarray((r - 1) * rowBytes, r * rowBytes) : Buffer.alloc(rowBytes);
    for (let i = 0; i < rowBytes; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = src[i];
      if (type === 1) v += a;
      else if (type === 2) v += b;
      else if (type === 3) v += (a + b) >> 1;
      else if (type === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 0xff;
    }
  }
  return out;
}

/** 사진 객체 하나를 sharp가 읽는 형식으로 바꾼다. 읽을 수 없는 방식이면 PdfImageError */
async function decodeImage(o: Required<PdfObject>, objs: Map<number, PdfObject>): Promise<{ image: Buffer; area: number }> {
  const fs = filters(o.dict);
  const w = num(o.dict, "Width") ?? 0;
  const h = num(o.dict, "Height") ?? 0;
  const unsupported = fs.find((f) => ["CCITTFaxDecode", "JBIG2Decode", "JPXDecode"].includes(f));
  if (unsupported) {
    const name = { CCITTFaxDecode: "CCITT 흑백 팩스", JBIG2Decode: "JBIG2 흑백", JPXDecode: "JPEG 2000" }[unsupported];
    throw new PdfImageError(`이 PDF의 스캔 사진 방식(${name})은 아직 읽을 수 없습니다. 스캐너를 회색조/컬러 JPEG로 저장하도록 바꿔 다시 스캔해 주세요.`);
  }
  let data: Buffer = o.data;
  for (const f of fs) {
    if (f === "FlateDecode") data = inflateSync(data);
    else if (f === "DCTDecode") return { image: data, area: w * h }; // 이후 단계는 JPEG 그대로
    else throw new PdfImageError(`이 PDF의 스캔 사진 압축 방식(${f})은 아직 읽을 수 없습니다.`);
  }
  // 압축을 푼 날것의 픽셀
  const bpc = num(o.dict, "BitsPerComponent") ?? 8;
  const cs = /\/ImageMask\s+true/.test(o.dict) ? "DeviceGray" : colorSpaceOf(o.dict, objs);
  const channels = cs === "DeviceRGB" ? 3 : cs === "DeviceGray" || bpc === 1 ? 1 : 0;
  if (!channels || (bpc !== 8 && bpc !== 1) || !w || !h) {
    throw new PdfImageError("이 PDF의 스캔 사진 색 형식은 아직 읽을 수 없습니다. 스캐너를 회색조/컬러 JPEG로 저장하도록 바꿔 주세요.");
  }
  const rowBytes = Math.ceil((w * channels * bpc) / 8);
  const parms = subDict(o.dict, "DecodeParms") ?? "";
  if ((num(parms, "Predictor") ?? 1) >= 10) data = undoPngPredictor(data, rowBytes, Math.max(1, (channels * bpc) >> 3));
  let pixels: Buffer;
  if (bpc === 1) {
    // 1비트 흑백 → 8비트 회색조 (PDF 기본: 0=검정, 1=흰색. /Decode [1 0]이면 반대)
    const invert = /\/Decode\s*\[\s*1\s+0\s*\]/.test(o.dict) || /\/ImageMask\s+true/.test(o.dict);
    pixels = Buffer.alloc(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const bit = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
        pixels[y * w + x] = (bit ^ (invert ? 1 : 0)) ? 255 : 0;
      }
    }
  } else {
    pixels = data.subarray(0, rowBytes * h);
  }
  const image = await sharp(pixels, { raw: { width: w, height: h, channels: channels as 1 | 3 } }).png().toBuffer();
  return { image, area: w * h };
}

/**
 * 스캔 PDF에서 페이지마다 가장 큰 사진 한 장을 페이지 순서대로 꺼낸다.
 * 사진이 하나도 없으면 빈 목록. 읽을 수 없는 방식뿐이면 PdfImageError.
 */
export async function extractPageImages(pdf: Buffer | Uint8Array): Promise<PageImage[]> {
  const b = Buffer.from(pdf);
  const objs = readObjects(b);
  const order = pageOrder(objs);
  // 페이지별 사진 묶음 (페이지 목록을 못 읽으면 파일 안 순서로 사진마다 한 페이지)
  const groups: number[][] = order.length
    ? order.map((p) => pageImageIds(objs, p).filter((id) => isImage(objs.get(id))))
    : [...objs.entries()].filter(([, o]) => isImage(o)).map(([id]) => [id]);

  const pages: PageImage[] = [];
  let firstError: PdfImageError | null = null;
  for (const ids of groups) {
    let best: { image: Buffer; area: number } | null = null;
    for (const id of ids) {
      const o = objs.get(id);
      if (!isImage(o)) continue;
      const w = num(o.dict, "Width") ?? 0;
      const h = num(o.dict, "Height") ?? 0;
      if (Math.min(w, h) < MIN_SIDE) continue; // 로고·도장 같은 작은 사진
      try {
        const d = await decodeImage(o, objs);
        if (!best || d.area > best.area) best = d;
      } catch (err) {
        if (err instanceof PdfImageError) firstError ??= err;
        else firstError ??= new PdfImageError("PDF 안의 스캔 사진이 손상되어 읽을 수 없습니다.");
      }
    }
    if (best) pages.push(best.image);
  }
  if (pages.length === 0 && firstError) throw firstError;
  return pages;
}
