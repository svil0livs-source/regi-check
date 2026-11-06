// Design Ref: DESIGN.md §4.4 — 페이지 사진 후보를 Tesseract가 읽을 수 있는 사진으로 만든다.
// 2026-11-05 보완: JPEG(DCTDecode)만 꺼내던 것을 넓혀
//   - Flate(무손실 압축) 회색조·컬러·흑백(1비트) 사진, 필터를 겹쳐 쓴 [Flate, DCT] 사진도 꺼낸다.
//   - 페이지 순서는 PDF의 페이지 목록(/Pages → /Kids) 순서를 따른다. 못 읽으면 파일 안 순서.
//   - 페이지마다 가장 큰 사진만 쓴다(로고·도장 같은 작은 사진은 페이지로 보지 않음).
//   - CCITT·JBIG2·JPEG2000 방식은 읽을 수 없다고 이유를 알린다(고치지 않고 「처리 실패」).
// 2026-11-06: 사진 후보 고르기는 브라우저와 함께 쓰도록 pdfPages.ts로 옮겼다. 여기서는 사진 만들기만 한다.
// 서버에서만 쓴다. 서류 내용은 로그에 남기지 않는다.
import "server-only";
import { inflateSync } from "node:zlib";
import sharp from "sharp";
import { filters, num, selectPageImages, subDict, type PageImageObject } from "./pdfPages";

/** 꺼낸 페이지 사진 (sharp가 읽을 수 있는 JPEG 또는 PNG) */
export type PageImage = Buffer;

/** 읽을 수 없는 사진 방식이 있을 때 */
export class PdfImageError extends Error {}

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
async function decodeImage(o: { dict: string; data: Buffer }): Promise<{ image: Buffer; area: number }> {
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
  const cs = /\/ImageMask\s+true/.test(o.dict) ? "DeviceGray" : /\/ColorSpace\s*\/(\w+)/.exec(o.dict)?.[1];
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
 * 페이지 사진 후보들에서 페이지마다 가장 큰(읽을 수 있는) 사진 한 장을 페이지 순서대로 만든다.
 * 후보가 하나도 없으면 빈 목록. 읽을 수 없는 방식뿐이면 PdfImageError.
 */
export async function decodePageImages(objects: PageImageObject[]): Promise<PageImage[]> {
  const byPage = new Map<number, PageImageObject[]>();
  for (const o of objects) byPage.set(o.page, [...(byPage.get(o.page) ?? []), o]);
  const pages: PageImage[] = [];
  let firstError: PdfImageError | null = null;
  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    let best: { image: Buffer; area: number } | null = null;
    for (const o of byPage.get(page)!) {
      try {
        const d = await decodeImage({ dict: o.dict, data: Buffer.from(o.data) });
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

/** 스캔 PDF 파일에서 페이지 사진을 바로 만든다 (시험·글자 읽기 실제 시험용) */
export const extractPageImages = (pdf: Buffer | Uint8Array): Promise<PageImage[]> => decodePageImages(selectPageImages(pdf));
