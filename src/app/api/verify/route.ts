// Design Ref: DESIGN.md §4.1 — 건 하나를 처리하는 서버 기능. 브라우저가 1건씩 부른다. (PLAN 10~11번)
// 2026-11-06: 파일당 6000KB까지 받으려고 원본 파일 대신 브라우저가 줄인 내용을 받는다.
// 요청: multipart/form-data { folder, fields(한글 서류 값 JSON), images(사진 정보 JSON), img0, img1, …(사진 자료) }
// 응답: { folder, summary, results, error? }  — 읽은 원문은 돌려주지 않는다.
import { MAX_REQUEST_BYTES, parseDocumentFields, parseImageMeta, toPageObjects } from "@/lib/verify/caseRequest";
import { processCase } from "@/lib/verify/processCase";

// 한 건 처리(등기부를 여러 번 읽음)가 오래 걸릴 수 있다. 배포 시 요금제 한도를 확인할 것.
export const maxDuration = 300;

const bad = (error: string, status = 400) => Response.json({ error }, { status });

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return bad("요청 형식이 올바르지 않습니다.");
  }

  const folder = String(form.get("folder") ?? "").slice(0, 300);
  const fieldsRaw = form.get("fields");
  const metaRaw = form.get("images");
  if (!folder || typeof fieldsRaw !== "string" || typeof metaRaw !== "string") {
    return bad("건 이름, 한글 서류 값, 등기부 사진 정보가 모두 필요합니다.");
  }
  const fields = parseDocumentFields(fieldsRaw);
  const meta = parseImageMeta(metaRaw);
  if (!fields || !meta) return bad("요청 형식이 올바르지 않습니다.");

  const data: Uint8Array[] = [];
  let total = 0;
  for (let i = 0; i < meta.length; i++) {
    const img = form.get(`img${i}`);
    if (!(img instanceof File)) return bad("등기부 사진 자료가 빠졌습니다.");
    total += img.size;
    if (total > MAX_REQUEST_BYTES) return bad("보낸 등기부 사진이 너무 큽니다.", 413);
    data.push(new Uint8Array(await img.arrayBuffer()));
  }

  const outcome = await processCase(folder, fields, toPageObjects(meta, data), request.signal);
  return Response.json(outcome);
}
