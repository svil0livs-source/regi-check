// 등기부 표 해석 시험 (Tesseract가 읽은 줄 모양을 흉내 낸 글자로, 외부 서비스 없이)
import { describe, expect, it } from "vitest";
import { fuzzyIncludes, parseRegistryLines, valueConfidence, type ParseLine } from "./registryParse";

/** 글자마다 같은 확신도를 준 줄 (low에 든 글자는 확신도 30) */
const L = (text: string, conf = 95, low: string[] = []): ParseLine => ({
  text,
  words: text
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => ({ text: w, confidence: low.includes(w) ? 30 : conf })),
});

// 사용자 양식(집합건물) 모양. 실제 Tesseract 출력에서 본 오독(갑→감, 근저당권자→근저탕권자, 채→재, ㎡→ㅁㅠ)을 일부 넣었다.
const page = (): ParseLine[] => [
  L("※ 등기사항증명서 (말소사항 포함) 집합건물 [제출용]"),
  L("[집합건물] 경기도 성남시 분당구 정자동 7 예시마을아파트 102동 제15층 제1502호         고유번호 1102-2026-000007"),
  L("【표 제 부】 (1동의건물의 표시)"),
  L("1     2005년3월2일      경기도 성남시 분당구 정자동 7       철근콘크리트구조 슬래브지붕 도면편철장 제1책"),
  L("예시마을아파트 102동            15층 아파트             제30장"),
  L("( 대지권의 목적인 토지의 표시 )"),
  L(" 1. 경기도 성남시 분당구 정자동 7 23,100ㅠ        2005년3월2일"),
  L("【표 제 부】 (전유부분의 건물의 표시 )"),
  L("1     2005년3월2일      제15층 제1502호                 철근콘크리트구조 101.23ㅁㅠ    도면편철장 제1책"),
  L("( 대지권의 표시 )"),
  L("1     1 소유권대지권                       23100분의 61.88                2005년2월28일 대지"),
  L("【감    구 】 ( 소유권에 관한 사항 )"),
  L("1    소유권보존     2005년3월2일                 소유자 주식회사 시험종합건설 110111-1111111"),
  L("제11111호                   경기도 성남시 분당구 예시로 77"),
  L("2    소유권이전      2012년4월9일     2012년3월15일    공유자 지분 2분의 1"),
  L("제30215호       매매          윤테스 507192-*******"),
  L("경기도 수원시 팔달구 예시로 33"),
  L("공유자 지분 2분의 1"),
  L("장견본 506179-*******"),
  L("거래가액 금300,000,000원"),
  L("【 을    구 】 (소유권 이외의 권리에 관한 사항 )"),
  L("1     근저당권설정    2014년5월20일    2014년5월20일    재권최고액 금 50,000,000원"),
  L("제11111호       설정계약        채무자 윤테스"),
  L("근저당권자 주식회사 타파하은행 110111-2222222"),
  L("2    근저당권설정    2022년8월9일     2022년8월9일     채권최고액 금 359,000.000원"),
  L("제65433호       설정계약        채무자 윤테스"),
  L("경기도 수원시 팔달구 예시로 33"),
  L("!                             :                   근저탕권자 주식회사 차카타은행 110111-1079197"),
  L("서울특별시 종로구 가상길 5"),
  L("2-1 |2번근저당권이전 |2026년8월22일     2026년8월22일     근저당권자 주식회사 서어저신탁 110222-1079197"),
  L("제74997호        확정채권양도       서울특별시 종로구 가상길 5"),
];

describe("fuzzyIncludes", () => {
  it("글자 하나가 달라도 찾는다", () => {
    expect(fuzzyIncludes("감구소유권에관한사항", "소유권에관한사항")).toBe(true);
    expect(fuzzyIncludes("근저탕권설정", "근저당권설정")).toBe(true);
    expect(fuzzyIncludes("소유권이전", "근저당권설정")).toBe(false);
  });
});

describe("valueConfidence", () => {
  it("값이 걸친 글자들의 확신도 최솟값", () => {
    expect(valueConfidence(L("채무자 박 에 시", 95, ["에"]), "박에시")).toBe(30);
    expect(valueConfidence(L("채무자 박예시"), "박예시")).toBe(95);
    expect(valueConfidence(L("채무자 박예시"), "없는값")).toBe(0);
  });
});

