// 한글 서류 읽기 시험 (2026-11-06 실제 양식: 위임장 + 확정채권 및 근저당권 양도증서).
// 글자 순서는 사용자가 준 양식 파일에서 꺼낸 그대로이고, 값만 가짜로 바꿨다.
import { describe, expect, it } from "vitest";
import { compareDocuments } from "@/lib/compare/compareDocuments";
import { extractHwpFields, isBlankForm } from "./hwpFields";
import { HwpReadError, readHwpParagraphs } from "./hwpText";

const sample = (mortgageLine: string) => [
  "", "위        임        장", "부", "동", "산", "의", "표", "시",
  "  1. 1동의 건물의 표시", "",
  "   경기도 시험시 가상구 나라동 255-1", "   시험오피스텔", "   [도로명주소]경기도 시험시 가상구 나라로 170", "",
  " 전유부분의 건물의 표시",
  "  1. 건물의 번호 : 제8층 제씨-809호[고유번호:1111-2004-000000]",
  "      구조 및 면적 : 철근콘크리트구조 80㎡",
  "    전유부분의 대지권의 표시", "      토지의 표시", "       1.경기도 시험시 가상구 나라동 255-1", "           대  18523.4㎡",
  "          대지권의 종류: 소유권", "          대지권의 비율: 18523.4분의 11.535",
  " 등기원인과 그연월일", "    2026년 10월 29일   확정채권양도",
  "등  기  의   목  적", "  근저당권 이전",
  "   이 전 할 근 저 당 권", mortgageLine, "  (채권최고액 : 금 504,000,000원)",
  "채권 양도인", "          가나다보험주식회사     (110111-1234567)", "          서울특별시 서초구 가상대로 1", "          (대표이사)이가명",
  "채권 양수인", "           한국자산관리공사           (114671-0023169)", "           부산광역시 남구 문현금융로 40(문현동)",
  "확정채권 및 근저당권 양도증서",
  "【부동산의 표시】", "   1. 1동의 건물의 표시", "", "   경기도 시험시 가상구 나라동 255-1",
  "【이전할 근저당권 및 채무자의 표시】", "이전할 근저당권", mortgageLine, "  (채권최고액 : 금 504,000,000원)",
  "채    무     자", "김가명", "경기도 시험시 가상구 나라로 170", "2026년     10월     29일",
];
const TWO = "   2020년03월13일 접수 제14475호 순위 제3번으로 등기한 근저당권설정등기, 2022년01월19일 접수 제2943호 순위 제4번으로 등기한 근저당권설정등기. 단, 근저당권은 채권과 함께 이전함.";
const ONE = "   2020년03월13일 접수 제14475호 순위 제3번으로 등기한 근저당권설정등기. 단, 근저당권은 채권과 함께 이전함.";

describe("extractHwpFields (양도증서)", () => {
  it("이전할 근저당권 2건의 접수일·접수번호·순위를 읽는다", () => {
    const d = extractHwpFields(sample(TWO));
    expect(d.mortgages.map((m) => [m.registrationDate.value, m.receiptNumber.value, m.rank.value])).toEqual([
      ["2020년03월13일", "제14475호", "3"],
      ["2022년01월19일", "제2943호", "4"],
    ]);
    expect(d.maxClaimAmount.value).toBe("금 504,000,000원");
  });

  it("근저당권 1건도 읽는다", () => {
    expect(extractHwpFields(sample(ONE)).mortgages).toHaveLength(1);
  });

  it("부동산: 소재지·지번, 건물 번호(고유번호 뺌), 전유부분 면적", () => {
    const p = extractHwpFields(sample(ONE)).properties;
    expect(p).toHaveLength(1);
    expect(p[0].location.value).toBe("경기도 시험시 가상구 나라동");
    expect(p[0].lotNumber.value).toBe("255-1");
    expect(p[0].unitNumber.value).toBe("제8층 제씨-809호");
    expect(p[0].area.value).toBe("80㎡");
  });

  it("양도인은 이름과 등록번호 앞 6자리만, 채무자는 이름만 읽는다", () => {
    const d = extractHwpFields(sample(ONE));
    expect(d.parties.mortgagee.map((x) => x.value)).toEqual(["가나다보험주식회사"]);
    expect(d.mortgageeIdFront.value).toBe("110111");
    expect(JSON.stringify(d)).not.toContain("1234567");
    expect(d.parties.debtor.map((x) => x.value)).toEqual(["김가명"]);
  });

  it("빈 양식은 추측하지 않고 읽지 못함(null)", () => {
    const d = extractHwpFields(["채권 양도인", "", "채    무     자", "2026년     월     일", "이전할 근저당권", ""]);
    expect(d.parties.mortgagee[0].value).toBeNull();
    expect(d.parties.debtor[0].value).toBeNull();
    expect(d.mortgages[0].receiptNumber.value).toBeNull();
    expect(compareDocuments(d, d).some((r) => r.status === "mismatch")).toBe(false);
  });
});

