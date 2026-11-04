// 시험용 서류 20건의 데이터와 정답표를 만든다. (PLAN 5번)
// 모든 이름·회사·번호는 가짜다. 실제 등기와 관계없다.
// 실행: node scripts/fixtures/cases.mjs  →  tests/fixtures-build/cases.json, tests/fixtures/정답표.md
// tests/fixtures/, tests/fixtures-build/ 는 .gitignore 대상이라 결과물은 커밋되지 않는다. 이 생성 스크립트만 커밋한다.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const outDir = join(root, "tests", "fixtures");
// 중간 데이터는 fixtures 바깥에 둔다 (fixtures 안의 폴더는 모두 "건"으로 보이기 때문)
const dataDir = join(root, "tests", "fixtures-build");

// ── 가짜 재료 ──────────────────────────────────────────────────────
const PEOPLE = ["김가명", "이시험", "박예시", "최샘플", "정임시", "강가상", "조모의", "윤테스", "장견본", "임연습", "한더미", "오가짜"];
const LENDERS = ["주식회사 가나다은행", "주식회사 라마바저축은행", "주식회사 사아자캐피탈", "주식회사 차카타은행"];
const ASSIGNEES = ["주식회사 파하유동화전문", "주식회사 거너더자산관리", "주식회사 러머버대부", "주식회사 서어저신탁"];
const PLACES = [
  ["서울특별시 강남구 역삼동", "123-4", "101동 1001호", "84.97㎡"],
  ["서울특별시 마포구 공덕동", "45-6", "제2층 제201호", "59.82㎡"],
  ["경기도 성남시 분당구 정자동", "7", "102동 1502호", "101.23㎡"],
  ["부산광역시 해운대구 우동", "1408", "제15층 제1503호", "114.56㎡"],
  ["인천광역시 연수구 송도동", "23-1", "203동 803호", "76.41㎡"],
];

const pick = (arr, i) => arr[i % arr.length];

/** 오류 없는 기본 건. i로 값이 조금씩 달라진다. */
function baseCase(i) {
  const [location, lotNumber, unitNumber, area] = pick(PLACES, i);
  const amount = (100 + ((i * 37) % 400)) * 1_000_000; // 1억~5억 사이
  const fmt = (n) => "금 " + n.toLocaleString("en-US") + "원";
  const receipt = 10000 + ((i * 7919) % 89999);
  const transferReceipt = 50000 + ((i * 3571) % 49999);
  const y = 2015 + (i % 9);
  const m = 1 + (i % 12);
  const d = 1 + ((i * 5) % 27);
  const doc = {
    parties: {
      mortgagee: [pick(LENDERS, i)],
      assignee: [pick(ASSIGNEES, i)],
      debtor: [pick(PEOPLE, i)],
      owner: [pick(PEOPLE, i)],
    },
    properties: [{ location, lotNumber, unitNumber, area }],
    maxClaimAmount: fmt(amount),
    receiptNumber: `제${receipt}호`,
    transferReceiptNumber: `제${transferReceipt}호`,
    registrationDate: `${y}년 ${m}월 ${d}일`,
    transferRegistrationDate: `2026년 ${1 + (i % 10)}월 ${1 + ((i * 3) % 27)}일`,
    // 등기부에만 있는 다른 근저당권 (근저당권 여러 건 시험용)
    otherMortgages: [],
  };
  return doc;
}

const clone = (x) => JSON.parse(JSON.stringify(x));

/**
 * 건 정의.
 * - edit(registry, hwp): 등기부(정답)와 한글 서류를 고친다. 처음엔 둘이 같다.
 * - errors: 일부러 심은 오류 (없으면 오류 없는 건)
 */
