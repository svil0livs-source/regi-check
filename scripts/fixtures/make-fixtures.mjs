// 시험용 서류 20건을 만든다 (2026-11-06, 실제 양식 기준).
//   한글 파일: 「위임장 + 확정채권 및 근저당권 양도증서」 문단 순서 그대로 .hwpx(신버전)·.hml(한글 XML)·.hwp(HWP 5.x)·.hwp(HWP 3.0)를 돌아가며 쓴다.
//              .hwp 두 종류는 문단 글자만 담은 최소 파일이라(hwpBinary.mjs) 앱은 읽지만 한글 프로그램에서는 열리지 않을 수 있다 (2026-11-07)
//   등기부: 실제 「등기사항전부증명서(말소사항 포함) - 집합건물」 모양의 표를 브라우저로 그려 300dpi 회색조 스캔처럼 만든다.
//           말소 줄 취소선, 요약(참고용) 페이지, 갑구, 순위번호 볼펜 동그라미·체크, 「열람용」 흐린 글자, 잡티를 넣는다.
// 모든 값은 가짜다 (cases.mjs). 결과물(tests/fixtures/)은 .gitignore 대상이라 커밋되지 않는다.
// 실행: node scripts/fixtures/make-fixtures.mjs   (한글 파일만 다시: HANGUL_ONLY=1) (Playwright·Chromium, curl 필요. 글꼴은 Noto Serif KR(OFL)을 처음 한 번 내려받아 tests/fixtures-build/에 둔다)
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";
import { buildCases, won } from "./cases.mjs";
import { hwp3, hwp5 } from "./hwpBinary.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(join(root, "package.json"));
const sharp = require("sharp");
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  ({ chromium } = createRequire(import.meta.url)("playwright"));
}

const outDir = join(root, "tests", "fixtures");

// 글꼴: 실제 등기부(바탕체)와 숫자 모양이 비슷한 Noto Serif KR 한 파일을 받아 두고 쓴다 (나눠 받는 웹 글꼴은 글자가 빠질 수 있어서).
// 처음엔 나눔명조를 썼으나 숫자 모양이 달라 글자 읽기가 실제 서류와 다르게 틀렸다 (2026-11-06).
const buildDir = join(root, "tests", "fixtures-build");
const fontPath = join(buildDir, "NotoSerifKR.ttf");
if (!existsSync(fontPath)) {
  mkdirSync(buildDir, { recursive: true });
  execFileSync("curl", ["-sSfL", "-o", fontPath, "https://raw.githubusercontent.com/google/fonts/main/ofl/notoserifkr/NotoSerifKR%5Bwght%5D.ttf"]);
}
const FONT_FACE = "@font-face { font-family: 'RegFont'; src: url('NotoSerifKR.ttf') format('truetype'); font-weight: 100 900; }";
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ── 한글 파일 ───────────────────────────────────────────────────────
const pad2 = (d) => d.replace(/(\d{4})년(\d{1,2})월(\d{1,2})일/, (_, y, m, dd) => `${y}년${m.padStart(2, "0")}월${dd.padStart(2, "0")}일`);

/** 부동산 하나의 표시 문단들 */
function propertyBlock(h, n) {
  const p = h.place;
  return [
    `${n}. 1동의 건물의 표시`,
    `${h.location} ${h.lotNumber}`,
    `${p.complex} ${p.dong}`,
    `[도로명주소]${p.road}`,
    "전유부분의 건물의 표시",
    `1. 건물의 번호 : ${h.unit}[고유번호:1111-2001-00${String(2600 + p.ho).slice(-4)}]`,
    `구조 및 면적 : ${p.structure} ${h.area}`,
    "전유부분의 대지권의 표시",
    "토지의 표시",
    `1.${h.location} ${h.lotNumber}`,
    `대 ${p.land}㎡`,
    "대지권의 종류: 소유권",
    `대지권의 비율: ${p.land}분의 ${p.ratio}`,
  ];
}

