// 한글 신청서 읽기 시험.
// 1) 글자 묶음에서 항목 뽑기 (서류 없이)
// 2) 시험용 가짜 서류 20건을 실제로 읽어 cases.json의 값과 같은지 (서류가 있을 때만)
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractHwpFields } from "./hwpFields";
import { HwpReadError, readHwpParagraphs } from "./hwpText";

// 사용자가 준 신청서 양식(2026-11-05)을 이전등기에 맞춘 모양. 한글 파일에서 꺼낸 글자 순서 그대로.
const sample = [
  "근저당권이전등기신청",
  "접 수",
  "2026년 7월 19일",
  "처리인",
  "접 수",
  "기 입",
  "교 합",
  "각종 통지",
  "제71426호",
  "① 부동산의 표시",
  "1동의 건물의 표시",
  "서울특별시 마포구 공덕동 45-6 시험빌라 가동",
  "[도로명주소] 서울특별시 마포구 시험길 8",
  "전유부분의 건물의 표시",
  "건물의 번호 제2층 제201호",
  "구 조 철근콘크리트조",
  "면 적 2층 201호 59.82㎡",
  "대지권의 표시",
  "토지의 표시 1. 서울특별시 마포구 공덕동 45-6 대 860㎡",
  "대지권의 종류 소유권",
  "대지권의 비율 860분의 41.2",
  "이 상",
  "② 등기원인과 그 연월일",
  "2026년 7월 19일 확정채권양도",
  "③ 등기의 목적",
  "근저당권이전",
  "④ 이전할 근저당권",
  "2021년 7월 4일 접수 제57514호로 등기한 순위 제1번 근저당권",
  "채권최고액 금 322,000,000원",
  "채무자 조모의, 김가명",
  "근저당권설정자(소유자) 조모의",
  "구분",
  "성 명 (상호·명칭)",
  "주민등록번호 (등기용등록번호)",
  "주 소 (소재지)",
  "⑤ 등기의무자",
  "주식회사 사아자캐피탈",
  "근저당권자(양도인)",
  "110111-1087115",
  "서울특별시 종로구 가상길 5",
  "⑥ 등기권리자",
  "주식회사 러머버대부",
  "근저당권 양수인",
  "110111-1079196",
  "서울특별시 서초구 시험대로 10",
  "⑦ 등록면허세",
  "금 6,000원",
];

describe("extractHwpFields", () => {
  const d = extractHwpFields(sample);

  it("원 접수번호·날짜는 ④에서, 이전 접수번호·날짜는 맨 위 접수 칸에서 읽는다", () => {
    expect(d.receiptNumber.value).toBe("제57514호");
    expect(d.registrationDate.value).toBe("2021년 7월 4일");
    expect(d.transferReceiptNumber.value).toBe("제71426호");
    expect(d.transferRegistrationDate.value).toBe("2026년 7월 19일");
  });

  it("부동산: 1동 건물의 소재·지번, 전유부분의 건물번호·면적 (대지권 토지 면적·건물명칭은 쓰지 않음)", () => {
    expect(d.properties).toEqual([
      {
        location: { value: "서울특별시 마포구 공덕동" },
        lotNumber: { value: "45-6" },
        unitNumber: { value: "제2층 제201호" },
        area: { value: "59.82㎡" },
      },
    ]);
  });

  it("채권최고액, 여러 명의 채무자, 소유자를 ④에서 읽는다", () => {
    expect(d.maxClaimAmount.value).toBe("금 322,000,000원");
    expect(d.parties.debtor.map((x) => x.value)).toEqual(["조모의", "김가명"]);
    expect(d.parties.owner.map((x) => x.value)).toEqual(["조모의"]);
  });

  it("⑤·⑥은 성명만 읽고 역할 표시·등록번호·주소는 읽지 않는다", () => {
    expect(d.parties.mortgagee.map((x) => x.value)).toEqual(["주식회사 사아자캐피탈"]);
    expect(d.parties.assignee.map((x) => x.value)).toEqual(["주식회사 러머버대부"]);
    expect(JSON.stringify(d)).not.toContain("110111-");
  });

  it("부동산이 여러 개면 '1. 1동의 건물의 표시'마다 하나씩", () => {
    const two = extractHwpFields([
      "① 부동산의 표시",
      "1. 1동의 건물의 표시",
      "서울특별시 강남구 역삼동 123-4 가상아파트 101동",
      "건물의 번호 제10층 제1001호",
      "면 적 84.97㎡",
      "2. 1동의 건물의 표시",
      "서울특별시 강남구 역삼동 123-5 가상아파트 102동",
      "건물의 번호 제3층 제301호",
      "면 적 59.10㎡",
      "② 등기원인과 그 연월일",
    ]);
    expect(two.properties.map((p) => [p.lotNumber.value, p.unitNumber.value, p.area.value])).toEqual([
      ["123-4", "제10층 제1001호", "84.97㎡"],
      ["123-5", "제3층 제301호", "59.10㎡"],
    ]);
  });

  it("칸이 없으면 추측하지 않고 읽지 못함(null)", () => {
    const e = extractHwpFields(["④ 이전할 근저당권", "채권최고액 금 1원"]);
    expect(e.receiptNumber.value).toBeNull();
    expect(e.transferRegistrationDate.value).toBeNull();
    expect(e.parties.owner).toEqual([]);
    expect(e.properties).toEqual([]);
  });

  it("1동 건물 줄 형식을 모르면 소재·지번을 나누지 않는다", () => {
    const e = extractHwpFields(["① 부동산의 표시", "1동의 건물의 표시", "알 수 없는 형식", "② 등기원인과 그 연월일"]);
    expect(e.properties[0].location.value).toBeNull();
    expect(e.properties[0].lotNumber.value).toBeNull();
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
