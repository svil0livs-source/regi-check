// 브라우저에서 건 하나를 서버로 보낼 준비 시험 (2026-11-06)
// 한글 파일은 값만, 등기부 PDF는 페이지 사진만 보내는지, 그리고 서버가 그 요청을 그대로 받는지 확인한다.
import { describe, expect, it, vi } from "vitest";
import { MAX_REQUEST_BYTES, parseDocumentFields, parseImageMeta } from "@/lib/verify/caseRequest";
import type { PageImageObject } from "@/lib/readers/pdfPages";
import { BLANK_FORM_MESSAGE, prepareCase } from "./prepareCase";
import { PAGE_ROOM, readBody } from "./readRequests";

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
    const r = await prepareCase(HWP, pdf(1000));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const fields = r.fields;
    expect(fields).not.toContain("1234567");
    const parsed = parseDocumentFields(fields);
    expect(parsed?.mortgageeIdFront.value).toBe("110111");
    expect(parsed?.parties.mortgagee[0].value).toBe("주식회사 가나은행");
    const body = readBody("2026-0001", r.images, { pass: 0, chunk: 0, last: true });
    const meta = parseImageMeta(String(body.get("images")));
    expect(meta).toHaveLength(1);
    expect((body.get("img0") as Blob).size).toBe(1000);
    expect(r.reencoded).toBe(false);
  });

  it("페이지 하나가 한 요청에 안 들어갈 때만 줄인다", async () => {
    const reencode = vi.fn(async (o: PageImageObject) => ({ ...o, dict: o.dict.replace("DeviceRGB", "DeviceGray"), data: new Uint8Array(1000) }));
    const fits = await prepareCase(HWP, pdf(PAGE_ROOM - 1000), reencode);
    expect(fits.ok && fits.reencoded).toBe(false);
    expect(reencode).not.toHaveBeenCalled();
    const r = await prepareCase(HWP, pdf(MAX_REQUEST_BYTES + 1));
    expect(r).toMatchObject({ ok: false, summary: "file_problem" });
    const shrunk = await prepareCase(HWP, pdf(MAX_REQUEST_BYTES + 1), reencode);
    expect(shrunk.ok && shrunk.reencoded).toBe(true);
    if (shrunk.ok) expect(shrunk.images[0].data.byteLength).toBe(1000);
  });

  it("빈 양식이면 등기부를 읽지 않고 처리 실패로 알린다 (2026-11-07)", async () => {
    const blank = hml(["채 권 양 도 인", "이전할 근저당권", "년 월 일 접수 제 호 순위 제 번으로 등기한 근저당권설정등기", "(채권최고액 : 금 원)", "채 무 자"]);
    expect(await prepareCase(blank, pdf(10))).toEqual({ ok: false, summary: "processing_failed", error: BLANK_FORM_MESSAGE });
  });

  it("한글 파일·PDF 형식이 아니면 처리 실패로 이유를 알린다", async () => {
    expect(await prepareCase(new Blob(["hello"]), pdf(10))).toMatchObject({ ok: false, summary: "processing_failed", error: expect.stringContaining("한글 파일 형식") });
    expect(await prepareCase(HWP, new Blob(["hello"]))).toMatchObject({ ok: false, error: expect.stringContaining("PDF 형식") });
  });
});

describe("parseDocumentFields", () => {
  it("모양이 틀리거나 등록번호 뒷자리가 섞이면 받지 않는다", async () => {
    const r = await prepareCase(HWP, pdf(10));
    if (!r.ok) throw new Error("준비 실패");
    const good = JSON.parse(r.fields);
    expect(parseDocumentFields(JSON.stringify({ ...good, mortgageeIdFront: { value: "1101111234567" } }))).toBeNull();
    expect(parseDocumentFields(JSON.stringify({ ...good, properties: "x" }))).toBeNull();
    expect(parseDocumentFields("not json")).toBeNull();
    expect(parseImageMeta(JSON.stringify([{ page: 0, dict: "/Type /Page" }]))).toBeNull();
  });
});

describe("prepareCase: 글자 PDF·등기부 여러 개 (2026-11-09)", () => {
  /** 글자만 있는 PDF 흉내 (사진 없음) */
  const textPdf = () => new Blob(["%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n"]);
  const piece = (str: string, y: number) => ({ str, x: 20, y, width: str.length * 10, height: 10 });
  const landPage = [
    piece("【 표 제 부 】  ( 토지의 표시 )", 800),
    piece("1  2001년3월2일  서울특별시 가상구 나라동 123-4  대  210.5㎡", 780),
    piece("【 갑 구 】  ( 소유권에 관한 사항 ) " + "가".repeat(200), 760),
    piece("【 을 구 】", 740),
  ];

  it("스캔 사진이 없으면 글자를 바로 읽어 대조 항목 값만 남긴다 (서버로 보낼 사진 없음)", async () => {
    const readText = vi.fn(async () => [landPage]);
    const r = await prepareCase(HWP, textPdf(), undefined, readText);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.images).toHaveLength(0);
    expect(r.textRead?.properties.map((p) => [p.location.text, p.lotNumber.text, p.area.text])).toEqual([["서울특별시 가상구 나라동", "123-4", "210.5㎡"]]);
  });

  it("글자도 사진도 없으면 처리 실패", async () => {
    const r = await prepareCase(HWP, textPdf(), undefined, async () => [[piece("1/1", 10)]]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.summary).toBe("processing_failed");
  });

  it("스캔 PDF 여러 개는 쪽 번호를 이어 붙이고, 글자 PDF가 섞여 있으면 따로 읽는다", async () => {
    const r = await prepareCase(HWP, [pdf(1000), pdf(1000), textPdf()], undefined, async () => [landPage]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.images.map((o) => o.page)).toEqual([0, 1]);
    expect(r.textRead?.properties).toHaveLength(1);
  });
});
