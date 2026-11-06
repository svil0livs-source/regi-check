// 등기부 사진을 요청 한도 안에 맞춘다 (2026-11-06, 파일당 6000KB까지 받기 위해).
// 원칙: 한도 안이면 사진을 전혀 고치지 않고 그대로 보낸다.
//       넘을 때만 JPEG 사진을 회색조로 바꿔 다시 저장한다(글자 읽기는 어차피 회색조로 읽는다).
//       화질은 높은 것부터 차례로 낮춰 보고, 가장 낮은 화질로도 넘으면 줄이지 않고 알린다.
// 화면과 분리된 순수 함수 (다시 저장하는 방법은 밖에서 넘겨받는다). 사진 크기(픽셀)는 줄이지 않는다.
import type { PageImageObject } from "@/lib/readers/pdfPages";
import { filters } from "@/lib/readers/pdfPages";

/** 다시 저장할 때 써 볼 JPEG 화질 (높은 것부터) */
export const JPEG_QUALITIES = [0.92, 0.85, 0.75];

/** 사진 하나를 회색조 JPEG로 다시 저장하는 방법. 못 하면 null */
export type Reencode = (o: PageImageObject, quality: number) => Promise<PageImageObject | null>;

export type FitResult =
  | { ok: true; images: PageImageObject[]; reencoded: boolean }
  | { ok: false; bytes: number };

const total = (list: PageImageObject[]) => list.reduce((s, o) => s + o.data.byteLength, 0);
/** 다시 저장할 수 있는 사진: JPEG 하나로만 압축된 것 */
const isPlainJpeg = (o: PageImageObject) => {
  const fs = filters(o.dict);
  return fs.length === 1 && fs[0] === "DCTDecode";
};

export async function fitImages(images: PageImageObject[], budget: number, reencode: Reencode): Promise<FitResult> {
  if (total(images) <= budget) return { ok: true, images, reencoded: false };
  let best = images;
  for (const q of JPEG_QUALITIES) {
    const next: PageImageObject[] = [];
    for (const o of images) {
      const r = isPlainJpeg(o) ? await reencode(o, q) : null;
      next.push(r && r.data.byteLength < o.data.byteLength ? r : o);
    }
    best = next;
    if (total(next) <= budget) return { ok: true, images: next, reencoded: true };
  }
  return { ok: false, bytes: total(best) };
}

/** 다시 저장한 회색조 JPEG의 사진 사전 */
export const grayJpegDict = (width: number, height: number) =>
  `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /DCTDecode`;
