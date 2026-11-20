// 비용 청구 검증 시험용 가짜 서류 만들기 (2026-11-20). 실제 양식 샘플을 받기 전이라 흔한 모양을 흉내 낸 가상 자료다.
// 실행: node scripts/fixtures/make-cost-fixtures.mjs   (Playwright·Chromium 필요. 글꼴은 근이전 시험 서류와 같은 Noto Serif KR)
// 결과: tests/fixtures/cost/<건>/청구서.pdf · 영수증.pdf, tests/fixtures/cost/정답표.json
//   cost-01: 스캔 청구서 1쪽 + 영수증 3쪽(한 쪽에 영수증 2장, 같은 날 같은 금액 발급 영수증 2장) → 전부 일치
//   cost-02: 스캔 → 제증명 금액 불일치, 등기신청수수료 영수증 누락, 청구서에 없는 인지세 영수증
//   cost-03: 글자 PDF 청구서·영수증, 등록면허세와 지방교육세를 한 줄로 청구 → 전부 일치
//   cost-04: 영수증 한 쪽을 아주 흐리게 스캔(글자 읽기 오류 시험) → 「전부 일치」가 나오면 안 됨
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const sharp = require("sharp");

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const buildDir = join(root, "tests", "fixtures-build");
const outDir = join(root, "tests", "fixtures", "cost");
mkdirSync(buildDir, { recursive: true });
const fontPath = join(buildDir, "NotoSerifKR.ttf");
if (!existsSync(fontPath)) execFileSync("curl", ["-sSfL", "-o", fontPath, "https://raw.githubusercontent.com/google/fonts/main/ofl/notoserifkr/NotoSerifKR%5Bwght%5D.ttf"]);

const won = (n) => n.toLocaleString("ko-KR");
const CSS = `@font-face { font-family: 'F'; src: url('NotoSerifKR.ttf') format('truetype'); font-weight: 100 900; }
body { margin: 0; font-family: 'F', serif; color: #000; background: #fff; -webkit-text-stroke: 0.2px #000; }
.page { width: 794px; height: 1123px; box-sizing: border-box; padding: 60px 64px; position: relative; }
h1 { text-align: center; font-size: 26px; letter-spacing: 6px; margin: 0 0 24px; }
table { width: 100%; border-collapse: collapse; font-size: 15px; }
td, th { border: 1px solid #000; padding: 7px 10px; }
th { background: #eee; font-weight: 600; }
.r { text-align: right; }
.meta { font-size: 14px; line-height: 1.9; margin-bottom: 16px; }
.rc { border: 2px solid #000; padding: 18px 22px; margin-bottom: 28px; font-size: 15px; line-height: 1.85; }
.rc h2 { text-align: center; font-size: 20px; margin: 0 0 10px; letter-spacing: 3px; }
.foot { margin-top: 28px; font-size: 14px; line-height: 1.9; }`;

// ── 청구서 ──
function claimHtml({ fees, expenses, total }) {
  const row = (sec, [k, v], i, n) => `<tr>${i === 0 ? `<td rowspan="${n}" style="text-align:center;width:90px">${sec}</td>` : ""}<td>${k}</td><td class="r">${won(v)}</td><td></td></tr>`;
  return `<div class="page"><h1>비 용 청 구 서</h1>
<div class="meta">사건 : 근저당권이전등기<br>의뢰인 : 한국자산관리공사 귀중<br>청구일 : 2026. 11. 20.</div>
<table><tr><th>구분</th><th>항목</th><th>금액(원)</th><th>비고</th></tr>
${fees.map((f, i) => row("보수", f, i, fees.length)).join("")}
${expenses.map((f, i) => row("공과금", f, i, expenses.length)).join("")}
<tr><td colspan="2" style="text-align:center;font-weight:700">합 계</td><td class="r" style="font-weight:700">${won(total)}</td><td></td></tr></table>
<div class="foot">위와 같이 청구합니다.<br>입금계좌 : 신한은행 110-234-567890 (예금주 가나법무사사무소)<br>가나법무사사무소 법무사 김가나 (인)</div></div>`;
}