const DEFS = [
  // ── 오류 없는 건 (오탐이 나면 안 됨) ──
  { note: "기본: 모든 값이 같음", edit() {} },
  {
    note: "표기만 다름: 금액 쉼표 없음, 주소 띄어쓰기 다름",
    edit(r, h) {
      h.maxClaimAmount = h.maxClaimAmount.replace(/,/g, "").replace("금 ", "금");
      h.properties[0].location = h.properties[0].location.replace(/ /g, "");
    },
  },
  {
    note: "한자 병기: 한글 서류의 채무자·소유자 이름 뒤에 한자",
    edit(r, h) {
      h.parties.debtor = [h.parties.debtor[0] + "(金假名)"];
      h.parties.owner = [h.parties.owner[0] + "(金假名)"];
    },
  },
  {
    note: "공동 소유자 2명, 순서만 다름",
    edit(r, h, i) {
      const two = [pick(PEOPLE, i), pick(PEOPLE, i + 5)];
      r.parties.owner = two;
      h.parties.owner = [two[1], two[0]];
    },
  },
  {
    note: "공동 채무자 2명, 같은 순서",
    edit(r, h, i) {
      const two = [pick(PEOPLE, i), pick(PEOPLE, i + 3)];
      r.parties.debtor = [...two];
      h.parties.debtor = [...two];
    },
  },
  {
    note: "부동산 2개 (건물 + 토지), 토지는 건물 호수가 원래 빈칸",
    edit(r, h) {
      const land = { location: r.properties[0].location, lotNumber: r.properties[0].lotNumber.split("-")[0] + "-9", unitNumber: "", area: "1520.3㎡" };
      r.properties.push({ ...land });
      h.properties = [{ ...land }, { ...h.properties[0] }]; // 순서도 다름
    },
  },
  {
    note: "등기부에 근저당권 2건: 이번 건과 접수번호가 다른 근저당권이 하나 더 있음",
    edit(r) {
      r.otherMortgages.push({ receiptNumber: "제11111호", registrationDate: "2014년 5월 20일", maxClaimAmount: "금 50,000,000원", mortgagee: "주식회사 타파하은행", debtor: r.parties.debtor[0] });
    },
  },
  {
    note: "날짜 형식만 다름: 한글 서류는 2020.03.02 형식",
    edit(r, h) {
      const toDot = (s) => {
        const [, y, m, d] = /(\d+)년 (\d+)월 (\d+)일/.exec(s);
        return `${y}.${m.padStart(2, "0")}.${d.padStart(2, "0")}`;
      };
      h.registrationDate = toDot(h.registrationDate);
      h.transferRegistrationDate = toDot(h.transferRegistrationDate);
    },
  },

  // ── 오류를 심은 건 (검출해야 함) ──
  {
    note: "채무자 이름 한 글자 다름",
    edit(r, h) { h.parties.debtor = [h.parties.debtor[0].slice(0, -1) + "멍"]; },
    errors: ["debtor"],
  },
  {
    note: "채권최고액 숫자 한 자리 다름",
    edit(r, h) { h.maxClaimAmount = h.maxClaimAmount.replace(/(\d)(,000,000원)$/, (_, dgt, rest) => String((Number(dgt) + 1) % 10) + rest); },
    errors: ["maxClaimAmount"],
  },
  {
    note: "원 접수번호 한 자리 다름",
    edit(r, h) { h.receiptNumber = h.receiptNumber.replace(/(\d)호$/, (_, dgt) => String((Number(dgt) + 1) % 10) + "호"); },
    errors: ["receiptNumber"],
  },
  {
    note: "이전 접수번호 한 자리 다름",
    edit(r, h) { h.transferReceiptNumber = h.transferReceiptNumber.replace(/(\d)호$/, (_, dgt) => String((Number(dgt) + 1) % 10) + "호"); },
    errors: ["transferReceiptNumber"],
  },
  {
    note: "원 등기날짜 '일'이 다름",
    edit(r, h) { h.registrationDate = h.registrationDate.replace(/(\d+)일$/, (_, dd) => `${Number(dd) + 1}일`); },
    errors: ["registrationDate"],
  },
  {
    note: "이전 등기날짜 '월'이 다름",
    edit(r, h) { h.transferRegistrationDate = h.transferRegistrationDate.replace(/ (\d+)월/, (_, mm) => ` ${(Number(mm) % 12) + 1}월`); },
    errors: ["transferRegistrationDate"],
  },
  {
    note: "소재지 한 글자 다름 (동 이름)",
    edit(r, h) { h.properties[0].location = h.properties[0].location.replace(/(.)동$/, "산동"); },
    errors: ["location"],
  },
  {
    note: "지번 다름",
    edit(r, h) { h.properties[0].lotNumber = h.properties[0].lotNumber + "1"; },
    errors: ["lotNumber"],
  },
  {
    note: "건물 호수 다름",
    edit(r, h) { h.properties[0].unitNumber = h.properties[0].unitNumber.replace(/(\d)호$/, (_, dgt) => String((Number(dgt) + 2) % 10) + "호"); },
    errors: ["unitNumber"],
  },
  {
    note: "면적 숫자 순서 바뀜",
    edit(r, h) { h.properties[0].area = h.properties[0].area.replace(/(\d)(\d)㎡$/, "$2$1㎡"); },
    errors: ["area"],
  },
  {
    note: "공동 소유자 2명 중 한글 서류에 1명 빠짐",
    edit(r, h, i) {
      const two = [pick(PEOPLE, i), pick(PEOPLE, i + 4)];
      r.parties.owner = [...two];
      h.parties.owner = [two[0]];
    },
    errors: ["owner"],
  },
  {
    note: "양수인 회사 이름 한 글자 다름",
    edit(r, h) { h.parties.assignee = [h.parties.assignee[0].replace("주식회사 ", "주식회사 ").replace(/(.)$/, "산")]; },
    errors: ["assignee"],
  },
];

