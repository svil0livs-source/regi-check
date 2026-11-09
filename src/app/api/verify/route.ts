// Design Ref: DESIGN.md §4.1 — 건 하나를 처리하는 서버 기능. 브라우저가 1건씩 부른다. (PLAN 10~11번)
// 2026-11-06: 요청 한도(약 4.5MB) 때문에 원본 파일 대신 브라우저가 줄인 내용을 받는다. 파일 크기 한도는 없앴다.
// 2026-11-06: 오래 걸려도 끝까지 처리하도록 한 건을 여러 요청으로 나눈다(요청마다 서버 한도 300초).
//   1) step=read : { folder, pass(0부터), images(사진 정보 JSON), img0, img1, … } → { ok, read, total } 또는 { ok:false, outcome }
//      read는 대조 항목 값만 담는다(읽은 원문은 돌려주지 않음). 브라우저가 pass를 0부터 total-1까지 부른다.
//      큰 등기부는 한 번 읽기를 조각으로 나눈다: chunk(0부터), last(마지막 조각이면 "1"), carry(앞 조각이 준 꾸러미).
//      마지막이 아닌 조각은 { ok, carry }를 돌려준다(읽은 줄을 서버만 열 수 있게 암호화한 것, readCarry.ts).
//   2) step=compare : { folder, fields(한글 서류 값 JSON), reads(모은 read 목록 JSON) } → { folder, summary, results }
//      2026-11-09: reads 대신 readGroups(read 목록의 목록)도 받는다. 묶음마다 다수결한 뒤 합친다
//      (스캔본 읽기 묶음 + 글자 PDF를 브라우저가 바로 읽은 결과. 한 건에 등기부 PDF 여러 개)
import { MAX_REQUEST_BYTES, parseDocumentFields, parseImageMeta, parseRegistryReadGroups, parseRegistryReads, toPageObjects } from "@/lib/verify/caseRequest";
import { compareCase, readCasePass } from "@/lib/verify/processCase";

// 읽기 한 번이 오래 걸릴 수 있다. 배포 시 요금제 한도를 확인할 것.
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
  const step = form.get("step");
  if (!folder) return bad("건 이름이 필요합니다.");

  if (step === "compare") {
    const fieldsRaw = form.get("fields");
    const readsRaw = form.get("reads");
    const groupsRaw = form.get("readGroups");
    if (typeof fieldsRaw !== "string" || (typeof readsRaw !== "string" && typeof groupsRaw !== "string")) return bad("한글 서류 값과 읽은 결과가 모두 필요합니다.");
    const fields = parseDocumentFields(fieldsRaw);
    const groups = typeof groupsRaw === "string" ? parseRegistryReadGroups(groupsRaw) : (() => {
      const reads = parseRegistryReads(readsRaw as string);
      return reads ? [reads] : null;
    })();
    if (!fields || !groups) return bad("요청 형식이 올바르지 않습니다.");
    return Response.json(compareCase(folder, fields, groups));
  }

  if (step !== "read") return bad("처리 단계(step)가 올바르지 않습니다.");
  const pass = Number(form.get("pass"));
  const chunk = Number(form.get("chunk") ?? 0);
  const last = (form.get("last") ?? "1") === "1";
  const carry = form.get("carry");
  const metaRaw = form.get("images");
  if (!Number.isInteger(pass) || pass < 0 || typeof metaRaw !== "string") return bad("읽기 순서와 등기부 사진 정보가 모두 필요합니다.");
  if (!Number.isInteger(chunk) || chunk < 0 || (carry !== null && typeof carry !== "string")) return bad("나눠 읽기 정보가 올바르지 않습니다.");
  const meta = parseImageMeta(metaRaw);
  if (!meta) return bad("요청 형식이 올바르지 않습니다.");

  const data: Uint8Array[] = [];
  let total = 0;
  for (let i = 0; i < meta.length; i++) {
    const img = form.get(`img${i}`);
    if (!(img instanceof File)) return bad("등기부 사진 자료가 빠졌습니다.");
    total += img.size;
    if (total > MAX_REQUEST_BYTES) return bad("보낸 등기부 사진이 너무 큽니다.", 413);
    data.push(new Uint8Array(await img.arrayBuffer()));
  }

  return Response.json(await readCasePass(folder, toPageObjects(meta, data), { pass, chunk, last, carry: carry ?? undefined }, request.signal));
}
