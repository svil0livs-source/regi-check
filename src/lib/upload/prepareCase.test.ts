// 브라우저에서 건 하나를 서버로 보낼 준비 시험 (2026-11-06)
// 한글 파일은 값만, 등기부 PDF는 페이지 사진만 보내는지, 그리고 서버가 그 요청을 그대로 받는지 확인한다.
import { describe, expect, it, vi } from "vitest";
import { MAX_REQUEST_BYTES, parseDocumentFields, parseImageMeta } from "@/lib/verify/caseRequest";
import type { PageImageObject } from "@/lib/readers/pdfPages";
import { prepareCase } from "./prepareCase";

/** 한글 XML 문서(.hml): 문단마다 한 줄 */
const hml = (lines: string[]) =>
  new Blob([
    '<?xml version="1.0" encoding="UTF-8"?><HWPML><BODY><SECTION>' +
      lines.map((l) => `<P><TEXT><CHAR>${l}</CHAR></TEXT></P>`).join("") +
      "</SECTION></BODY></HWPML>",
  ]);

const HWP = hml(["채권 양도인", "주식회사 가나은행 (110111-1234567)", "채권 양수인", "한국자산관리공사"]);

/** 페이지 하나에 사진 하나인 PDF (사진 자료 크기를 정할 수 있게) */
function pdf(imageBytes: number): Blob {
  const head = "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n" +
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /XObject << /Im0 4 0 R >> >> >>\nendobj\n" +
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width 1654 /Height 2339 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imageBytes} >>\nstream\n`;
  const data = new Uint8Array(imageBytes).fill(0x41);
  return new Blob([head, data, "\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n"]);
}

describe("prepareCase", () => {
  it("한글 파일은 대조 항목 값만, 등록번호는 앞 6자리만 보낸다. 서버가 그 값을 그대로 받는다", async () => {
    const r = await prepareCase("2026-0001", HWP, pdf(1000));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const fields = String(r.body.get("fields"));
    expect(fields).not.toContain("1234567");
    const parsed = parseDocumentFields(fields);
    expect(parsed?.mortgageeIdFront.value).toBe("110111");
    expect(parsed?.parties.mortgagee[0].value).toBe("주식회사 가나은행");
    const meta = parseImageMeta(String(r.body.get("images")));
    expect(meta).toHaveLength(1);
    expect((r.body.get("img0") as Blob).size).toBe(1000);
    expect(r.reencoded).toBe(false);
  });

  it("사진이 요청 한도를 넘으면 줄여서 보낸다", async () => {
    const reencode = vi.fn(async (o: PageImageObject) => ({ ...o, dict: o.dict.replace("DeviceRGB", "DeviceGray"), data: new Uint8Array(1000) }));
    const r = await prepareCase("A", HWP, pdf(MAX_REQUEST_BYTES + 1));
    expect(r).toMatchObject({ ok: false, summary: "file_problem" });
    const shrunk = await prepareCase("A", HWP, pdf(MAX_REQUEST_BYTES + 1), reencode);
    expect(shrunk.ok && shrunk.reencoded).toBe(true);
    if (shrunk.ok) expect((shrunk.body.get("img0") as Blob).size).toBe(1000);
  });

  it("한글 파일·PDF 형식이 아니면 처리 실패로 이유를 알린다", async () => {
    expect(await prepareCase("A", new Blob(["hello"]), pdf(10))).toMatchObject({ ok: false, summary: "processing_failed", error: expect.stringContaining("한글 파일 형식") });
    expect(await prepareCase("A", HWP, new Blob(["hello"]))).toMatchObject({ ok: false, error: expect.stringContaining("PDF 형식") });
  });
});

describe("parseDocumentFields", () => {
  it("모양이 틀리거나 등록번호 뒷자리가 섞이면 받지 않는다", async () => {
    const r = await prepareCase("A", HWP, pdf(10));
    if (!r.ok) throw new Error("준비 실패");
    const good = JSON.parse(String(r.body.get("fields")));
    expect(parseDocumentFields(JSON.stringify({ ...good, mortgageeIdFront: { value: "1101111234567" } }))).toBeNull();
    expect(parseDocumentFields(JSON.stringify({ ...good, properties: "x" }))).toBeNull();
    expect(parseDocumentFields("not json")).toBeNull();
    expect(parseImageMeta(JSON.stringify([{ page: 0, dict: "/Type /Page" }]))).toBeNull();
  });
});
