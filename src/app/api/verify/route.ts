// Design Ref: DESIGN.md §4.1 — 건 하나를 처리하는 서버 기능. 브라우저가 1건씩 부른다. (PLAN 10~11번)
// 요청: multipart/form-data { folder, hwp(파일), pdf(파일) }
// 응답: { folder, summary, results, error? }  — 읽은 원문은 돌려주지 않는다.
import { MAX_FILE_BYTES } from "@/lib/upload/checkFolders";
import { processCase } from "@/lib/verify/processCase";

// 한 건 처리(등기부를 여러 번 읽음)가 오래 걸릴 수 있다. 배포 시 요금제 한도를 확인할 것.
export const maxDuration = 300;

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const folder = String(form.get("folder") ?? "").slice(0, 200);
  const hwp = form.get("hwp");
  const pdf = form.get("pdf");
  if (!folder || !(hwp instanceof File) || !(pdf instanceof File)) {
    return Response.json({ error: "폴더 이름, 한글 파일, PDF 파일이 모두 필요합니다." }, { status: 400 });
  }
  if (hwp.size > MAX_FILE_BYTES || pdf.size > MAX_FILE_BYTES) {
    return Response.json({ error: "파일 하나의 크기는 20MB 이하여야 합니다." }, { status: 413 });
  }

  const outcome = await processCase(
    folder,
    Buffer.from(await hwp.arrayBuffer()),
    Buffer.from(await pdf.arrayBuffer()),
    request.signal,
  );
  return Response.json(outcome);
}
