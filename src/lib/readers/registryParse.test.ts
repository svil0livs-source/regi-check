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
        unitNumber: { text: "102동 제15층 제1502호", uncertain: false }, // 동은 머리줄에서 (2026-11-09)
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
    expect(parseRegistryLines(lines).properties[0].unitNumber).toEqual({ text: "102동 제15층 제1502호", uncertain: false });
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
    expect(r.properties[0].unitNumber).toEqual({ text: "제110동 제13층 제1301호", uncertain: false });
    expect(r.properties[0].location.text).toBe("서울특별시 가상구 나라동");
    expect(r.mortgages).toHaveLength(1);
    expect(r.mortgages[0].rank).toBe("10");
  });

  it("근저당권자 이름이 「경」으로 시작해도(근저당권자경… ≈ 근저당권변경) 새 등기 줄로 보지 않는다 (2026-11-09 실제 스캔본)", () => {
    const r = parseRegistryLines(scan("제13층 제1301호  철근콘크리트구조 114.62ㅁ", [L("근저당권자 경가나협동조합 110111-0018443")]));
    expect(r.mortgages[0].mortgagee).toEqual({ text: "경가나협동조합", uncertain: false });
    expect(r.mortgages[0].mortgageeIdFront.text).toBe("110111");
  });

  it("질권 등 다른 등기의 채무자는 앞 근저당권에 섞지 않는다", () => {
    const r = parseRegistryLines(scan("제13층 제1301호  철근콘크리트구조 114.62ㅁ", [L("근저당권자 가나생명보험주식회사 110111-0018443")]));
    expect(r.mortgages[0].debtors.map((d) => d.text)).toEqual(["김가명"]);
  });

  it("공동 채무자: 칸 이름 없이 이어진 이름 줄도 채무자로 읽고, 주소 줄은 빼고, 근저당권자 뒤에서는 멈춘다", () => {
    const r = parseRegistryLines(
      scan("제13층 제1301호  철근콘크리트구조 114.62ㅁ", [
        L("서울특별시 서초구 시험대로 10"),
        L("이누리"),
        L("경기도 가온시 새봄구 예시로 33 (다솜동)"),
        L("근저당권자 가나생명보험주식회사 110111-0018443"),
        L("서울특별시 중구 남대문로 120"),
        L("박한빛"),
      ]),
    );
    expect(r.mortgages[0].debtors.map((d) => d.text)).toEqual(["김가명", "이누리"]);
    expect(r.mortgages[0].mortgagee.text).toBe("가나생명보험주식회사");
  });

  it("등기부 두 개를 한 PDF로 이어 붙이면 부동산 2개를 차례로 읽는다 (공동담보, 2026-11-07)", () => {
    const holder = [L("근저당권자 가나생명보험주식회사 110111-0018443")];
    const r = parseRegistryLines([...scan("제13층 제1301호  철근콘크리트구조 114.62ㅁ", holder), ...scan("제12층 제1201호  철근콘크리트구조 104.25ㅁ", holder)]);
    expect(r.properties.map((p) => [p.unitNumber.text, p.area.text])).toEqual([
      ["제110동 제13층 제1301호", "114.62㎡"],
      ["제12층 제1201호", "104.25㎡"], // 이 호수가 적힌 머리줄이 없으면 동을 붙이지 않는다
    ]);
    expect(r.mortgages.map((m) => m.receiptNumber.text)).toEqual(["제8310호", "제8310호"]);
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

// ── 토지·일반건물 등기부 (2026-11-09 실제 글자 PDF 모양, 값은 가짜) ──
describe("parseRegistryLines: 토지·일반건물 표제부", () => {
  const building = (): ParseLine[] => [
    L("[건물] 서울특별시 가상구 나라동 123-4 시험빌라1동"),
    L("【 표 제 부 】  ( 건물의 표시 )"),
    L("표시번호  접 수  소재지번,건물명칭 및 번호  건 물 내 역  등기원인 및 기타사항"),
    L("1  2020년1월20일  서울특별시 가상구 나라동  철근콘크리트구조 슬래브지붕"),
    L("123-4 시험빌라1동  4층 단독주택"),
    L("[도로명주소]  1층 51.36㎡"),
    L("서울특별시 가상구 나라로1길 2  2층 50.1㎡"),
    L("옥탑1층 12.0㎡"),
    L("【 갑  구 】  ( 소유권에 관한 사항 )"),
    L("순위번호  등 기 목 적  접 수  등 기 원 인  권리자 및 기타사항"),
    L("1  소유권보존  2020년1월20일  소유자 김가명 800101-*******"),
    L("【 을  구 】  ( 소유권 이외의 권리에 관한 사항 )"),
    L("1  근저당권설정  2020년3월13일  2020년3월13일  채권최고액 금300,000,000원"),
    L("제14475호  설정계약  채무자 김가명"),
    L("근저당권자 가나다보험주식회사 110111-1234567"),
    L("2  근저당권설정  2021년3월13일  2021년3월13일  채권최고액 금100,000,000원"),
    L("제2943호  설정계약  채무자 김가명"),
    L("3  2번근저당권설정등  2022년1월3일  2022년1월3일  해지"),
    L("기말소  제111호"),
  ];
  const land = (): ParseLine[] => [
    L("[토지] 서울특별시 가상구 나라동 123-4"),
    L("【 표 제 부 】  ( 토지의 표시 )"),
    L("표시번호  접 수  소 재 지 번  지 목  면 적  등기원인 및 기타사항"),
    L("1  2001년3월2일  서울특별시 가상구 나라동  대  215.0㎡"),
    L("(전 1)  123-4"),
    L("2  서울특별시 가상구 나라동  대  210.5㎡  2015년1월2일"),
    L("123-4  행정구역명칭변경"),
    L("【 갑  구 】  ( 소유권에 관한 사항 )"),
    L("순위번호  등 기 목 적  접 수  등 기 원 인  권리자 및 기타사항"),
    L("【 을  구 】  ( 소유권 이외의 권리에 관한 사항 )"),
    L("1  근저당권설정  2020년3월13일  2020년3월13일  채권최고액 금300,000,000원"),
    L("제14475호  설정계약  채무자 김가명"),
  ];

  it("일반건물: 소재지·지번(다음 줄)·층별 면적 전부, 호수는 빈 값", () => {
    expect(parseRegistryLines(building()).properties).toEqual([
      { location: { text: "서울특별시 가상구 나라동", uncertain: false }, lotNumber: { text: "123-4", uncertain: false }, unitNumber: { text: "", uncertain: false }, area: { text: "1층 51.36㎡, 2층 50.1㎡, 옥탑1층 12.0㎡", uncertain: false } },
    ]);
  });

  it("토지: 표시가 바뀌었으면 마지막 표시의 소재지·지번·면적 (지목은 읽지 않음)", () => {
    const [p] = parseRegistryLines(land()).properties;
    expect([p.location.text, p.lotNumber.text, p.unitNumber.text, p.area.text]).toEqual(["서울특별시 가상구 나라동", "123-4", "", "210.5㎡"]);
  });

  it("「N번근저당권설정등기말소」에서 말소가 다음 줄로 넘어가도 그 근저당권을 후보에서 뺀다", () => {
    expect(parseRegistryLines(building()).mortgages.map((m) => m.rank)).toEqual(["1"]);
  });

  it("스캔본에서 표시번호·접수 칸을 잘못 읽어도 소재지 칸이 있는 줄을 표시 줄로 본다 (2026-11-09 실제 스캔본)", () => {
    const scanned = land().map((l) => (/^1  2001/.test(l.text) ? L("ㅁ  서울특별시 가상구 나라동 123-4  도로  66㎡  2001년3월2일") : l)).filter((l) => !/^(2  |\(전 1\)|123-4  행정)/.test(l.text));
    const [p] = parseRegistryLines(scanned).properties;
    expect([p.location.text, p.lotNumber.text, p.area.text]).toEqual(["서울특별시 가상구 나라동", "123-4", "66㎡"]);
  });

  it("「1번(1)근저당권설정, 2번(2)근저당권설정」 말소 줄은 두 근저당권을 모두 후보에서 뺀다 (공동담보, 2026-11-09 실제 스캔본)", () => {
    const lines = [
      ...building().slice(0, -2),
      L("3  1번(1)근저당권설정, 2번(2)근저당권설정  2022년1월3일 제111호  2022년1월3일  해지"),
      L("4  근저당권설정  2023년1월3일  2023년1월3일  채권최고액 금50,000,000원"),
      L("제222호  설정계약  채무자 김가명"),
      L("근저당권자 경가나협동조합 110111-1234567"),
    ];
    expect(parseRegistryLines(lines).mortgages.map((m) => m.rank)).toEqual(["4"]);
  });

  it("건물·토지 등기부를 이어 붙이면 부동산 2개, 근저당권은 등기부마다", () => {
    const r = parseRegistryLines([...building(), ...land()]);
    expect(r.properties.map((p) => p.area.text)).toEqual(["1층 51.36㎡, 2층 50.1㎡, 옥탑1층 12.0㎡", "210.5㎡"]);
    expect(r.mortgages.map((m) => m.receiptNumber.text)).toEqual(["제14475호", "제14475호"]);
  });
});

// ── 스캔본 일반건물 표제부 (2026-11-10 실제 스캔본 모양, 값은 가짜): 칸 안의 줄들이 한 칸 글자로 이어져 온다 ──
describe("parseRegistryLines: 스캔본 일반건물 표제부", () => {
  const scan = (cell: string, low: string[] = []): ParseLine[] => [
    L("【 표 제 부 】  ( 건물의 표시 )"),
    L("표시번호  접 수  소재지번 및 건물번호  건 물 내 역  등기원인 및 기타사항"),
    L(`1  2020년1월20일  서울특별시 가상구 나라동 123-4 [도로명주소] 서울특별시 가상구 나라로1길 2  ${cell}`, 95, low),
    L("【 을  구 】  ( 소유권 이외의 권리에 관한 사항 )"),
  ];
  it("소재지번 칸의 도로명주소는 빼고, 건물내역 칸 안의 층별 면적을 모두 찾는다", () => {
    const p = parseRegistryLines(scan("철근콘크리트구조 경사지붕 2층 단독주택 지1층 122.83㎡ 1층 72.74㎡ 2층 76.47㎡")).properties[0];
    expect(p.location).toEqual({ text: "서울특별시 가상구 나라동", uncertain: false });
    expect(p.lotNumber).toEqual({ text: "123-4", uncertain: false });
    expect(p.area).toEqual({ text: "지1층 122.83㎡, 1층 72.74㎡, 2층 76.47㎡", uncertain: false });
  });
  it("단위를 못 읽은 층이나 「층」을 다른 글자로 읽은 층도 빠뜨리지 않고 확신 없음으로 둔다", () => {
    expect(parseRegistryLines(scan("벽돌조 2층 단독주택 1층 72.741 2층 76.47㎡")).properties[0].area).toEqual({ text: "1층 72.741㎡, 2층 76.47㎡", uncertain: true });
    expect(parseRegistryLines(scan("벽돌조 2층 단독주택 1층 72.74㎡ 2흥 76.47㎡")).properties[0].area).toEqual({ text: "1층 72.74㎡, 2층 76.47㎡", uncertain: true });
  });
});

// ── 쪽마다 되풀이되는 머리줄로 소재지 확인 (2026-11-10 실제 스캔본 모양, 값은 가짜) ──
describe("parseRegistryLines: 토지 머리줄 소재지", () => {
  const land = (row: string, low: string[] = [], headers = 3): ParseLine[] => [
    ...Array.from({ length: headers }, () => L("[토지] 경기도 가상시 나라동 123-4")),
    L("【 표 제 부 】  ( 토지의 표시 )"),
    L("표시번호  접 수  소 재 지 번  지 목  면 적  등기원인 및 기타사항"),
    L(row, 95, low),
    L("【 을  구 】  ( 소유권 이외의 권리에 관한 사항 )"),
  ];
  it("표제부 소재지를 한 글자 다르게 읽었어도 지번이 같으면 머리줄 소재지를 쓴다", () => {
    const p = parseRegistryLines(land("1  2001년3월2일  경기도 가상시 니라동 123-4  대  82㎡")).properties[0];
    expect(p.location).toEqual({ text: "경기도 가상시 나라동", uncertain: false });
    expect(p.lotNumber).toEqual({ text: "123-4", uncertain: false });
  });
  it("표제부 소재지의 확신이 낮아도 지번이 같으면 머리줄 소재지를 쓴다", () => {
    expect(parseRegistryLines(land("1  2001년3월2일  경기도 가상시 나라동 123-4  대  82㎡", ["나라동"])).properties[0].location).toEqual({ text: "경기도 가상시 나라동", uncertain: false });
  });
  it("지번이 머리줄과 다르면 머리줄을 쓰지 않는다", () => {
    expect(parseRegistryLines(land("1  2001년3월2일  경기도 가상시 니라동 123-5  대  82㎡")).properties[0].location).toEqual({ text: "경기도 가상시 니라동", uncertain: false });
  });
  it("머리줄이 한 번뿐이면 쓰지 않는다", () => {
    expect(parseRegistryLines(land("1  2001년3월2일  경기도 가상시 니라동 123-4  대  82㎡", [], 1)).properties[0].location).toEqual({ text: "경기도 가상시 니라동", uncertain: false });
  });
});

// ── 말소사항 포함 집합건물 스캔본 (2026-11-13 실제 스캔본 모양, 값은 가짜) ──
describe("parseRegistryLines: 집합건물 스캔본 보완 (2026-11-13)", () => {
  const scan = (unitRow: string, eul: ParseLine[], eulTitle = "【 을  구 】  ( 소유권 이외의 권리에 관한 사항 )"): ParseLine[] => [
    L("[집합건물] 경기도 가상시 나라동 7 예시오피스텔 제8층 제씨-809호"),
    L("【 표 제 부 】  ( 1동의 건물의 표시 )"),
    L("표시번호  접 수  소재지번,건물명칭 및 번호  건 물 내 역  등기원인 및 기타사항"),
    L("3  경기도 가상시 나라동 7 예시오피스텔  철근콘크리트구조 25층 업무시설"),
    L("【 표 제 부 】  ( 전유부분의 건물의 표시 )"),
    L("표시번호  접 수  건 물 번 호  건 물 내 역  등기원인 및 기타사항"),
    L(unitRow),
    L(eulTitle),
    L("등기목적  접 수  등기원인  권리자 및 기타사항"),
    ...eul,
  ];
  const mortgage = (purpose: string, amountLabel = "채권최고액", rank = "14  "): ParseLine[] => [
    L(`${rank}${purpose}  2020년3월23일 제39585호  2020년3월23일 설정계약  ${amountLabel} 금272,800,000원`),
    L("채무자 김가명"),
    L("근저당권자 가나다보험주식회사"),
    L("110111-1234567"),
  ];
  it("호수 숫자 앞에 글자가 붙은 건물번호(제씨-809호)를 읽는다", () => {
    const p = parseRegistryLines(scan("1  2004년4월23일  제8층 제씨-809호  철근콘크리트구조 80㎡  도면편철장 제1책", [])).properties[0];
    expect(p.unitNumber).toEqual({ text: "제8층 제씨-809호", uncertain: false });
    expect(p.area).toEqual({ text: "80㎡", uncertain: false });
  });
  it("소수 넷째 자리까지 있는 전유 면적은 단위까지 읽었으면 믿고, 셋째 자리까지면 확신하지 않는다", () => {
    const area = (a: string) => parseRegistryLines(scan(`1  2010년4월8일  제8층 제809호  철근콘크리트구조 ${a}  전산도면번호`, [])).properties[0].area;
    expect(area("84.9457㎡")).toEqual({ text: "84.9457㎡", uncertain: false });
    expect(area("114.621㎡")).toEqual({ text: "114.621㎡", uncertain: true });
    expect(area("84.9457")).toEqual({ text: "84.9457㎡", uncertain: true });
  });
  it("순위번호도 「근」도 가려져 줄이 「저당권설정」으로 시작해도 채권최고액이 있으면 근저당권으로 본다", () => {
    const m = parseRegistryLines(scan("1  2010년4월8일  제8층 제809호  철근콘크리트구조 80㎡", mortgage("'저당권설정", "채권최고액", ""))).mortgages;
    expect(m.map((x) => [x.rank, x.receiptNumber.text, x.debtors[0]?.text])).toEqual([["", "제39585호", "김가명"]]);
  });
  it("채권최고액이 없는 「저당권설정」은 근저당권으로 보지 않는다", () => {
    expect(parseRegistryLines(scan("1  2010년4월8일  제8층 제809호  철근콘크리트구조 80㎡", mortgage("저당권설정", "채권액", ""))).mortgages).toEqual([]);
  });
  it("을구 제목을 못 읽어도 「권리자 및 기타사항」 머리줄 뒤의 근저당권을 찾는다", () => {
    const m = parseRegistryLines(scan("1  2010년4월8일  제8층 제809호  철근콘크리트구조 80㎡", mortgage("근저당권설정"), "[ 을 :『 구 그 (낙이이피의 원리아한 사항/)")).mortgages;
    expect(m.map((x) => x.rank)).toEqual(["14"]);
  });
});