// ── 영수증 ──
const R = {
  localTax: (items, ref) =>
    `<div class="rc"><h2>지방세 납부확인서</h2>과세기관 : 서울특별시 강남구청<br>전자납부번호 : ${ref}<br>납부일자 : 2026-11-10<br>
<table><tr><th>세목</th><th>세액(원)</th></tr>${items.map(([k, v]) => `<tr><td>${k}</td><td class="r">${won(v)}</td></tr>`).join("")}
<tr><td>납부금액 합계</td><td class="r">${won(items.reduce((s, [, v]) => s + v, 0))}</td></tr></table></div>`,
  courtFee: (v, ref) =>
    `<div class="rc"><h2>등기신청수수료 현금영수필확인서</h2>수납기관 : 서울중앙지방법원 등기국<br>납부번호 : ${ref}<br>납부일자 : 2026-11-11<br>금액 : ${won(v)}원</div>`,
  bond: (face, cost, ref) =>
    `<div class="rc"><h2>국민주택채권 매입 영수증</h2>취급기관 : 우리은행 강남지점<br>승인번호 : ${ref}<br>매입일자 : 2026-11-10<br>채권매입금액 : ${won(face)}원<br>본인부담금(할인료) : ${won(cost)}원</div>`,
  cert: (v, ref) =>
    `<div class="rc"><h2>등기사항증명서 발급 수수료 영수증</h2>발급기관 : 대법원 인터넷등기소<br>발급번호 : ${ref}<br>발급일자 : 2026-11-10<br>발급 수수료 : ${won(v)}원</div>`,
  stamp: (v, ref) => `<div class="rc"><h2>전자수입인지 영수증</h2>판매기관 : 우체국<br>일련번호 : ${ref}<br>구입일자 : 2026-11-12<br>인지세 : ${won(v)}원</div>`,
};
const page = (...blocks) => `<div class="page">${blocks.join("")}</div>`;

const CASES = [
  {
    folder: "cost-01",
    look: "scan",
    claim: {
      fees: [["기본보수", 300000], ["누진보수", 50000], ["부가가치세", 35000], ["교통비", 20000]],
      expenses: [["등록면허세", 150000], ["지방교육세", 30000], ["국민주택채권 할인료", 12400], ["등기신청수수료", 15000], ["제증명 발급비", 2000]],
    },
    receipts: [
      page(R.localTax([["등록면허세", 150000], ["지방교육세", 30000]], "11680-1-26110-000123")),
      page(R.courtFee(15000, "2026-1110-334455"), R.bond(1300000, 12400, "77812345")),
      page(R.cert(1000, "1101-2026-0001234"), R.cert(1000, "1101-2026-0001235")),
    ],
    expected: { summary: "전부 일치", rows: { registration_tax: "match", education_tax: "match", housing_bond: "match", court_fee: "match", certificate: "match" }, extra: 0 },
  },
  {
    folder: "cost-02",
    look: "scan",
    claim: {
      fees: [["기본보수", 300000], ["부가가치세", 30000]],
      expenses: [["등록면허세", 150000], ["등기신청수수료", 15000], ["제증명 발급비", 20000]],
    },
    receipts: [page(R.localTax([["등록면허세", 150000]], "11680-1-26110-000456")), page(R.cert(15000, "1101-2026-0009876")), page(R.stamp(3000, "A2026-55501"))],
    expected: { summary: "불일치 있음", rows: { registration_tax: "match", court_fee: "missing", certificate: "mismatch" }, extra: 1 },
  },
  {
    folder: "cost-03",
    look: "text",
    claim: { fees: [["기본보수", 200000]], expenses: [["등록면허세 및 지방교육세", 180000], ["등기신청수수료", 15000]] },
    receipts: [page(R.localTax([["등록면허세", 150000], ["지방교육세", 30000]], "11680-1-26110-000789")), page(R.courtFee(15000, "2026-1111-778899"))],
    expected: { summary: "전부 일치", rows: { registration_tax: "match", court_fee: "match" }, extra: 0 },
  },
  {
    // 글자 읽기 오류 시험: 영수증 2쪽을 아주 흐리고 거칠게 스캔 → 금액을 믿을 수 없으므로 「전부 일치」가 나오면 안 된다
    folder: "cost-04",
    look: "scan",
    degrade: [1],
    claim: { fees: [["기본보수", 250000]], expenses: [["등록면허세", 96000], ["지방교육세", 19200], ["등기신청수수료", 15000]] },
    receipts: [page(R.localTax([["등록면허세", 96000], ["지방교육세", 19200]], "11680-1-26110-000999")), page(R.courtFee(15000, "2026-1112-111222"))],
    expected: { summary: "전부 일치 아님" },
  },
];

