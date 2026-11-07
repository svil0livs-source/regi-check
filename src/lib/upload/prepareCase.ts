// 건 하나를 서버로 보낼 준비를 브라우저에서 한다 (2026-11-06).
// 배포본(Vercel)은 요청 하나가 약 4.5MB를 넘으면 받지 못하므로 원본 파일을 통째로 보내지 않는다.
//   1) 한글 파일: 여기서 읽어 대조 항목 값만 보낸다 (주민·법인등록번호는 앞 6자리만, 원문은 보내지 않음)
//   2) 등기부 PDF: 페이지 사진만 꺼내 그대로 보낸다. 파일 크기 한도는 없고(2026-11-06 사용자 결정),
//      한 요청에 다 안 들어가면 몇 쪽씩 나눠 보낸다(readRequests.ts). 페이지 하나가 한 요청보다 클 때만
//      그 페이지를 회색조 JPEG로 다시 저장해 줄인다 (fitImages.ts)
// 읽은 글자는 이 함수 안에서만 쓰고 버린다. 로그에 남기지 않는다.
import { isHangulFile, readHangulParagraphs } from "@/lib/readers/hangulFile";
import { extractHwpFields, isBlankForm } from "@/lib/readers/hwpFields";
import { HwpReadError } from "@/lib/readers/hwpText";
import { selectPageImages, type PageImageObject } from "@/lib/readers/pdfPages";
import { fitImages, grayJpegDict, type Reencode } from "./fitImages";
import { groupByPage, imageCost, PAGE_ROOM } from "./readRequests";

export type PreparedCase =
  | { ok: true; fields: string; images: PageImageObject[]; reencoded: boolean }
  | { ok: false; summary: "file_problem" | "processing_failed"; error: string };

/** 빈 양식 안내 (2026-11-07) */
export const BLANK_FORM_MESSAGE = "한글 서류가 빈 양식입니다. 채무자·접수번호·채권최고액 등 대조할 값이 하나도 적혀 있지 않습니다. 작성을 마친 서류인지 확인해 주세요.";

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

export async function prepareCase(hwpFile: Blob, pdfFile: Blob, reencode: Reencode = canvasReencode): Promise<PreparedCase> {
  const fail = (error: string): PreparedCase => ({ ok: false, summary: "processing_failed", error });

  // 1) 한글 파일 → 대조 항목 값
  const hwpBytes = new Uint8Array(await hwpFile.arrayBuffer());
  if (!isHangulFile(hwpBytes)) return fail("한글 파일 형식이 아닙니다. (.hwp·.hwpx·.hml을 받습니다)");
  let fieldsJson: string;
  try {
    const fields = extractHwpFields(readHangulParagraphs(hwpBytes));
    // 빈 양식이면 등기부를 읽을 필요가 없다 (2026-11-07 사용자 결정)
    if (isBlankForm(fields)) return fail(BLANK_FORM_MESSAGE);
    fieldsJson = JSON.stringify(fields);
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

  // 페이지마다 한 요청에 들어가는지 본다. 넘는 페이지만 줄인다 (사진 크기(픽셀)는 그대로)
  const out: PageImageObject[] = [];
  let reencoded = false;
  for (const group of groupByPage(images)) {
    const extra = group.reduce((n, o) => n + imageCost(o) - o.data.byteLength, 0);
    const fit = await fitImages(group, PAGE_ROOM - extra, reencode);
    if (!fit.ok) {
      return {
        ok: false,
        summary: "file_problem",
        error: `등기부등본 ${group[0].page + 1}쪽 사진이 커서 줄여도 ${mb(fit.bytes)}MB — 한 번에 보낼 수 있는 크기(약 ${mb(PAGE_ROOM - extra)}MB)를 넘음. 회색조로 다시 스캔해 주세요.`,
      };
    }
    out.push(...fit.images);
    reencoded ||= fit.reencoded;
  }
  return { ok: true, fields: fieldsJson, images: out, reencoded };
}