/** 실제 양식의 문단 순서 (사용자가 준 빈 양식·가짜로 채운 양식 기준) */
function hwpParagraphs(c) {
  const h = c.hwp;
  // 부동산마다 「N. 1동의 건물의 표시」 묶음 하나 (공동담보면 두 개)
  const property = [{ location: h.location, lotNumber: h.lotNumber, unit: h.unit, area: h.area, place: c.place }, ...h.extra].flatMap((x, n) => propertyBlock(x, n + 1));

  const mortgageLine =
    h.mortgages.map((m) => `${pad2(m.date)} 접수 ${m.receipt} 순위 제${m.rank}번으로 등기한 근저당권설정등기`).join(", ") +
    ". 단, 근저당권은 채권과 함께 이전함.";
  const amount = `(채권최고액 : 금 ${won(h.amount)}원)`;
  const assignor = [`${h.assignorName} (${h.assignorId})`, "서울특별시 중구 세종대로 12(태평로1가)", "(대표이사)홍대표"];
  const kamco = ["한국자산관리공사 (114671-0023169)", "부산광역시 남구 문현금융로 40(문현동)", "사 장 : 정 정 훈", "대 리 인 : 김 기 덕", "(취급지점: 서울동부지역본부)"];
  return [
    "위 임 장",
    ..."부동산의표시".split(""),
    ...property,
    "등기원인과 그연월일",
    "2026년 10월 28일 확정채권양도",
    "등 기 의 목 적",
    "근저당권 이전",
    "이 전 할 근 저 당 권",
    mortgageLine,
    amount,
    "채권 양도인",
    ...assignor,
    "채권 양수인",
    ...kamco,
    "가상 법무사 사무소",
    "전화 02) 591-0000",
    "팩스 02) 591-0001",
    "서울특별시 서초구 법원로1길 10,",
    "201호(서초동, 가상빌딩)",
    "위 사람을 대리인으로 정하고 위 부동산 등기신청 및 취하에 관한 모든 행위를 위임한다.",
    "또한 복대리인 선임을 허락한다.",
    "년 월 일",
    "확정채권 및 근저당권 양도증서",
    `『금융회사부실자산등의 효율적 처리 및 한국자산관리공사의 설립에 관한 법률』제4조에 의하여 ${h.assignorName}(가) 아래 채무자에 대하여 가지는 채권 및 근저당권에 관한 일체의 권한을 한국자산관리공사에 양도하였기에 이 증서를 작성합니다.`,
    "【부동산의 표시】",
    ...property,
    "【이전할 근저당권 및 채무자의 표시】",
    "이전할 근저당권",
    mortgageLine,
    amount,
    "채 무 자",
    h.debtor,
    c.eul.find((e) => e.kind === "mortgage" && !e.struck)?.debtorAddr ?? "서울특별시 종로구 대학로 1",
    "2026년 10월 28일",
    "채권 양도인",
    ...assignor,
    "채권 양수인 한국자산관리공사 (114671-0023169)",
    ...kamco.slice(1),
  ];
}

const hml = (paras) =>
  '<?xml version="1.0" encoding="UTF-8" standalone="no" ?><HWPML Version="2.8" SubVersion="8.0.0.0" Style2="embed"><HEAD/><BODY><SECTION Id="0">' +
  paras.map((t) => `<P ParaShape="0" Style="0"><TEXT CharShape="0"><CHAR>${esc(t)}</CHAR></TEXT></P>`).join("") +
  "</SECTION></BODY><TAIL/></HWPML>";

