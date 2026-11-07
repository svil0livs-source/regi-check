// 신버전 한글(.hwpx)·한글 XML(.hml)·구버전 한글(HWP 3.0) 읽기 시험.
// 1) 작은 가짜 .hwpx를 직접 만들어 문단·표 칸 순서 확인 (서류 없이)
// 2) 시험용 신청서 20건을 한글로 .hwpx 저장한 파일(scripts/fixtures/make-hwpx.ps1)이 있으면,
//    .hwp에서 읽은 대조 항목과 똑같이 나오는지 확인
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { extractHwpFields } from "./hwpFields";
import { HwpReadError, readHwpParagraphs } from "./hwpText";
import { readHangulParagraphs } from "./hangulFile";
import { readHmlParagraphs, readHwpxParagraphs } from "./hwpxText";

/** 아주 작은 ZIP 만들기 (deflate) */
function makeZip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, "utf8");
    const data = deflateRawSync(Buffer.from(text, "utf8"));
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt16LE(nameBuf.length, 26);
    locals.push(lh, nameBuf, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const sec = (body: string) => `<?xml version="1.0"?><hs:sec xmlns:hs="s" xmlns:hp="p">${body}</hs:sec>`;
const p = (inner: string) => `<hp:p id="0"><hp:run>${inner}</hp:run></hp:p>`;
const t = (s: string) => `<hp:t>${s}</hp:t>`;

describe("readHmlParagraphs", () => {
  it("<BODY> 안 <P>·<CHAR>만 읽고, 표 칸 문단도 순서대로", () => {
    const xml = '<?xml version="1.0" encoding="UTF-8"?><HWPML><HEAD><TITLE>제목</TITLE></HEAD><BODY><SECTION>' +
      '<P><TEXT><CHAR>근저당권이전등기신청</CHAR></TEXT></P>' +
      '<P><TEXT><TABLE><ROW><CELL><PARALIST><P><TEXT><CHAR>⑤ 등기의무자</CHAR></TEXT></P></PARALIST></CELL></ROW></TABLE></TEXT></P>' +
      '</SECTION></BODY></HWPML>';
    expect(readHmlParagraphs(Buffer.from(xml))).toEqual(["근저당권이전등기신청", "⑤ 등기의무자"]);
  });
});

describe("readHangulParagraphs", () => {
  it("한글 파일이 아니면 받는 형식을 알려 준다", () => {
    expect(() => readHangulParagraphs(Buffer.from("hello"))).toThrow(/.hwp·.hwpx·.hml/);
  });
});

describe("readHwpxParagraphs", () => {
  it("문단 순서대로, 표가 든 문단은 표 앞 글자 → 칸 → 표 뒤 글자", () => {
    const table = `<hp:tbl><hp:tr><hp:tc><hp:subList>${p(t("⑤ 등기의무자"))}${p(t("주식회사 A&amp;B"))}</hp:subList></hp:tc></hp:tr></hp:tbl>`;
    const zip = makeZip({
      mimetype: "application/hwp+zip",
      "Contents/section1.xml": sec(p(t("둘째 구역"))),
      "Contents/section0.xml": sec(p(t("근저당권이전등기신청")) + `<hp:p><hp:run>${t("표 앞")}${table}${t("표 뒤")}</hp:run></hp:p>` + p(`${t("면")}<hp:t>적<hp:tab/>59.82㎡</hp:t>`)),
    });
    expect(readHwpxParagraphs(zip)).toEqual(["근저당권이전등기신청", "표 앞", "⑤ 등기의무자", "주식회사 A&B", "표 뒤", "면적\t59.82㎡", "둘째 구역"]);
  });

  it("한글 파일이 아닌 ZIP·깨진 파일은 이유를 알린다", () => {
    expect(() => readHwpxParagraphs(makeZip({ mimetype: "application/zip" }))).toThrow(HwpReadError);
    expect(() => readHwpxParagraphs(Buffer.from("PK\x03\x04broken", "latin1"))).toThrow(/손상/);
  });
});

// ── 시험용 가짜 서류 20건: 한글로 다른 형식으로 저장한 파일(scripts/fixtures/make-hangul-formats.ps1)에서도
//    .hwp(한글 2002 이후 형식)와 똑같은 대조 항목이 나오는지 ──
const root = process.cwd();
const FORMATS = [
  ["신버전 .hwpx", "hwpx", ".hwpx"],
  ["구버전 HWP 3.0", "hwp3", ".hwp"],
  ["한글 XML .hml", "hml", ".hml"],
] as const;

for (const [label, dir, ext] of FORMATS) {
  const base = join(root, "tests", "fixtures-build", dir);
  const pairs = existsSync(base)
    ? readdirSync(base)
        .filter((f) => f.endsWith(ext))
        .map((f) => [f.slice(0, -ext.length), join(base, f)] as const)
        .filter(([folder]) => existsSync(join(root, "tests", "fixtures", folder, "근저당권이전_신청서.hwp")))
    : [];
  describe.skipIf(pairs.length === 0)(`시험용 신청서 20건: ${label} = .hwp`, () => {
    it.each(pairs)("%s", (folder, path) => {
      const fromHwp = extractHwpFields(readHwpParagraphs(readFileSync(join(root, "tests", "fixtures", folder, "근저당권이전_신청서.hwp"))));
      const fromOther = extractHwpFields(readHangulParagraphs(readFileSync(path)));
      expect(fromOther).toEqual(fromHwp);
    });
  });
}

describe("시험용 .hwp 만들기(scripts/fixtures/hwpBinary.mjs)와 앱 읽기가 맞는지 (2026-11-07)", async () => {
  const { hwp3, hwp5 } = await import("../../../scripts/fixtures/hwpBinary.mjs");
  // 한글 완성형 11,172자 전부 + 양식에 나오는 기호
  const syllables = Array.from({ length: 11172 }, (_, i) => String.fromCharCode(0xac00 + i)).join("");
  const paras = [
    "【부동산의 표시】",
    "구조 및 면적 : 철근콘크리트구조 114.62㎡",
    "『금융회사부실자산등의 효율적 처리』제4조에 의하여 ㅇㅇㅇ(가) 양도",
    "2020년03월13일 접수 제14475호 순위 제3번으로 등기한 근저당권설정등기, (채권최고액 : 금 504,000,000원)",
    syllables,
  ];
  it("HWP 5.x로 쓴 글자를 그대로 읽는다", () => {
    expect(readHangulParagraphs(hwp5(paras))).toEqual(paras);
  });
  it("HWP 3.0으로 쓴 글자를 그대로 읽는다 (조합형 한글 포함)", () => {
    expect(readHangulParagraphs(hwp3(paras))).toEqual(paras);
  });
});
