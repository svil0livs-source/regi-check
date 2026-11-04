// 한글 신청서 읽기 시험.
// 1) 글자 묶음에서 항목 뽑기 (서류 없이)
// 2) 시험용 가짜 서류 20건을 실제로 읽어 cases.json의 값과 같은지 (서류가 있을 때만)
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractHwpFields } from "./hwpFields";
import { HwpReadError, readHwpParagraphs } from "./hwpText";

const sample = [
  "근저당권이전등기신청",
  "이전등기 접수",
  "2026년 7월 19일 접수 제71426호",
  "부동산의 표시",
  "서울특별시 마포구 공덕동 45-9 (면적 1520.3㎡)",
  "서울특별시 마포구 공덕동 45-6 제2층 제201호 (면적 59.82㎡)",
  "이전할 근저당권",
  "2021년 7월 4일 접수 제57514호로 등기한 근저당권",
  "채권최고액",
  "금 322,000,000원",
  "채무자",
  "조모의, 김가명",
  "소유자",
  "조모의",
  "등기의무자 (양도인, 근저당권자)",
  "주식회사 사아자캐피탈",
  "등기권리자 (양수인)",
  "주식회사 러머버대부",
];

describe("extractHwpFields", () => {
  const d = extractHwpFields(sample);

  it("원·이전 접수번호와 날짜를 나눠 읽는다", () => {
    expect(d.receiptNumber.value).toBe("제57514호");
    expect(d.registrationDate.value).toBe("2021년 7월 4일");
    expect(d.transferReceiptNumber.value).toBe("제71426호");
    expect(d.transferRegistrationDate.value).toBe("2026년 7월 19일");
  });

  it("부동산 여러 개와 토지의 빈 호수를 읽는다", () => {
    expect(d.properties).toHaveLength(2);
    expect(d.properties[0]).toEqual({
      location: { value: "서울특별시 마포구 공덕동" },
      lotNumber: { value: "45-9" },
      unitNumber: { value: "" },
      area: { value: "1520.3㎡" },
    });
    expect(d.properties[1].unitNumber.value).toBe("제2층 제201호");
  });

  it("여러 명은 쉼표로 나눈다", () => {
    expect(d.parties.debtor.map((x) => x.value)).toEqual(["조모의", "김가명"]);
    expect(d.parties.mortgagee[0].value).toBe("주식회사 사아자캐피탈");
    expect(d.parties.assignee[0].value).toBe("주식회사 러머버대부");
  });

  it("칸이 없으면 추측하지 않고 읽지 못함(null)", () => {
    const e = extractHwpFields(["채권최고액", "금 1원"]);
    expect(e.receiptNumber.value).toBeNull();
    expect(e.transferRegistrationDate.value).toBeNull();
    expect(e.parties.owner).toEqual([]);
  });

  it("부동산 줄 형식을 모르면 칸을 나누지 않는다", () => {
    const e = extractHwpFields(["부동산의 표시", "알 수 없는 형식"]);
    expect(e.properties[0].location.value).toBeNull();
  });
});

describe("readHwpParagraphs", () => {
  it("한글 파일이 아니면 오류", () => {
    expect(() => readHwpParagraphs(Buffer.from("not a hwp"))).toThrow(HwpReadError);
  });
});

// ── 시험용 가짜 서류로 실제 읽기 ──
const root = process.cwd();
const dataPath = join(root, "tests", "fixtures-build", "cases.json");
type RawCase = { folder: string; hwp: Record<string, unknown> & { parties: Record<string, string[]>; properties: Record<string, string>[] } };
const cases: RawCase[] = existsSync(dataPath) ? JSON.parse(readFileSync(dataPath, "utf8")) : [];

describe.skipIf(cases.length === 0)("시험용 한글 신청서 20건을 실제로 읽기", () => {
  it.each(cases.map((c) => [c.folder, c] as const))("%s", (folder, c) => {
    const file = readFileSync(join(root, "tests", "fixtures", folder, "근저당권이전_신청서.hwp"));
    const d = extractHwpFields(readHwpParagraphs(file));
    const h = c.hwp;
    for (const role of ["mortgagee", "assignee", "debtor", "owner"] as const) {
      expect(d.parties[role].map((x) => x.value), role).toEqual(h.parties[role]);
    }
    expect(d.properties.map((p) => ({ location: p.location.value, lotNumber: p.lotNumber.value, unitNumber: p.unitNumber.value, area: p.area.value }))).toEqual(h.properties);
    for (const k of ["maxClaimAmount", "receiptNumber", "transferReceiptNumber", "registrationDate", "transferRegistrationDate"] as const) {
      expect(d[k].value, k).toBe(h[k]);
    }
  });
});