const KEY_LABELS = {
  mortgagee: "근저당권자", assignee: "양수인", debtor: "채무자", owner: "소유자",
  location: "소재지", lotNumber: "지번", unitNumber: "건물 호수", area: "면적",
  maxClaimAmount: "채권최고액", receiptNumber: "원 접수번호", transferReceiptNumber: "이전 접수번호",
  registrationDate: "원 등기날짜", transferRegistrationDate: "이전 등기날짜",
};

/** 오류 항목의 두 값 (정답표용) */
function valueOf(doc, key) {
  if (key in doc.parties) return doc.parties[key].join(", ");
  if (["location", "lotNumber", "unitNumber", "area"].includes(key)) return doc.properties.map((p) => p[key]).join(" / ");
  return doc[key];
}

const cases = DEFS.map((def, idx) => {
  const i = idx + 1;
  const registry = baseCase(i);
  const hwp = clone(registry);
  def.edit(registry, hwp, i);
  delete hwp.otherMortgages; // 한글 서류에는 이번 근저당권만 적는다
  const errors = (def.errors ?? []).map((key) => ({
    key,
    label: KEY_LABELS[key],
    hwp: valueOf(hwp, key),
    registry: valueOf(registry, key),
  }));
  // 오류를 심었는데 값이 같아졌다면 생성 규칙이 잘못된 것
  for (const e of errors) if (e.hwp === e.registry) throw new Error(`건 ${i}: 오류를 심지 못함 (${e.key})`);
  return {
    folder: `2026-${String(i).padStart(4, "0")}`,
    note: def.note,
    expected: errors.length ? "불일치 있음" : "전부 일치",
    errors,
    hwp,
    registry,
  };
});

mkdirSync(dataDir, { recursive: true });
writeFileSync(join(dataDir, "cases.json"), JSON.stringify(cases, null, 2), "utf8");

// 정답표 (사람이 읽는 용)
const lines = [
  "# 시험용 서류 정답표",
  "",
  "> 모든 이름·회사·번호는 가짜다. 실제 등기와 관계없다. `node scripts/fixtures/cases.mjs`로 다시 만들 수 있다.",
  ">",
  "> 판정 기준 (PLAN.md): 심어 둔 오류 항목이 「불일치」 또는 「확인 필요」면 검출. 오류 없는 건이 「전부 일치」가 아니면 오탐 1건.",
  "",
  "| 폴더 | 기대 결과 | 내용 | 심은 오류 (한글 서류 → 등기부) |",
  "|---|---|---|---|",
  ...cases.map((c) => `| ${c.folder} | ${c.expected} | ${c.note} | ${c.errors.map((e) => `${e.label}: ${e.hwp} → ${e.registry}`).join("<br>") || "-"} |`),
  "",
  `오류 없는 건 ${cases.filter((c) => !c.errors.length).length}건, 오류 심은 건 ${cases.filter((c) => c.errors.length).length}건.`,
  "",
];
writeFileSync(join(outDir, "정답표.md"), lines.join("\n"), "utf8");
writeFileSync(
  join(outDir, "정답표.json"),
  JSON.stringify(cases.map(({ folder, expected, note, errors }) => ({ folder, expected, note, errors })), null, 2),
  "utf8",
);
console.log(`cases: ${cases.length}, 오류 없는 건: ${cases.filter((c) => !c.errors.length).length}, 오류 건: ${cases.filter((c) => c.errors.length).length}`);
