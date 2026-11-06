// 시험용 서류 20건의 데이터와 정답표 (2026-11-06, 실제 양식 「위임장 + 확정채권 및 근저당권 양도증서」 기준으로 다시 만듦).
// 모든 이름·회사·번호·주소는 가짜다. 실제 등기와 관계없다.
// 오류 12건(건마다 하나씩, 대조 항목마다 하나 이상) + 오류 없는 건 8건.
// make-fixtures.mjs가 이 데이터로 한글 파일(.hml·.hwpx)과 등기부 스캔 PDF를 만든다.

// ── 가짜 재료 ──────────────────────────────────────────────────────
const PLACES = [
  { loc: "서울특별시 성동구 가람동", lot: "346", complex: "가람한빛타운", dong: "제110동", road: "서울특별시 성동구 가람로 82", floor: 13, ho: 1301, structure: "철근콘크리트벽식구조", area: "114.62", land: "77198.8", ratio: "48.215" },
  { loc: "서울특별시 마포구 누리동", lot: "45-6", complex: "누리하늘빌", dong: "가동", road: "서울특별시 마포구 누리길 8", floor: 2, ho: 201, structure: "철근콘크리트구조", area: "59.82", land: "860.4", ratio: "41.2" },
  { loc: "경기도 가온시 새봄구 다솜동", lot: "7", complex: "다솜마을", dong: "제102동", road: "경기도 가온시 새봄구 다솜로 77", floor: 15, ho: 1502, structure: "철근콘크리트벽식구조", area: "101.23", land: "23100", ratio: "61.88" },
  { loc: "부산광역시 해운대구 바다동", lot: "1408", complex: "바다타워", dong: "제1동", road: "부산광역시 해운대구 바다대로 140", floor: 21, ho: 2103, structure: "철골철근콘크리트구조", area: "84.97", land: "3900.5", ratio: "38.05" },
  { loc: "인천광역시 연수구 별빛동", lot: "23-1", complex: "별빛아파트", dong: "제203동", road: "인천광역시 연수구 별빛로 23", floor: 8, ho: 803, structure: "철근콘크리트라멘조", area: "76.41", land: "18500", ratio: "47.6" },
  { loc: "대구광역시 수성구 푸름동", lot: "512-3", complex: "푸름그린", dong: "제105동", road: "대구광역시 수성구 푸름로 51", floor: 9, ho: 904, structure: "철근콘크리트벽식구조", area: "49.98", land: "12400", ratio: "29.517" },
];

const LENDERS = [
  ["가나화재해상보험주식회사", "110111-0035893"],
  ["다라생명보험주식회사", "110111-0018443"],
  ["주식회사마바저축은행", "110111-0127161"],
  ["사아신용협동조합", "124136-0001234"],
  ["자차캐피탈주식회사", "110111-2201789"],
  ["카타상호저축은행주식회사", "134811-0004321"],
  ["파하농업협동조합", "134136-0000777"],
  ["주식회사가람은행", "110111-0012809"],
];
const KAMCO = ["한국자산관리공사", "114671-0023169"];
const PEOPLE = ["김가람", "이누리", "박한빛", "최다솜", "정새봄", "강하늘", "조은별", "윤바다", "장푸름", "임가온", "한마루", "오나래"];
const STREETS = ["서울특별시 종로구 대학로5길 15-6, 4층 402호 (연건동)", "서울특별시 서초구 시험대로 10", "경기도 가온시 새봄구 예시로 33", "서울특별시 송파구 견본로 71, 101동 1203호"];
const LENDER_ADDR = ["서울특별시 종로구 세종대로 163(세종로)", "서울특별시 중구 남대문로 120", "서울특별시 강남구 테헤란로 301", "경기도 가온시 새봄구 중앙로 5"];

const won = (n) => n.toLocaleString("en-US");
const pick = (arr, i) => arr[i % arr.length];