describe("parseRegistryLines", () => {
  const r = parseRegistryLines(page());

  it("표제부: 1동 건물의 소재·지번, 전유부분의 호수·면적 (대지권 토지 면적은 쓰지 않음)", () => {
    expect(r.properties).toEqual([
      {
        location: { text: "경기도 성남시 분당구 정자동", uncertain: false },
        lotNumber: { text: "7", uncertain: false },
        unitNumber: { text: "제15층 제1502호", uncertain: false },
        area: { text: "101.23㎡", uncertain: false }, // 'ㅁㅠ'로 읽힌 ㎡
      },
    ]);
  });

  it("갑구: 마지막 소유권 줄의 공유자들만 (옛 소유자·등록번호 빼기)", () => {
    expect(r.owners.map((o) => o.text)).toEqual(["윤테스", "장견본"]);
  });

  it("을구: 근저당권 2건과 2번 아래 근저당권이전", () => {
    expect(r.mortgages).toHaveLength(2);
    const [first, second] = r.mortgages;
    expect(first.receiptNumber.text).toBe("제11111호");
    expect(first.transfers).toEqual([]);
    expect(second.rank).toBe("2");
    expect(second.receiptNumber).toEqual({ text: "제65433호", uncertain: false });
    expect(second.registrationDate.text).toBe("2022년8월9일");
    expect(second.debtors.map((d) => d.text)).toEqual(["윤테스"]);
    expect(second.mortgagee.text).toBe("주식회사 차카타은행"); // '근저탕권자'로 읽혀도 찾음
    expect(second.transfers).toHaveLength(1);
    expect(second.transfers[0].receiptNumber.text).toBe("제74997호");
    expect(second.transfers[0].assignee.text).toBe("주식회사 서어저신탁");
  });

  it("금액: 쉼표를 점으로 읽은 것은 쉼표로 바꾸되 불확실로 둔다", () => {
    expect(r.mortgages[1].maxClaimAmount).toEqual({ text: "금 359,000,000원", uncertain: true });
    expect(r.mortgages[0].maxClaimAmount).toEqual({ text: "금 50,000,000원", uncertain: false }); // '재권최고액'
  });

  it("등록번호는 앞 6자리만, 뒷자리는 어디에도 남기지 않는다", () => {
    expect(r.mortgages[1].mortgageeIdFront).toEqual({ text: "110111", uncertain: false });
    expect(r.mortgages[1].transfers[0].assigneeIdFront).toEqual({ text: "110222", uncertain: false });
    const all = JSON.stringify(r);
    expect(all).not.toContain("1079197");
    expect(all).not.toContain("507192");
  });

  it("호수를 '제1502초'처럼 잘못 읽으면 머리줄([집합건물])의 호수를 쓴다", () => {
    const lines = page().map((l) => (l.text.includes("제15층 제1502호                 철근") ? L(l.text.replace("제1502호", "제1502초")) : l));
    expect(parseRegistryLines(lines).properties[0].unitNumber).toEqual({ text: "제15층 제1502호", uncertain: false });
  });

  it("호수를 잘못 읽었고 머리줄도 없으면 고치지 않고 불확실", () => {
    const lines = page()
      .filter((l) => !l.text.startsWith("[집합건물]"))
      .map((l) => (l.text.includes("제15층 제1502호                 철근") ? L(l.text.replace("제1502호", "제1502초")) : l));
    expect(parseRegistryLines(lines).properties[0].unitNumber.uncertain).toBe(true);
  });

  it("접수번호 숫자에 '/'가 섞이면 고치지 않고 불확실", () => {
    const lines = page().map((l) => (l.text.startsWith("제65433호") ? L(l.text.replace("제65433호", "제 /5433호")) : l));
    expect(parseRegistryLines(lines).mortgages[1].receiptNumber.uncertain).toBe(true);
  });

  it("확신도 낮은 이름은 불확실", () => {
    const lines = page().map((l) => (l.text === "장견본 506179-*******" ? L(l.text, 95, ["장견본"]) : l));
    expect(parseRegistryLines(lines).owners[1]).toEqual({ text: "장견본", uncertain: true });
  });

  it("칸 제목이 '그저당권자'·'쾌권최고액'으로 읽혀도 그 줄의 값은 읽는다 (글자 값은 고치지 않음)", () => {
    const lines = page().map((l) => {
      if (l.text.startsWith("근저당권자 주식회사 타파하은행")) return L(l.text.replace("근저당권자", "그저당권자"));
      if (l.text.includes("재권최고액 금 50,000,000원")) return L(l.text.replace("재권최고액", "쾌권최고액"));
      return l;
    });
    const m = parseRegistryLines(lines).mortgages[0];
    expect(m.mortgagee).toEqual({ text: "주식회사 타파하은행", uncertain: false });
    expect(m.maxClaimAmount.text).toBe("금 50,000,000원");
  });

  it("말소된 근저당권은 대조 후보에서 뺀다 (N번근저당권설정등기말소)", () => {
    const lines = [...page(), L("3    1번근저당권설정등기말소   2023년1월2일    2023년1월2일    해지"), L("제1001호")];
    const r = parseRegistryLines(lines);
    expect(r.mortgages.map((m) => m.rank)).toEqual(["2"]);
    expect(r.mortgages[0].transfers).toHaveLength(1);
  });

  it("근저당권변경 부기등기의 채권최고액이 원래 금액을 대신한다", () => {
    const lines = [...page(), L("1-1  1번근저당권변경   2024년3월4일    2024년3월4일    채권최고액 금 80,000,000원"), L("제30001호       변경계약")];
    const r = parseRegistryLines(lines);
    expect(r.mortgages[0].maxClaimAmount.text).toBe("금 80,000,000원");
    expect(r.mortgages[1].maxClaimAmount.text).toBe("금 359,000,000원");
    expect(r.mortgages[0].transfers).toHaveLength(0); // 변경은 이전(양수인)으로 잡지 않는다
  });

  it("부기등기는 순위번호 앞부분으로 주등기를 찾는다 (2-1은 2번에 붙음)", () => {
    const r = parseRegistryLines(page());
    expect(r.mortgages[1].transfers[0].rank).toBe("2-1");
    expect(r.mortgages[0].transfers).toHaveLength(0);
  });
});

