// 엑셀 청구서 읽기와 한꺼번에 올린 파일 나누기 시험. __fixtures__의 엑셀은 가상 자료(LibreOffice로 저장, 수식 계산 결과 포함).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { assignCostFiles } from "./assign";
import { compareCosts } from "./compare";
import { isDateFormat, parseClaimSheets, readWorkbook } from "./excel";
import { parseReceiptPage } from "./parse";

const fx = (f: string) => new Uint8Array(readFileSync(join(__dirname, "__fixtures__", f)));
const line = (text: string) => ({ text, words: text.split(/\s+/).map((w) => ({ text: w, confidence: 95 })) });

describe("엑셀 청구서 읽기", () => {
  for (const f of ["claim.xlsx", "claim.xls"]) {
    it(`${f}: 항목·금액·합계를 읽고 날짜·수량·번호는 금액으로 보지 않는다, 숨긴 시트는 뺀다`, () => {
      const sheets = readWorkbook(fx(f));
      expect(sheets.map((s) => s.name)).toEqual(["비용청구서"]);
      expect(sheets[0].rows[1]).toEqual(["청구일", "2026-11-12"]);
      const { claim, pages } = parseClaimSheets(sheets);
      expect(claim.items.map((i) => [i.label, i.category, i.amount.value, i.amount.uncertain, i.row])).toEqual([
        ["등록면허세", "registration_tax", 150000, false, 5],
        ["지방교육세", "education_tax", 30000, false, 6],
        ["국민주택채권 할인료", "housing_bond", 12345, false, 7],
        ["등기신청수수료", "court_fee", 15000, false, 8],
        ["등기사항증명서 열람", "certificate", 700, false, 9],
        ["보수", "fee", 300000, false, 10],
        ["부가가치세", "fee", 30000, false, 11],
      ]);
      expect(claim.total?.value).toBe(538045);
      expect(pages).toEqual([{ page: 1, source: "text", found: 7 }]);
    });
  }

  it(".xls: 공유 글자표가 여러 레코드에 걸쳐도 끝까지 읽는다", () => {
    const rows = readWorkbook(fx("long.xls"))[0].rows;
    expect(rows.length).toBe(1500);
    expect(rows[1499]).toEqual(["가상 항목 이름 1499 가나다라마바사아자차카타파하", 1500000]);
  });

  it(".xlsx: 직접 쓴 글자 칸·공유 글자·읽는 법 표시를 처리한다", () => {
    const zip = zipSync({
      "xl/workbook.xml": strToU8('<workbook><sheets><sheet name="청구" sheetId="1" r:id="rId1"/></sheets></workbook>'),
      "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
      "xl/sharedStrings.xml": strToU8('<sst><si><r><t>인지</t></r><r><t>세</t></r><rPh><t>いんじ</t></rPh></si></sst>'),
      "xl/worksheets/sheet1.xml": strToU8(
        '<worksheet><sheetData><row r="2"><c r="A2" t="s"><v>0</v></c><c r="C2"><v>18000</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>우편료 &amp; 송달료</t></is></c><c r="B3"><v>5200</v></c></row></sheetData></worksheet>',
      ),
    });
    const sheets = readWorkbook(zip);
    expect(sheets[0].rows[1]).toEqual(["인지세", null, 18000]);
    const { claim } = parseClaimSheets(sheets);
    expect(claim.items.map((i) => [i.category, i.amount.value, i.row])).toEqual([
      ["stamp_tax", 18000, 2],
      ["postage", 5200, 3],
    ]);
  });

  it("엑셀이 아닌 파일은 알려 준다", () => {
    expect(() => readWorkbook(new Uint8Array([1, 2, 3, 4]))).toThrow("엑셀 파일");
  });

  it("날짜 서식 판별", () => {
    expect(isDateFormat(14, undefined)).toBe(true);
    expect(isDateFormat(31, undefined)).toBe(true);
    expect(isDateFormat(3, undefined)).toBe(false);
    expect(isDateFormat(176, 'yyyy"년" m"월" d"일"')).toBe(true);
    expect(isDateFormat(177, '#,##0"원"')).toBe(false);
    expect(isDateFormat(178, "[$-412]General")).toBe(false);
  });

  it("엑셀 청구서와 글자 PDF 영수증을 끝까지 대조한다", () => {
    const { claim, pages } = parseClaimSheets(readWorkbook(fx("claim.xlsx")));
    const receipts = parseReceiptPage(
      [
        line("지방세 납부확인서"),
        line("강남구청 납부일자 2026-11-10"),
        line("등록면허세 150,000원"),
        line("지방교육세 30,000원"),
        line("합계 180,000원"),
      ],
      1,
    );
    const res = compareCosts(claim, receipts, { claim: pages, receipts: [{ page: 1, source: "text", found: 1 }] });
    const byCat = Object.fromEntries(res.rows.map((r) => [r.category, r.status]));
    expect(byCat).toMatchObject({ registration_tax: "match", education_tax: "match", housing_bond: "missing" });
    expect(res.feeItems.length).toBe(2);
    expect(res.summary).toBe("불일치 있음");
  });
});

describe("한꺼번에 올린 파일 나누기", () => {
  const f = (name: string) => ({ name });
  it("엑셀은 청구서, PDF는 영수증", () => {
    const r = assignCostFiles([f("영수증 묶음.pdf"), f("2026-11 홍길동.xlsx"), f("메모.txt")]);
    expect([r.claim?.name, r.receipt?.name, r.error, r.ignored]).toEqual(["2026-11 홍길동.xlsx", "영수증 묶음.pdf", undefined, 1]);
    expect(assignCostFiles([f("a.xls"), f("b.pdf")]).receipt?.name).toBe("b.pdf");
  });
  it("PDF 두 개는 이름으로만 나눈다", () => {
    expect(assignCostFiles([f("스캔.pdf"), f("비용청구서.pdf")])).toMatchObject({ claim: { name: "비용청구서.pdf" }, receipt: { name: "스캔.pdf" } });
    expect(assignCostFiles([f("비용 영수증.pdf"), f("문서.pdf")])).toMatchObject({ claim: { name: "문서.pdf" }, receipt: { name: "비용 영수증.pdf" } });
    expect(assignCostFiles([f("1.pdf"), f("2.pdf")]).error).toContain("파일 이름으로 알 수 없습니다");
    expect(assignCostFiles([f("청구서.pdf"), f("청구서2.pdf")]).error).toBeDefined();
  });
  it("여러 건이 섞이면 막는다", () => {
    expect(assignCostFiles([f("a.xlsx"), f("b.xlsx")]).error).toContain("여러 개");
    expect(assignCostFiles([f("a.xlsx"), f("b.pdf"), f("c.pdf")]).error).toContain("영수증 PDF가 여러 개");
    expect(assignCostFiles([f("a.xlsx"), f("b.pdf"), f("c 영수증.pdf")]).receipt?.name).toBe("c 영수증.pdf");
    expect(assignCostFiles([f("x.txt")]).error).toBeDefined();
  });
});