/** 결정적인 가짜 난수 (같은 번호면 같은 값) */
function rng(seed) {
  let s = seed * 2654435761 % 4294967296;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

/**
 * 건 하나의 기본(오류 없는) 데이터.
 * opt.targets: 이전할 근저당권 수(1~2), opt.transfer: 이전할 근저당권이 이미 다른 금융사로 이전됨,
 * opt.kamco: 이미 한국자산관리공사로 이전돼 있음(양도인은 그 전 권리자), opt.liveOthers: 이전하지 않는 다른 근저당권 수
 */
function baseCase(i, opt = {}) {
  const r = rng(i + 7);
  const place = pick(PLACES, i);
  const debtor = pick(PEOPLE, i);
  const lender = pick(LENDERS, i);
  const nTargets = opt.targets ?? 1;
  const year = (y) => 2008 + y;

  // 을구 줄들: 말소된 옛 근저당권 → 말소 등기 → 이전할 근저당권(들) → 그 밖의 근저당권
  const eul = [];
  let rank = 1;
  const oldCount = 1 + (i % 3);
  for (let k = 0; k < oldCount; k++) {
    const y = year(k * 2);
    eul.push({
      kind: "mortgage", rank: String(rank++), struck: true,
      date: `${y}년${1 + ((i + k) % 12)}월${1 + ((i * 3 + k) % 27)}일`, receipt: `제${10000 + Math.floor(r() * 80000)}호`,
      amount: (40 + Math.floor(r() * 30) * 4) * 1_000_000, debtor, debtorAddr: pick(STREETS, i + k), holder: pick(LENDERS, i + k + 3), holderAddr: pick(LENDER_ADDR, k),
    });
  }
  eul.push({
    kind: "cancel", rank: String(rank++), struck: false,
    targets: eul.map((e) => e.rank), date: `${year(5)}년${1 + (i % 12)}월${2 + (i % 20)}일`, receipt: `제${20000 + Math.floor(r() * 70000)}호`,
  });

  const targets = [];
  for (let t = 0; t < nTargets; t++) {
    const y = 2016 + ((i + t * 3) % 9);
    const m = {
      kind: "mortgage", rank: String(rank++), struck: false,
      date: `${y}년${1 + ((i * 5 + t) % 12)}월${1 + ((i * 7 + t * 11) % 28)}일`, receipt: `제${1000 + Math.floor(r() * 180000)}호`,
      amount: (100 + Math.floor(r() * 80) * 6) * 1_000_000, debtor, debtorAddr: pick(STREETS, i), holder: t === 0 || !opt.otherLender ? lender : pick(LENDERS, i + 1), holderAddr: pick(LENDER_ADDR, i),
    };
    eul.push(m);
    targets.push(m);
  }
  // 이전할 근저당권이 이미 다른 금융사로 이전된 건: 양도인은 새 권리자
  let assignor = targets[0].holder;
  if (opt.transfer) {
    const to = pick(LENDERS, i + 5);
    eul.push({ kind: "transfer", rank: `${targets[0].rank}-1`, parent: targets[0].rank, struck: false, date: `2025년${1 + (i % 12)}월${3 + (i % 20)}일`, receipt: `제${30000 + Math.floor(r() * 60000)}호`, holder: to, holderAddr: pick(LENDER_ADDR, i + 1) });
    assignor = to;
  }
  // 이미 한국자산관리공사로 이전된 건: 양도인은 그 전 권리자
  if (opt.kamco) {
    eul.push({ kind: "transfer", rank: `${targets[0].rank}-1`, parent: targets[0].rank, struck: false, date: `2026년${1 + (i % 9)}월${3 + (i % 20)}일`, receipt: `제${30000 + Math.floor(r() * 60000)}호`, holder: KAMCO, holderAddr: ["부산광역시 남구 문현금융로 40(문현동)"] });
  }
  for (let k = 0; k < (opt.liveOthers ?? 0); k++) {
    eul.push({
      kind: "mortgage", rank: String(rank++), struck: false,
      date: `2025년${1 + ((i + k) % 12)}월${5 + k}일`, receipt: `제${2000 + Math.floor(r() * 150000)}호`,
      amount: (50 + Math.floor(r() * 40) * 5) * 1_000_000, debtor, debtorAddr: pick(STREETS, i + 2), holder: pick(LENDERS, i + 2 + k), holderAddr: pick(LENDER_ADDR, k + 2),
    });
  }
  if (opt.struckLater) {
    eul.push({
      kind: "mortgage", rank: String(rank++), struck: true,
      date: `2023년7월28일`, receipt: `제${3000 + Math.floor(r() * 150000)}호`, amount: 480_000_000, debtor, debtorAddr: pick(STREETS, i + 1), holder: pick(LENDERS, i + 4), holderAddr: pick(LENDER_ADDR, 1),
    });
  }

  const sum = targets.reduce((n, t) => n + t.amount, 0);
  const [assignorName, assignorId] = assignor;
  return {
    place,
    debtor,
    owner: debtor,
    eul,
    // 한글 서류에 적힌 값 (등기부와 같음 = 오류 없음)
    hwp: {
      location: place.loc,
      lotNumber: place.lot,
      unit: `제${place.floor}층 제${place.ho}호`,
      area: `${place.area}㎡`,
      mortgages: targets.map((t) => ({ date: t.date, receipt: t.receipt, rank: t.rank })),
      amount: sum,
      assignorName,
      assignorId,
      debtor,
    },
  };
}

// ── 20건 ────────────────────────────────────────────────────────────
// look: 등기부 모양 선택 (summary: 앞에 「주요 등기사항 요약」 페이지, pen: 순위번호 동그라미·체크 필기, skew: 아주 조금 기울어진 스캔)
const PLAN = [
  { opt: {}, look: { summary: true } },
  { opt: { targets: 2, otherLender: false }, look: { pen: true } },
  { opt: { transfer: true }, look: {} },
  { opt: { liveOthers: 1 }, look: { summary: true, pen: true } },
  { opt: { kamco: true }, look: { skew: true } },
  { opt: { struckLater: true }, look: {} },
  { opt: { liveOthers: 2 }, look: { summary: true } },
  { opt: {}, look: { pen: true, skew: true } },
  // 여기부터 오류 건
  { opt: {}, look: { summary: true }, err: "mortgagee" },
  { opt: { liveOthers: 1 }, look: {}, err: "mortgageeIdFront" },
  { opt: {}, look: { pen: true }, err: "debtor" },
  { opt: { struckLater: true }, look: {}, err: "location" },
  { opt: {}, look: { skew: true }, err: "lotNumber" },
  { opt: { transfer: true }, look: { summary: true }, err: "unitNumber" },
  { opt: {}, look: {}, err: "area" },
  { opt: { liveOthers: 1 }, look: { pen: true }, err: "maxClaimAmount" },
  { opt: {}, look: { summary: true }, err: "receiptNumber" },
  { opt: { struckLater: true }, look: {}, err: "registrationDate" },
  { opt: { liveOthers: 1 }, look: { pen: true }, err: "rank" },
  { opt: { targets: 2 }, look: { summary: true }, err: "maxClaimAmount" },
];

/** 오류 심기: 한글 서류 값만 바꾼다 (등기부가 정답) */
function plant(c, key) {
  const h = c.hwp;
  switch (key) {
    case "mortgagee": // 회사 이름 한 글자
      h.assignorName = h.assignorName.replace(/^(.)/, (ch) => (ch === "가" ? "카" : "가"));
      return `양도인 이름 첫 글자 다름`;
    case "mortgageeIdFront": // 등록번호 앞 6자리 중 한 자리
      h.assignorId = h.assignorId.replace(/^(\d{4})(\d)/, (_, a, d) => a + ((Number(d) + 3) % 10));
      return `양도인 등록번호 앞 6자리 중 한 자리 다름`;
    case "debtor":
      h.debtor = h.debtor.slice(0, 2) + (h.debtor[2] === "람" ? "림" : "람");
      return `채무자 이름 끝 글자 다름`;
    case "location":
      h.location = h.location.replace(/(\S)동$/, (_, a) => (a === "람" ? "림" : "람") + "동");
      return `소재지 동 이름 한 글자 다름`;
    case "lotNumber":
      h.lotNumber = h.lotNumber.replace(/(\d)(\d)/, "$2$1") === h.lotNumber ? h.lotNumber + "1" : h.lotNumber.replace(/(\d)(\d)/, "$2$1");
      return `지번 숫자 순서 바뀜`;
    case "unitNumber":
      h.unit = h.unit.replace(/(\d)(\d)호$/, "$2$1호") === h.unit ? h.unit.replace(/호$/, "1호") : h.unit.replace(/(\d)(\d)호$/, "$2$1호");
      return `호수 끝 두 자리 바뀜`;
    case "area":
      h.area = h.area.replace(/\.(\d)(\d)/, (_, a, b) => `.${b}${a === b ? (Number(a) + 1) % 10 : a}`);
      return `전유 면적 소수 자리 바뀜`;
    case "maxClaimAmount":
      h.amount += 20_000_000;
      return h.mortgages.length > 1 ? `채권최고액 합계 2천만 원 많음` : `채권최고액 2천만 원 많음`;
    case "receiptNumber":
      h.mortgages[0].receipt = h.mortgages[0].receipt.replace(/(\d)호$/, (_, d) => `${(Number(d) + 1) % 10}호`);
      return `접수번호 끝 자리 다름`;
    case "registrationDate":
      h.mortgages[0].date = h.mortgages[0].date.replace(/(\d+)일$/, (_, d) => `${Number(d) === 28 ? 18 : Number(d) + 1}일`);
      return `접수일 하루 다름`;
    case "rank":
      h.mortgages[0].rank = String(Number(h.mortgages[0].rank) + 1);
      return `순위번호 1 큼`;
    default:
      throw new Error(key);
  }
}

export function buildCases() {
  return PLAN.map((p, n) => {
    const i = n + 1;
    const c = baseCase(i, p.opt);
    const folder = `2026-${String(i).padStart(4, "0")}`;
    const errors = [];
    if (p.err) errors.push({ key: p.err, desc: plant(c, p.err) });
    return {
      folder,
      // 한글 파일 형식: 대부분 .hml, 몇 건은 신버전 .hwpx
      format: i % 4 === 0 ? "hwpx" : "hml",
      look: p.look,
      ...c,
      expected: errors.length ? "불일치 있음" : "전부 일치",
      errors,
    };
  });
}

export { KAMCO, won };