// ── 실제 스캔본(칸 단위로 읽은 줄 모양)에서 본 경우들 (2026-11-06) ──
describe("parseRegistryLines: 실제 스캔본 모양", () => {
  const scan = (unitLine: string, holder: ParseLine[]): ParseLine[] => [
    L("[집합건물] 서울특별시 가상구 나라동 346 시험타운 제110동 제13충 제1301호"),
    L("【 표 제 부 】  (1동의 건물의 표시)"),
    L("서울특별시 가상구 나라동 346 시험타운 제110동  철근콘크리트벽식구조"),
    L("【 표 제 부 】  (전유부분의 건물의 표시)"),
    L(unitLine),
    L("( 대지권의 표시 )"),
    L("[ 을     고 】   ( 가나다 )"), // 을구 제목을 잘못 읽음
    L("순위번호  등기목적  접 수  등기원인  권리자 및 기타사항"),
    L("10  근저당권설정  2021년1월18일 제8310호  2021년1월18일 설정계약  채권최고액 금108,000,000원"),
    L("채무자 김가명"),
    ...holder,
    L("13-1  13번근저당권부채권 질권설정  2026년6월1일 제3001698호  2026년6월1일 설정계약  채권액 금1원"),
    L("채무자 다른사람"),
  ];

  it("층을 '충'으로 읽어도 호수를 읽고, 을구 제목을 잘못 읽어도 근저당권을 찾는다", () => {
    const r = parseRegistryLines(scan("2001년4월30일  제13충 제1301호  철근콘크리트벽식구 조 114.62ㅁ", [L("근저당권자 가나생명보험주식회사 110111-0018443")]));
    expect(r.properties[0].unitNumber).toEqual({ text: "제13층 제1301호", uncertain: false });
    expect(r.properties[0].location.text).toBe("서울특별시 가상구 나라동");
    expect(r.mortgages).toHaveLength(1);
    expect(r.mortgages[0].rank).toBe("10");
  });

  it("질권 등 다른 등기의 채무자는 앞 근저당권에 섞지 않는다", () => {
    const r = parseRegistryLines(scan("제13층 제1301호  철근콘크리트구조 114.62ㅁ", [L("근저당권자 가나생명보험주식회사 110111-0018443")]));
    expect(r.mortgages[0].debtors.map((d) => d.text)).toEqual(["김가명"]);
  });

  it("등록번호가 다음 줄로 넘어가도 앞 6자리를 읽는다", () => {
    const r = parseRegistryLines(scan("제13층 제1301호  철근콘크리트구조 114.62ㅁ", [L("근저당권자 가나생명보험주식회사"), L("110111-0018443")]));
    expect(r.mortgages[0].mortgageeIdFront.text).toBe("110111");
  });

  it("면적에 소수 셋째 자리가 붙으면(㎡를 1로 읽었을 수 있음) 확신하지 않는다", () => {
    const r = parseRegistryLines(scan("제13층 제1301호  철근콘크리트구조 114.621", [L("근저당권자 가나생명보험주식회사 110111-0018443")]));
    expect(r.properties[0].area.uncertain).toBe(true);
  });
});