/** 아주 작은 ZIP 묶음 (.hwpx) */
function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text, store] of files) {
    const data = Buffer.from(text, "utf8");
    const body = store ? data : deflateRawSync(data);
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(store ? 0 : 8, 8);
    head.writeUInt32LE(crc, 14); head.writeUInt32LE(body.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(nameBuf.length, 26);
    locals.push(head, nameBuf, body);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(store ? 0 : 8, 10);
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(body.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(nameBuf.length, 28); cen.writeUInt32LE(offset, 42);
    centrals.push(cen, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const cenSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cenSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

const hwpx = (paras) =>
  zip([
    ["mimetype", "application/hwp+zip", true],
    ["META-INF/container.xml", '<?xml version="1.0" encoding="UTF-8"?><ocf:container xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container"><ocf:rootfiles><ocf:rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/></ocf:rootfiles></ocf:container>'],
    [
      "Contents/section0.xml",
      '<?xml version="1.0" encoding="UTF-8"?><hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">' +
        paras.map((t, i) => `<hp:p id="${i}" paraPrIDRef="0" styleIDRef="0"><hp:run charPrIDRef="0"><hp:t>${esc(t)}</hp:t></hp:run></hp:p>`).join("") +
        "</hs:sec>",
    ],
  ]);

// ── 등기부 그리기 ───────────────────────────────────────────────────
/** 표 하나: title(칸 하나짜리 제목 줄, 없을 수 있음), head(머리 칸들), widths(%), rows */
const table = (title, head, widths, rows, opt = {}) => ({ title, head, widths, rows, ...opt });
const lines = (...ls) => ls.filter((l) => l !== null && l !== undefined);

function registryTables(c) {
  const p = c.place;
  const regDate = "2001년4월30일";
  const floors = Array.from({ length: Math.min(p.floor + 3, 25) }, (_, k) => `${k + 1}층  ${k === 0 ? "536.48" : "529.76"}㎡`);
  const building = table(
    "【  표   제   부  】  ( 1동의 건물의 표시 )",
    ["표시번호", "접    수", "소재지번,건물명칭 및 번호", "건 물 내 역", "등기원인 및 기타사항"],
    [9, 15, 26, 25, 25],
    [
      { struck: true, cells: [["1"], [regDate], lines(p.loc, p.lot, `${p.complex} ${p.dong}`), lines(p.structure, `평스라브지붕 ${floors.length}층 아파트`, ...floors.slice(0, 6)), ["도시개발사업시행으로", "인하여 등기", "도면편철장 제3책 267장"]] },
      { cells: [["2"], [""], lines(p.loc, p.lot, `${p.complex} ${p.dong}`, "[도로명주소]", p.road), lines(p.structure, `평스라브지붕 ${floors.length}층 아파트`, ...floors), ["도로명주소", "2014년5월15일  등기"]] },
    ],
  );
  const land = table(
    "( 대지권의 목적인 토지의 표시 )",
    ["표시번호", "소 재 지 번", "지  목", "면  적", "등기원인 및 기타사항"],
    [9, 33, 11, 12, 35],
    [{ cells: [["1"], [`1. ${p.loc}`, `   ${p.lot}`], ["대"], [`${p.land}㎡`], [regDate]] }],
    { center: true },
  );
  const unit = table(
    "【  표   제   부  】  ( 전유부분의 건물의 표시 )",
    ["표시번호", "접    수", "건 물 번 호", "건 물 내 역", "등기원인 및 기타사항"],
    [9, 15, 18, 19, 39],
    [{ cells: [["1"], [regDate], [`제${p.floor}층 제${p.ho}호`], [p.structure.length > 9 ? p.structure.slice(0, 9) : p.structure, p.structure.length > 9 ? p.structure.slice(9) : null, `${p.area}㎡`].filter(Boolean), ["도면편철장 제3책267장"]] }],
  );
  const landRight = table(
    "( 대지권의 표시 )",
    ["표시번호", "대지권종류", "대지권비율", "등기원인 및 기타사항"],
    [9, 26, 25, 40],
    [{ cells: [["1"], ["1 소유권대지권"], [`${p.land}분의`, p.ratio], ["2001년4월20일 대지권", "2001년4월30일 등기"]] }],
    { center: true },
  );
  const gap = table(
    "【  갑      구  】  ( 소유권에 관한 사항 )",
    ["순위번호", "등 기 목 적", "접    수", "등 기 원 인", "권리자 및 기타사항"],
    [9, 18, 15, 15, 43],
    [
      { cells: [["1"], ["소유권보존"], [regDate, "제21004호"], [""], ["소유자  가상주택조합  110171-*******", "   서울특별시 성동구 가람로 1"]] },
      { cells: [["2"], ["소유권이전"], ["2009년6월12일", "제41188호"], ["2009년5월2일", "매매"], [`소유자  ${c.owner}  800101-*******`, `   ${c.eul.find((e) => e.debtorAddr)?.debtorAddr ?? ""}`, "거래가액 금540,000,000원"]] },
      { cells: [["3"], ["가압류"], ["2026년7월16일", "제3855975호"], ["2026년7월14일", "가압류결정"], ["청구금액  금12,369,920원", "채권자  가상카드 주식회사"]] },
    ],
  );
  const eulRows = c.eul.map((e) => {
    if (e.kind === "cancel") {
      const t = e.targets;
      const purpose = t.length === 1 ? [`${t[0]}번근저당권설정등`, "기말소"] : [...t.slice(0, -1).map((x) => `${x}번근저당권설정,`), `${t[t.length - 1]}번근저당권설정`, "등기말소"];
      return { cells: [[e.rank], purpose, [e.date, e.receipt], [e.date, "해지"], [""]] };
    }
    // 근저당권변경 부기등기: 바뀐 채권최고액만 적는다 (2026-11-07 추가)
    if (e.kind === "change") {
      return { struck: e.struck, cells: [[e.rank], [`${e.parent}번근저당권변경`], [e.date, e.receipt], [e.date, "변경계약"], [`채권최고액  금${won(e.amount)}원`]] };
    }
    if (e.kind === "transfer") {
      const [name, id] = e.holder;
      return {
        struck: e.struck,
        cells: [[e.rank], [`${e.parent}번근저당권이전`], [e.date, e.receipt], [e.date, "확정채권양도"], name.length > 10 ? [`근저당권자  ${name}`, `            ${id}`, `   ${e.holderAddr}`] : [`근저당권자  ${name}  ${id}`, `   ${e.holderAddr}`]],
      };
    }
    const [name, id] = e.holder;
    return {
      struck: e.struck,
      target: !e.struck,
      cells: [
        [e.rank],
        ["근저당권설정"],
        [e.date, e.receipt],
        [e.date, "설정계약"],
        [
          `채권최고액  금${won(e.amount)}원`,
          `채무자  ${e.debtor}`,
          `      ${e.debtorAddr}`,
          // 공동 채무자: 칸 이름 없이 이름 줄·주소 줄을 이어 적는다
          ...(e.coDebtor ? [`      ${e.coDebtor.name}`, `      ${e.coDebtor.addr}`] : []),
          ...(name.length > 10 ? [`근저당권자  ${name}`, `            ${id}`] : [`근저당권자  ${name}  ${id}`]),
          `      ${e.holderAddr}`,
        ],
      ],
    };
  });
  const eul = table("【  을      구  】  ( 소유권 이외의 권리에 관한 사항 )", ["순위번호", "등 기 목 적", "접    수", "등 기 원 인", "권리자 및 기타사항"], [9, 17, 15, 15, 44], eulRows);
  return [building, land, unit, landRight, gap, eul];
}

function summaryPage(c) {
  const p = c.place;
  const live = c.eul.filter((e) => e.kind === "mortgage" && !e.struck);
  const row = (cells) => `<tr>${cells.map((x) => `<td>${x}</td>`).join("")}</tr>`;
  return `<div class="page summary">
  <h1>주요 등기사항 요약 (참고용)</h1>
  <div class="notice"><div class="nt">[ 주 의 사 항 ]</div>본 주요 등기사항 요약은 증명서상에 말소되지 않은 사항을 간략히 요약한 것으로 증명서로서의 기능을 제공하지 않습니다.<br>실제 권리사항 파악을 위해서는 발급된 증명서를 필히 확인하시기 바랍니다.</div>
  <div class="uid">고유번호 1111-2001-00${String(2600 + p.ho).slice(-4)}</div>
  <div class="hdr">[집합건물] ${esc(p.loc)} ${esc(p.lot)} ${esc(p.complex)} ${esc(p.dong)} 제${p.floor}층 제${p.ho}호</div>
  <h3>1. 소유지분현황 ( 갑구 )</h3>
  <table class="s"><tr><th>등기명의인</th><th>(주민)등록번호</th><th>최종지분</th><th>주 소</th><th>순위번호</th></tr>${row([`${c.owner} (소유자)`, "800101-*******", "단독소유", esc(c.eul.find((e) => e.debtorAddr)?.debtorAddr ?? ""), "2"])}</table>
  <h3>3. (근)저당권 및 전세권 등 ( 을구 )</h3>
  <table class="s"><tr><th>순위번호</th><th>등기목적</th><th>접수정보</th><th>주요등기사항</th><th>대상소유자</th></tr>
  ${live.map((e) => row([e.rank, "근저당권설정", `${e.date}<br>${e.receipt}`, `채권최고액  금${won(e.newAmount ?? e.amount)}원<br>근저당권자  ${esc(e.holder[0])}`, c.owner])).join("")}</table>
  <div class="foot">출력일시 : 2026년 10월 28일 오후 4시50분46초<br>1/1</div>
</div>`;
}

const CSS = `
* { box-sizing: border-box; }
body { margin: 0; background: #fff; font-family: 'RegFont', serif; color: #000; -webkit-text-stroke: 0.25px #000; }
.page { width: 794px; height: 1123px; position: relative; padding: 70px 24px 60px 24px; overflow: hidden; background: #fff; }
.page .hdr { font-size: 13.5px; margin: 6px 0 6px 0; white-space: pre; }
.cert h1 { text-align: center; font-size: 24px; margin: 18px 0 2px 0; font-weight: 700; }
.cert h2 { text-align: center; font-size: 22px; margin: 0 0 10px 0; font-weight: 700; }
.uid { text-align: right; font-size: 13.5px; margin: 4px 6px 10px 0; }
table.reg { width: 100%; border-collapse: collapse; font-size: 13.3px; }
table.reg td { border: 1px solid #222; vertical-align: top; padding: 6px 5px 6px 6px; line-height: 1.55; }
table.reg tr.title td { background: #f3f3f3; font-size: 15px; padding: 9px 0 9px 50px; }
table.reg tr.title.center td { text-align: center; padding-left: 0; background: #fff; }
table.reg tr.head td { text-align: center; vertical-align: middle; padding: 9px 2px; }
table.reg td.c0 { text-align: center; }
.ln { white-space: pre; }
tr.struck .ln { display: table; text-decoration: line-through; text-decoration-thickness: 1.2px; }
.gap { height: 14px; }
.foot { position: absolute; left: 24px; right: 24px; bottom: 26px; font-size: 13.3px; }
.foot .pg { text-align: center; margin-top: 4px; }
.wm { position: absolute; left: 0; right: 0; top: 520px; text-align: center; font-size: 84px; color: rgba(0,0,0,0.06); -webkit-text-stroke: 0; letter-spacing: 60px; pointer-events: none; }
.summary h1 { text-align: center; font-size: 26px; margin: 10px 0 18px; }
.summary .notice { border: 1px solid #222; padding: 18px 12px 12px; font-size: 13.3px; font-weight: 700; line-height: 1.7; position: relative; }
.summary .notice .nt { position: absolute; top: -10px; left: 0; right: 0; text-align: center; }
.summary h3 { font-size: 15px; margin: 18px 0 8px; font-weight: 400; }
table.s { width: 100%; border-collapse: collapse; font-size: 13.3px; }
table.s td, table.s th { border: 1px solid #222; padding: 6px; font-weight: 400; text-align: left; vertical-align: top; }
.summary .foot { text-align: right; }
svg.pen { position: absolute; left: 0; top: 0; pointer-events: none; }
`;

/** 브라우저 안에서 표를 페이지로 나눈다 (넘치면 다음 페이지에 머리 줄을 다시 그린다) */
const PAGINATE = `
window.paginate = (spec) => {
  const book = document.getElementById('book');
  const pages = [];
  const newPage = (first) => {
    const pg = document.createElement('div');
    pg.className = 'page' + (first ? ' cert' : '');
    pg.innerHTML = (first ? '<h1>등기사항전부증명서(말소사항 포함)</h1><h2>- 집합건물 -</h2><div class="uid">' + spec.uid + '</div>' : '') +
      '<div class="hdr">' + spec.header + '</div><div class="body"></div><div class="wm">열람용</div><div class="foot"><div>열람일시 : 2026년10월28일 16시50분46초</div><div class="pg"></div></div>';
    book.appendChild(pg);
    pages.push(pg);
    return pg;
  };
  const limit = (pg) => pg.clientHeight - 70;
  const bottom = (pg) => { const b = pg.querySelector('.body'); return b.offsetTop + b.offsetHeight; };
  let pg = newPage(true);
  const mkTable = (t) => {
    const tb = document.createElement('table'); tb.className = 'reg';
    const cg = document.createElement('colgroup');
    t.widths.forEach((w) => { const c = document.createElement('col'); c.style.width = w + '%'; cg.appendChild(c); });
    tb.appendChild(cg); return tb;
  };
  const cell = (ls, i) => '<td class="c' + i + '">' + ls.map((l) => { const ind = l.length - l.trimStart().length; return '<div class="ln" style="padding-left:' + (ind * 0.5) + 'em">' + (l.trim() === '' ? '&nbsp;' : l.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;')) + '</div>'; }).join('') + '</td>';
  const headRow = (t) => { const tr = document.createElement('tr'); tr.className = 'head'; tr.innerHTML = t.head.map((h) => '<td>' + h + '</td>').join(''); return tr; };
  for (const t of spec.tables) {
    let tb = mkTable(t);
    if (t.gapBefore) { const g = document.createElement('div'); g.className = 'gap'; pg.querySelector('.body').appendChild(g); }
    pg.querySelector('.body').appendChild(tb);
    const tr0 = document.createElement('tr'); tr0.className = 'title' + (t.center ? ' center' : '');
    tr0.innerHTML = '<td colspan="' + t.head.length + '">' + t.title + '</td>';
    tb.appendChild(tr0); tb.appendChild(headRow(t));
    if (bottom(pg) > limit(pg) - 60) { tb.remove(); pg = newPage(false); tb = mkTable(t); pg.querySelector('.body').appendChild(tb); tb.appendChild(tr0); tb.appendChild(headRow(t)); }
    t.rows.forEach((r, ri) => {
      const tr = document.createElement('tr');
      if (r.struck) tr.className = 'struck';
      if (r.target) tr.dataset.target = '1';
      tr.innerHTML = r.cells.map(cell).join('');
      tb.appendChild(tr);
      if (bottom(pg) > limit(pg)) {
        tr.remove();
        pg = newPage(false);
        tb = mkTable(t); pg.querySelector('.body').appendChild(tb); tb.appendChild(headRow(t)); tb.appendChild(tr);
      }
    });
  }
  pages.forEach((p, i) => { p.querySelector('.pg').textContent = (i + 1) + '/' + pages.length; });
  // 볼펜 필기: 이전할 근저당권의 순위번호에 동그라미, 채권최고액·근저당권자 옆에 체크
  if (spec.pen) {
    document.querySelectorAll('tr[data-target="1"]').forEach((tr) => {
      const p = tr.closest('.page'); const pr = p.getBoundingClientRect();
      const r0 = tr.cells[0].getBoundingClientRect(); const r4 = tr.cells[4].getBoundingClientRect();
      // 실제 스캔본의 볼펜 자국: 인쇄 글자보다 옅은 회색(밝기 가운데값 약 155)이고, 숫자 둘레를 넉넉히 감싼다 (2026-11-06 실제 서류에서 잼)
      const x = r0.left - pr.left + r0.width / 2, y = r0.top - pr.top + 18;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'pen'); svg.setAttribute('width', 794); svg.setAttribute('height', 1123);
      const cx = r4.left - pr.left + r4.width - 30, cy = r4.top - pr.top + 16;
      svg.innerHTML = '<path d="M ' + (x + 14) + ' ' + (y - 22) + ' C ' + (x - 18) + ' ' + (y - 26) + ', ' + (x - 30) + ' ' + (y + 4) + ', ' + (x - 14) + ' ' + (y + 20) +
        ' C ' + (x + 2) + ' ' + (y + 30) + ', ' + (x + 30) + ' ' + (y + 22) + ', ' + (x + 28) + ' ' + (y - 2) + '" fill="none" stroke="#9a9a9a" stroke-width="1.4" stroke-linecap="round"/>' +
        '<path d="M ' + cx + ' ' + (cy - 2) + ' l 5 9 l 10 -16" fill="none" stroke="#9a9a9a" stroke-width="1.3" stroke-linecap="round"/>';
      p.appendChild(svg);
    });
  }
  return pages.length;
};`;

function registryHtml(c) {
  const p = c.place;
  const tables = registryTables(c).map((t, i) => ({ ...t, gapBefore: i === 2 || i === 4 || i === 5 }));
  return `<!doctype html><html><head><meta charset="utf-8"><style>${FONT_FACE}${CSS}</style><script>${PAGINATE}</script></head><body>
${c.look.summary ? summaryPage(c) : ""}
<div id="book"></div>
<script>window.SPEC = ${JSON.stringify({
    uid: `고유번호 1111-2001-00${String(2600 + p.ho).slice(-4)}`,
    header: esc(`[집합건물] ${p.loc} ${p.lot} ${p.complex} ${p.dong} 제${p.floor}층 제${p.ho}호`),
    tables,
    pen: !!c.look.pen,
  })};</script></body></html>`;
}

// ── 스캔처럼 만들기 ─────────────────────────────────────────────────
function noiseRng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

async function scan(png, seed, skew) {
  // 회색조로 바꾸고 아주 살짝 흐리게(스캐너 초점), 잡티와 밝기 흔들림을 넣는다
  let img = sharp(png).greyscale().blur(0.55);
  if (skew) img = img.rotate(0.04, { background: { r: 255, g: 255, b: 255 } });
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const rnd = noiseRng(seed);
  for (let i = 0; i < data.length; i++) {
    let v = data[i] + (rnd() - 0.5) * 18;
    if (rnd() < 0.00004) v = 60 + rnd() * 80; // 먼지 점
    data[i] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 1 } }).jpeg({ quality: 82 }).toBuffer();
}

/** JPEG 사진들을 한 페이지씩 담은 PDF (A4) */
function pdfOf(jpegs, sizes) {
  const objs = [];
  const add = (body) => objs.push(body) && objs.length;
  const catalog = add(null);
  const pagesId = add(null);
  const kids = [];
  jpegs.forEach((j, i) => {
    const { width, height } = sizes[i];
    const im = add({ dict: `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /DCTDecode /Length ${j.length} >>`, stream: j });
    const content = Buffer.from(`q 595.28 0 0 841.89 0 0 cm /Im0 Do Q`);
    const ct = add({ dict: `<< /Length ${content.length} >>`, stream: content });
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 ${im} 0 R >> >> /Contents ${ct} 0 R >>`));
  });
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  const parts = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  const offsets = [];
  let pos = parts[0].length;
  objs.forEach((o, i) => {
    offsets.push(pos);
    const chunk = typeof o === "string"
      ? Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, "latin1")
      : Buffer.concat([Buffer.from(`${i + 1} 0 obj\n${o.dict}\nstream\n`, "latin1"), o.stream, Buffer.from("\nendstream\nendobj\n", "latin1")]);
    parts.push(chunk);
    pos += chunk.length;
  });
  const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${pos}\n%%EOF\n`;
  parts.push(Buffer.from(xref, "latin1"));
  return Buffer.concat(parts);
}

// ── 만들기 ──────────────────────────────────────────────────────────
const cases = buildCases();
const only = process.env.CASES?.split(",");
// HANGUL_ONLY=1: 등기부는 그대로 두고 한글 파일만 다시 쓴다 (형식만 바꿀 때, 몇 초)
const hangulOnly = process.env.HANGUL_ONLY === "1";
const HANGUL_FILES = ["양도증서.hwpx", "양도증서.hml", "양도증서.hwp"];
const HANGUL_EXT = { hwpx: ".hwpx", hml: ".hml", hwp5: ".hwp", hwp3: ".hwp" };
/** 한글 파일 하나를 정한 형식으로 쓴다. 이 생성기가 전에 만든 다른 형식 한글 파일은 지운다 (건마다 한글 파일은 하나) */
function writeHangul(c, dir) {
  const paras = hwpParagraphs(c);
  const name = `양도증서${HANGUL_EXT[c.format]}`;
  for (const f of HANGUL_FILES) if (f !== name && existsSync(join(dir, f))) rmSync(join(dir, f));
  const data = { hwpx: () => hwpx(paras), hml: () => Buffer.from(hml(paras), "utf8"), hwp5: () => hwp5(paras), hwp3: () => hwp3(paras) }[c.format]();
  writeFileSync(join(dir, name), data);
}
if (existsSync(outDir) && !only && !hangulOnly) rmSync(outDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

const browser = hangulOnly ? null : await chromium.launch();
const ctx = await browser?.newContext({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 3.125 });
for (const c of cases) {
  if (only && !only.includes(c.folder)) continue;
  const dir = join(outDir, c.folder);
  mkdirSync(dir, { recursive: true });
  writeHangul(c, dir);
  if (hangulOnly) {
    console.log(`${c.folder}: ${c.format} (한글 파일만)`);
    continue;
  }

  // 부동산마다 등기부 하나. 공동담보(부동산 2개)면 두 등기부를 한 PDF로 이어 붙인다 (사용자가 실제로 합쳐서 올림, 2026-11-07)
  const jpegs = [];
  const sizes = [];
  for (const [r, place] of [c.place, c.place2].filter(Boolean).entries()) {
    const page = await ctx.newPage();
    // 글꼴 파일 옆에 페이지를 써서 연다 (페이지 안에 글꼴을 통째로 넣기엔 크다)
    const htmlPath = join(buildDir, `registry-${c.folder}-${r + 1}.html`);
    writeFileSync(htmlPath, registryHtml({ ...c, place }), "utf8");
    await page.goto(`file://${htmlPath}`, { waitUntil: "load" });
    const font = await page.evaluate(async () => (await document.fonts.load("16px 'RegFont'", "가나다123")).length > 0);
    if (!font) throw new Error("글꼴을 불러오지 못했습니다");
    await page.evaluate(() => window.paginate(window.SPEC));
    const pages = page.locator(".page");
    const count = await pages.count();
    for (let k = 0; k < count; k++) {
      const png = await pages.nth(k).screenshot({ type: "png" });
      const at = jpegs.length;
      const jpg = await scan(png, Number(c.folder.slice(-4)) * 100 + at, !!c.look.skew && at % 2 === 1);
      const meta = await sharp(jpg).metadata();
      jpegs.push(jpg);
      sizes.push({ width: meta.width, height: meta.height });
    }
    await page.close();
  }
  const n = jpegs.length;
  writeFileSync(join(dir, "등기사항전부증명서.pdf"), pdfOf(jpegs, sizes));
  console.log(`${c.folder}: ${c.format}, 등기부 ${n}쪽, ${c.expected}${c.errors.length ? ` (${c.errors.map((e) => e.desc).join(", ")})` : ""}`);
}
await browser?.close();

// 정답표 (시험이 읽는 json과 사람이 보는 md)
const FORMAT_LABEL = { hwpx: ".hwpx", hml: ".hml", hwp5: ".hwp (5.x)", hwp3: ".hwp (3.0)" };
const answers = cases.map((c) => ({ folder: c.folder, expected: c.expected, errors: c.errors.map((e) => ({ key: e.key, desc: e.desc })) }));
if (!only) {
  writeFileSync(join(outDir, "정답표.json"), JSON.stringify(answers, null, 2), "utf8");
  writeFileSync(
    join(outDir, "정답표.md"),
    "# 시험용 서류 20건 정답표 (가짜 서류)\n\n| 건 | 한글 형식 | 특징 | 기대 결과 | 심어 둔 오류 |\n|---|---|---|---|---|\n" +
      cases.map((c) => `| ${c.folder} | ${FORMAT_LABEL[c.format]} | ${c.notes.join(", ") || "-"} | ${c.expected} | ${c.errors.map((e) => `${e.key}: ${e.desc}`).join(", ") || "-"} |`).join("\n") +
      "\n",
    "utf8",
  );
}