function noiseRng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
async function scan(png, seed, degrade = false) {
  // degrade: 1/5 크기로 줄였다 다시 키우고 크게 흐리게 (팩스·사진 찍은 영수증처럼 글자가 뭉개짐)
  // sharp는 한 번에 크기 바꾸기를 하나만 하므로 두 번에 나눈다
  const src = degrade ? await sharp(await sharp(png).resize({ width: 330 }).png().toBuffer()).resize({ width: 1654 }).blur(1.2).toBuffer() : png;
  const { data, info } = await sharp(src).greyscale().blur(0.55).raw().toBuffer({ resolveWithObject: true });
  const rnd = noiseRng(seed);
  for (let i = 0; i < data.length; i++) {
    let v = data[i] + (rnd() - 0.5) * 18;
    if (rnd() < 0.00004) v = 60 + rnd() * 80;
    data[i] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
  return { jpeg: await sharp(data, { raw: { width: info.width, height: info.height, channels: 1 } }).jpeg({ quality: 82 }).toBuffer(), width: info.width, height: info.height };
}
/** JPEG 사진들을 한 페이지씩 담은 PDF (A4) — 근이전 시험 서류 만들기와 같은 방식 */
function pdfOf(pages) {
  const objs = [];
  const add = (body) => objs.push(body) && objs.length;
  const catalog = add(null);
  const pagesId = add(null);
  const kids = [];
  for (const { jpeg, width, height } of pages) {
    const im = add({ dict: `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`, stream: jpeg });
    const content = Buffer.from("q 595.28 0 0 841.89 0 0 cm /Im0 Do Q");
    const ct = add({ dict: `<< /Length ${content.length} >>`, stream: content });
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 ${im} 0 R >> >> /Contents ${ct} 0 R >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  const parts = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  const offsets = [];
  let pos = parts[0].length;
  objs.forEach((o, i) => {
    offsets.push(pos);
    const chunk =
      typeof o === "string"
        ? Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, "latin1")
        : Buffer.concat([Buffer.from(`${i + 1} 0 obj\n${o.dict}\nstream\n`, "latin1"), o.stream, Buffer.from("\nendstream\nendobj\n", "latin1")]);
    parts.push(chunk);
    pos += chunk.length;
  });
  parts.push(Buffer.from(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${pos}\n%%EOF\n`, "latin1"));
  return Buffer.concat(parts);
}

const browser = await chromium.launch();
// 200dpi 스캔과 같은 크기 (A4 폭 1654px)
const ctx = await browser.newContext({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 1654 / 794 });
const tab = await ctx.newPage();
const htmlPath = join(buildDir, "cost-page.html");

async function load(body) {
  writeFileSync(htmlPath, `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>${CSS}</style></head><body>${body}</body></html>`);
  await tab.goto("file://" + htmlPath);
  await tab.evaluate(() => document.fonts.ready);
}
async function makePdf(pagesHtml, look, file, seed, degrade = []) {
  if (look === "text") {
    await load(pagesHtml.map((p) => p.replace('class="page"', 'class="page" style="page-break-after:always"')).join(""));
    writeFileSync(file, await tab.pdf({ width: "794px", height: "1123px", printBackground: true }));
    return;
  }
  const scans = [];
  for (const [i, p] of pagesHtml.entries()) {
    await load(p);
    scans.push(await scan(await tab.screenshot({ clip: { x: 0, y: 0, width: 794, height: 1123 } }), seed + i, degrade.includes(i)));
  }
  writeFileSync(file, pdfOf(scans));
}

const answers = [];
for (const [ci, c] of CASES.entries()) {
  const dir = join(outDir, c.folder);
  mkdirSync(dir, { recursive: true });
  const total = [...c.claim.fees, ...c.claim.expenses].reduce((s, [, v]) => s + v, 0);
  await makePdf([claimHtml({ ...c.claim, total })], c.look, join(dir, "청구서.pdf"), 1000 * (ci + 1));
  await makePdf(c.receipts, c.look, join(dir, "영수증.pdf"), 1000 * (ci + 1) + 100, c.degrade);
  answers.push({ folder: c.folder, look: c.look, total, ...c.expected });
}
writeFileSync(join(outDir, "정답표.json"), JSON.stringify(answers, null, 2) + "\n");
await browser.close();
console.log(`비용 검증 시험 서류 ${CASES.length}건을 만들었습니다.`);