describe("extractHwpFields: 실제 서류에서 본 다른 줄 모양 (2026-11-09)", () => {
  it("면적이 「구조 및 면적」 다음 줄에 따로 있어도 읽는다", () => {
    const paras = sample(ONE).map((p) => (/구조 및 면적/.test(p) ? "      구조 및 면적 : 철근콘크리트구조" : p));
    paras.splice(paras.findIndex((p) => /구조 및 면적/.test(p)) + 1, 0, "      80.15㎡");
    expect(extractHwpFields(paras).properties[0].area.value).toBe("80.15㎡");
  });

  it("이전할 근저당권이 한 건씩 줄을 나눠 적혀 있어도 모두 읽는다", () => {
    const paras = sample(ONE).flatMap((p) =>
      p === ONE
        ? ["   2020년03월13일 접수 제14475호 순위 제3번으로 등기한 근저당권설정등기,", "   2022년01월19일 접수 제2943호 순위 제4번으로 등기한 근저당권설정등기."]
        : [p],
    );
    const f = extractHwpFields(paras);
    expect(f.mortgages.map((m) => m.receiptNumber.value)).toEqual(["제14475호", "제2943호"]);
    expect(f.maxClaimAmount.value).toBe("금 504,000,000원");
  });

  it("양도인 등록번호가 괄호 없이 다음 줄에 있어도 앞 6자리를 읽는다", () => {
    const paras = sample(ONE).flatMap((p) => (/가나다보험주식회사/.test(p) ? ["          가나다보험주식회사", "          110111-1234567"] : [p]));
    const f = extractHwpFields(paras);
    expect(f.parties.mortgagee[0].value).toBe("가나다보험주식회사");
    expect(f.mortgageeIdFront.value).toBe("110111");
  });
});

describe("extractHwpFields: 일반건물·토지 (2026-11-09 실제 서류 모양, 값은 가짜)", () => {
  it("「1. 건물」은 소재지·지번·층별 면적, 「2. 토지」는 소재지·지번·면적, 호수는 빈 값", () => {
    const paras = sample(ONE).flatMap((p, i, all) => {
      if (/1동의 건물의 표시/.test(p) && all.indexOf(p) === i) {
        return [
          "1. 건물", "고유번호[1111-2020-000001]", "서울특별시 가상구 나라동 123-4", "시험빌라1동", "[도로명주소]서울특별시 가상구 나라로1길 2",
          "철근콘크리트구조 슬래브지붕 2층 단독주택", "1층 51.36㎡", "2층 50.10㎡", "",
          "2. 토지", "고유번호[1111-2020-000002]", "서울특별시 가상구 나라동 123-4 대 210.5㎡",
        ];
      }
      return [p];
    });
    // 집합건물 묶음의 나머지 줄은 지운다
    const start = paras.indexOf("2. 토지") + 3;
    const end = paras.findIndex((p) => /등기원인과/.test(p));
    paras.splice(start, end - start);
    const f = extractHwpFields(paras);
    expect(f.properties.map((p) => [p.location.value, p.lotNumber.value, p.unitNumber.value, p.area.value])).toEqual([
      ["서울특별시 가상구 나라동", "123-4", "", "1층 51.36㎡, 2층 50.10㎡"],
      ["서울특별시 가상구 나라동", "123-4", "", "210.5㎡"],
    ]);
  });
});

describe("readHwpParagraphs", () => {
  it("한글 파일이 아니면 오류", () => {
    expect(() => readHwpParagraphs(Buffer.from("not a hwp"))).toThrow(HwpReadError);
  });
});

describe("isBlankForm (빈 양식, 2026-11-07)", () => {
  const blank = () => extractHwpFields(["채 권 양 도 인", "이전할 근저당권", "년 월 일 접수 제 호 순위 제 번으로 등기한 근저당권설정등기", "(채권최고액 : 금 원)", "채 무 자"]);
  it("대조 항목이 하나도 없으면 빈 양식", () => {
    expect(isBlankForm(blank())).toBe(true);
  });
  it("양도인 등록번호만 미리 인쇄돼 있어도 빈 양식", () => {
    const f = blank();
    f.mortgageeIdFront = { value: "110111" };
    expect(isBlankForm(f)).toBe(true);
  });
  it("한 칸이라도 값이 있으면 빈 양식이 아니다", () => {
    const f = blank();
    f.parties.debtor = [{ value: "김가명" }];
    expect(isBlankForm(f)).toBe(false);
  });
});
