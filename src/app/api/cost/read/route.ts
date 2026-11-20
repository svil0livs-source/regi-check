// 비용 청구 검증: 스캔 페이지 사진 한 장을 읽어 항목·금액만 돌려준다 (2026-11-20). 근이전 검증(/api/verify)과 따로 둔다.
// 요청: { kind: "claim" | "receipt", page: 1부터, image: 회색조 JPEG/PNG } → { page, claim } 또는 { page, receipts }
// 글자 PDF 페이지는 브라우저가 글자를 바로 읽으므로 여기로 오지 않는다. 사진·읽은 글자는 서버에 남기지 않는다.
import { readClaimImage, readReceiptImage } from "@/lib/cost/costOcr";

export const maxDuration = 300;

/** 배포본 요청 한도(약 4.5MB) 안 */
const MAX_IMAGE_BYTES = 4_000_000;

const bad = (error: string, status = 400) => Response.json({ error }, { status });

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return bad("요청 형식이 올바르지 않습니다.");
  }
  const kind = form.get("kind");
  const page = Number(form.get("page"));
  const image = form.get("image");
  if (kind !== "claim" && kind !== "receipt") return bad("서류 종류(kind)가 올바르지 않습니다.");
  if (!Number.isInteger(page) || page < 1 || page > 2000) return bad("페이지 번호가 올바르지 않습니다.");
  if (!(image instanceof File) || !/^image\/(jpeg|png)$/.test(image.type)) return bad("페이지 사진이 필요합니다.");
  if (image.size > MAX_IMAGE_BYTES) return bad("페이지 사진이 너무 큽니다.", 413);

  const buf = Buffer.from(await image.arrayBuffer());
  try {
    if (kind === "claim") return Response.json({ page, claim: await readClaimImage(buf, page, request.signal) });
    return Response.json({ page, receipts: await readReceiptImage(buf, page, request.signal) });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return bad("처리가 취소됐습니다.", 499);
    // 서류 내용이 담길 수 있어 오류 내용은 남기지 않는다
    return bad("페이지를 읽지 못했습니다.", 500);
  }
}
