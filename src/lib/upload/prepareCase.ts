// 건 하나를 서버로 보낼 준비를 브라우저에서 한다 (2026-11-06, 파일당 6000KB까지 받기 위해).
// 배포본(Vercel)은 요청 하나가 약 4.5MB를 넘으면 받지 못하므로 원본 파일을 통째로 보내지 않는다.
//   1) 한글 파일: 여기서 읽어 대조 항목 값만 보낸다 (주민·법인등록번호는 앞 6자리만, 원문은 보내지 않음)
//   2) 등기부 PDF: 페이지 사진만 꺼내 그대로 보낸다. 한도를 넘으면 회색조 JPEG로 다시 저장해 줄인다 (fitImages.ts)
// 읽은 글자는 이 함수 안에서만 쓰고 버린다. 로그에 남기지 않는다.
import { isHangulFile, readHangulParagraphs } from "@/lib/readers/hangulFile";
import { extractHwpFields } from "@/lib/readers/hwpFields";
import { HwpReadError } from "@/lib/readers/hwpText";
import { selectPageImages, type PageImageObject } from "@/lib/readers/pdfPages";
import { MAX_REQUEST_BYTES, type ImageMeta } from "@/lib/verify/caseRequest";
import { fitImages, grayJpegDict, type Reencode } from "./fitImages";

export type PreparedCase =
  | { ok: true; body: FormData; reencoded: boolean }
  | { ok: false; summary: "file_problem" | "processing_failed"; error: string };

/** 요청 안 칸마다 붙는 머리말 몫 (넉넉히) */
const PART_OVERHEAD = 200;

const isPdf = (b: Uint8Array) => String.fromCharCode(...b.subarray(0, 5)) === "%PDF-";

/** 브라우저 그림판(canvas)으로 회색조 JPEG를 다시 만든다. 사진 크기(픽셀)는 그대로 */
export const canvasReencode: Reencode = async (o, quality) => {
  try {
    const bitmap = await createImageBitmap(new Blob([o.data as BlobPart], { type: "image/jpeg" }));
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const px = img.data;
    for (let i = 0; i < px.length; i += 4) {
      // 회색조 (서버의 sharp.greyscale과 같은 비율)
      const y = Math.round(0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]);
      px[i] = px[i + 1] = px[i + 2] = y;
    }
    ctx.putImageData(img, 0, 0);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", quality));
    if (!blob) return null;
    return { page: o.page, dict: grayJpegDict(canvas.width, canvas.height), data: new Uint8Array(await blob.arrayBuffer()) };
  } catch {
    return null;
  }
};

const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

export async function prepareCase(folder: string, hwpFile: Blob, pdfFile: Blob, reencode: Reencode = canvasReencode): Promise<PreparedCase> {
  const fail = (error: string): PreparedCase => ({ ok: false, summary: "processing_failed", error });

  // 1) 한글 파일 → 대조 항목 값
  const hwpBytes = new Uint8Array(await hwpFile.arrayBuffer());
  if (!isHangulFile(hwpBytes)) return fail("한글 파일 형식이 아닙니다. (.hwp·.hwpx·.hml을 받습니다)");
  let fieldsJson: string;
  try {
    fieldsJson = JSON.stringify(extractHwpFields(readHangulParagraphs(hwpBytes)));
  } catch (err) {
    return fail(err instanceof HwpReadError ? err.message : "한글 파일을 읽지 못했습니다. 한글에서 다시 저장해 올려 주세요.");
  }

  // 2) 등기부 PDF → 페이지 사진
  const pdfBytes = new Uint8Array(await pdfFile.arrayBuffer());
  if (!isPdf(pdfBytes)) return fail("등기부등본 파일이 PDF 형식이 아닙니다.");
  let images: PageImageObject[];
  try {
    images = selectPageImages(pdfBytes);
  } catch {
    return fail("등기부등본 PDF가 손상되어 읽을 수 없습니다.");
  }
  if (images.length === 0) return fail("스캔 사진이 들어 있는 PDF가 아니어서 읽을 수 없습니다. 스캐너로 만든 PDF를 넣어 주세요.");

  const metaSize = (list: PageImageObject[]) => JSON.stringify(list.map((o) => ({ page: o.page, dict: o.dict }))).length;
  const budget = MAX_REQUEST_BYTES - new Blob([fieldsJson, folder]).size - metaSize(images) * 2 - PART_OVERHEAD * (images.length + 4);
  const fit = await fitImages(images, budget, reencode);
  if (!fit.ok) {
    return {
      ok: false,
      summary: "file_problem",
      error: `등기부등본 사진이 커서 줄여도 ${mb(fit.bytes)}MB — 서버로 보낼 수 있는 크기(약 ${mb(budget)}MB)를 넘음. 필요한 페이지만 담거나 회색조로 다시 스캔해 주세요.`,
    };
  }

  const body = new FormData();
  body.set("folder", folder);
  body.set("fields", fieldsJson);
  body.set("images", JSON.stringify(fit.images.map((o): ImageMeta => ({ page: o.page, dict: o.dict }))));
  fit.images.forEach((o, i) => body.set(`img${i}`, new Blob([o.data as BlobPart]), `p${i}`));
  return { ok: true, body, reencoded: fit.reencoded };
}
