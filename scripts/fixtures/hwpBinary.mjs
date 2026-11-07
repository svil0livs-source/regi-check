// 시험용 가짜 서류의 한글 파일을 구버전 이진 형식(.hwp)으로 쓴다 (2026-11-07 사용자 요청: .hwp도 20건 시험에 넣기).
// 실제로 많이 쓰는 .hwp(한글 2002 이후 HWP 5.x, 한글 97 이하 HWP 3.0)로 앱의 읽기 경로를 끝까지 시험하기 위한 것이다.
// 문단 글자만 담은 최소 파일이라 앱(src/lib/readers/hwpText.ts·hwp3Text.ts)은 읽지만, 한글 프로그램에서는 열리지 않을 수 있다.
//   - HWP 5.x: 묶음 파일(CFB) 안에 FileHeader(압축 표시) + DocInfo + BodyText/Section0(압축한 PARA_HEADER·PARA_TEXT 레코드)
//   - HWP 3.0: 서명(30) + 문서 정보(128, 압축 표시) + 문서 요약(1008) + 압축한 본문(글꼴 0개·스타일 0개·문단 목록)
//     한글 글자는 조합형 2바이트, 0x3400보다 앞쪽 글자(㎡·【】·『』 등)는 요즘 한글이 3.0으로 저장할 때처럼 유니코드 그대로 쓴다.
import CFB from "cfb";
import { deflateRawSync } from "node:zlib";

// ── HWP 5.x ─────────────────────────────────────────────────────────
const record = (tag, level, data) => {
  if (data.length >= 0xfff) {
    const head = Buffer.alloc(8);
    head.writeUInt32LE((tag | (level << 10) | (0xfff << 20)) >>> 0, 0);
    head.writeUInt32LE(data.length, 4);
    return Buffer.concat([head, data]);
  }
  const head = Buffer.alloc(4);
  head.writeUInt32LE((tag | (level << 10) | (data.length << 20)) >>> 0, 0);
  return Buffer.concat([head, data]);
};
const PARA_HEADER = 66;
const PARA_TEXT = 67;

/** 문단 글자들 → HWP 5.x 파일 */
export function hwp5(paras) {
  const body = Buffer.concat(
    paras.flatMap((t) => {
      const text = Buffer.from(`${t}\r`, "utf16le");
      const header = Buffer.alloc(22);
      header.writeUInt32LE(text.length / 2, 0); // 글자 수
      return [record(PARA_HEADER, 0, header), record(PARA_TEXT, 1, text)];
    }),
  );
  const fileHeader = Buffer.alloc(256);
  fileHeader.write("HWP Document File", 0, "latin1");
  fileHeader.writeUInt32LE(0x05000300, 32); // 버전 5.0.3.0
  fileHeader.writeUInt32LE(1, 36); // 압축
  const cfb = CFB.utils.cfb_new();
  CFB.utils.cfb_add(cfb, "/FileHeader", fileHeader);
  CFB.utils.cfb_add(cfb, "/DocInfo", deflateRawSync(Buffer.alloc(0)));
  CFB.utils.cfb_add(cfb, "/BodyText/Section0", deflateRawSync(body));
  return Buffer.from(CFB.write(cfb, { type: "buffer" }));
}

// ── HWP 3.0 ─────────────────────────────────────────────────────────
// 조합형 중성 코드 (유니코드 중성 순서 ㅏ~ㅣ)
const JUNG_CODE = [3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 15, 18, 19, 20, 21, 22, 23, 26, 27, 28, 29];

/** 유니코드 글자 하나 → 한글 3.0 2바이트 글자 */
function hchar(ch) {
  const u = ch.codePointAt(0);
  if (u >= 0xac00 && u <= 0xd7a3) {
    const s = u - 0xac00;
    const cho = Math.floor(s / 588) + 2;
    const jung = JUNG_CODE[Math.floor((s % 588) / 28)];
    const jo = s % 28;
    const jong = jo <= 16 ? jo + 1 : jo + 2; // 조합형 종성은 18번이 비어 있다
    return 0x8000 | (cho << 10) | (jung << 5) | jong;
  }
  // 0x3013~0x305F는 3.0에서 선 그리기 문자라 쓰면 안 된다
  if (u < 0x3400 && u !== 0x81 && u !== 0x82 && u !== 0x83 && u !== 0x84 && !(u >= 0x3013 && u < 0x3013 + 77) && !(u >> 8 === 0x1f)) return u;
  throw new Error(`한글 3.0으로 쓸 수 없는 글자: U+${u.toString(16)}`);
}

const CHAR_SHAPE_LEN = 31;
/** 문단 머리: 앞 문단 모양 다시 쓰기(1), 글자 수, 줄 수 0, 글자 모양 없음 */
const paraHead = (nch) => {
  const b = Buffer.alloc(1 + 2 + 2 + 1 + 1 + 4 + 1 + CHAR_SHAPE_LEN);
  b[0] = 1;
  b.writeUInt16LE(nch, 1);
  return b;
};

/** 문단 글자들 → HWP 3.0 파일 */
export function hwp3(paras) {
  const parts = [];
  for (let lang = 0; lang < 7; lang++) parts.push(Buffer.alloc(2)); // 언어마다 글꼴 0개
  parts.push(Buffer.alloc(2)); // 스타일 0개
  for (const t of paras) {
    const codes = [...t].map(hchar);
    codes.push(13); // 문단 끝
    const chars = Buffer.alloc(codes.length * 2);
    codes.forEach((c, i) => chars.writeUInt16LE(c, i * 2));
    parts.push(paraHead(codes.length), chars);
  }
  parts.push(paraHead(0)); // 목록 끝
  const sig = Buffer.alloc(30);
  sig.write("HWP Document File V3.00 \x1a\x01\x02\x03\x04\x05", 0, "latin1");
  const info = Buffer.alloc(128);
  info[124] = 1; // 압축
  info.writeUInt16LE(0, 126); // 정보 블록 길이
  return Buffer.concat([sig, info, Buffer.alloc(1008), deflateRawSync(Buffer.concat(parts))]);
}
