// Design Ref: DESIGN.md §4 단계 2 — 구버전 한글 파일(HWP 3.0, 한글 97 이하)에서 본문 글자를 꺼낸다.
// (2026-11-05 사용자 결정: 구버전·신버전 한글 파일 모두 받음)
// 파일 구조는 공개된 「한글 97 파일 형식 3.0」과 LibreOffice hwpfilter(오픈소스)의 읽기 순서를 따랐다.
//   서명(30) → 문서 정보(128) → 문서 요약(1008) → 정보 블록(길이는 문서 정보에) → [압축이면 여기부터 deflate]
//   → 글꼴 이름(7개 언어) → 스타일 → 문단 목록. 표·글상자는 문단 안의 특수 문자(10번)로 들어가 칸마다 문단 목록을 가진다.
// 글자는 2바이트 한글 코드: 0x8000 이상은 조합형 한글, 0x4000~ 한자, 0x3400~ 특수 문자(KS 코드로 바꿔 EUC-KR 표로 읽음).
// 특수 문자는 0x3400 + (KS 행-0xA1)×96 + (KS 열-0xA0)로 이어 붙인 번호다 (예: ① = KS A8E7 = 0x36E7, 한글로 저장한 시험 파일로 확인).
// 서버 안에서만 읽고, 서류는 외부로 보내지 않는다. 결과 모양은 HWP 5.x 읽기(hwpText.ts)와 같다.

import { Buffer } from "buffer";
import { inflateAny } from "./inflate";
import { HwpReadError } from "./hwpText";

const SIGNATURE = "HWP Document File V3.00";
const DOC_INFO_LEN = 128;
const SUMMARY_LEN = 1008;
const CHAR_SHAPE_LEN = 31;
const PARA_SHAPE_LEN = 187;
const LINE_INFO_LEN = 14;
const CELL_LEN = 27;
const LANGUAGES = 7;
const FONT_NAME_LEN = 40;
const STYLE_LEN = 20 + CHAR_SHAPE_LEN + PARA_SHAPE_LEN;

/** 구버전(HWP 3.0) 한글 파일인지 */
export const isHwp3 = (b: Buffer) => b.subarray(0, SIGNATURE.length).toString("latin1") === SIGNATURE;

/** 특수 문자가 문단 글자 수(nch)에서 차지하는 칸 수 (LibreOffice hbox.cxx와 같음) */
const WSIZE = [1, 4, 4, 4, 4, 4, 4, 42, 48, 4, 4, 4, 4, 1, 4, 4, 4, 4, 4, 4, 4, 4, 12, 5, 3, 3, 123, 4, 32, 4, 2, 2];

const euckr = new TextDecoder("euc-kr");
const ksToUnicode = (ks: number): string => (ks > 0xa0a0 ? euckr.decode(Uint8Array.of(ks >> 8, ks & 0xff)) : "");

// 조합형 한글 → 유니코드 (완성형 글자와 낱자)
const CHO_JAMO = "  ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
const JUNG_INDEX: Record<number, number> = { 3: 0, 4: 1, 5: 2, 6: 3, 7: 4, 10: 5, 11: 6, 12: 7, 13: 8, 14: 9, 15: 10, 18: 11, 19: 12, 20: 13, 21: 14, 22: 15, 23: 16, 26: 17, 27: 18, 28: 19, 29: 20 };
const JUNG_JAMO = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ";
function johabHangul(ch: number): string {
  const cho = (ch >> 10) & 0x1f;
  const jung = (ch >> 5) & 0x1f;
  const jong = ch & 0x1f;
  const ji = JUNG_INDEX[jung];
  if (cho >= 2 && cho <= 20 && ji !== undefined && jong >= 1 && jong <= 29 && jong !== 18) {
    const jo = jong - (jong > 0x12 ? 2 : 1);
    return String.fromCharCode(0xac00 + (cho - 2) * 588 + ji * 28 + jo);
  }
  if (jung === 2 && jong === 1 && cho >= 2 && cho <= 20) return CHO_JAMO[cho]; // 자음만
  if (cho === 1 && jong === 1 && ji !== undefined) return JUNG_JAMO[ji]; // 모음만
  return "□";
}

// 한글 3.0 특수 문자(0x37C0~) → KS 코드 표 (LibreOffice hcode.cxx tblhhtg_ks)
const NONE = 0;
const HHTG_KS = [
  0xc7d1, 0xb1db, 0xb0fa, 0xc4c4, 0xc7bb, 0xc5cd, NONE, NONE, 0xa2b1, 0xa3df, 0xa2d5, 0xa6b1, 0xa1b8, 0xa1b9, 0xa3df, 0xa1da,
  0xa2c6, 0xa2cc, 0xa2cb, NONE, NONE, 0xa6be, 0xa6b9, 0xa6c1, 0xa6c2, 0xa6b4, 0xa6ad, 0xa6af, 0xa6b0, 0xa6c3, 0xa6c4, NONE,
  0xa6ae, 0xa6b0, 0xa2d7, 0xa1e1, 0xa1d6, NONE, 0xa6bc, 0xa6b7, 0xa6b1, 0xa6ae, 0xa6b5, 0xa6b3, 0xa6b2, 0xa6ac, 0xa6b6, 0xa6ba,
  0xa6bf, 0xa6b8, 0xa6bd, 0xa6c5, 0xa6c6, 0xa6c8, 0xa6c7, 0xa6c0, 0xa6bb, NONE, NONE, NONE, 0xa1e1, 0xa1e1, 0xa1e1, 0xa1e1,
];
const HANGUL_COMPUTER = ["한", "글", "과", "컴", "퓨", "터"]; // 0x37C0~0x37C5

/** 한글 3.0 2바이트 글자 하나 → 유니코드 글자 */
function hcharToText(ch: number): string {
  if (ch < 128) return String.fromCharCode(ch);
  if (ch & 0x8000) return johabHangul(ch);
  if ((ch & 0x4000) === 0x4000) {
    // 한자: KS 한자 영역으로 바꿔 읽는다 (대조할 때는 한자를 모두 지움)
    const index = ch - 0x4000;
    if (index >= 4888) return "□";
    return ksToUnicode(((Math.floor(index / 94) + 0xca) << 8) | ((index % 94) + 0xa1));
  }
  if (ch === 0x81 || ch === 0x82) return '"';
  if (ch === 0x83 || ch === 0x84) return "'";
  if (ch >= 0x3013 && ch < 0x3013 + 77) return " "; // 선 그리기 문자
  if (ch >= 0x37c0 && ch <= 0x37c5) return HANGUL_COMPUTER[ch - 0x37c0];
  const hi = ch >> 8;
  if (hi === 0x1f) {
    let row = 170;
    let col = ch & 0xff;
    if (col >= 0x60) {
      row++;
      col -= 0x60;
    }
    return ksToUnicode((row << 8) | (col + 160));
  }
  // 0x3400 앞쪽 코드: 요즘 한글이 3.0 형식으로 저장할 때 ※(0x203B)·가운뎃점(0xB7)처럼 유니코드를 그대로 쓴다
  if (hi < 0x34) return String.fromCharCode(ch);
  if (hi >= 0x38) return "□";
  if (ch >= 0x37c0) return ksToUnicode(HHTG_KS[ch - 0x37c0] ?? NONE) || "□";
  const k = ch - 0x3400;
  let row = Math.floor(k / 0x60) + 161;
  if (row === 170) row += 2;
  return ksToUnicode((row << 8) | ((k % 0x60) + 160)) || "□";
}

/** 바이트를 차례로 읽는 도구. 범위를 넘으면 손상된 파일로 본다. */
class Reader {
  pos = 0;
  constructor(private readonly buf: Buffer) {}
  private need(n: number) {
    if (n < 0 || this.pos + n > this.buf.length) throw new HwpReadError("한글 파일 본문이 손상돼 읽을 수 없습니다. 한글에서 다시 저장해 올려 주세요.");
  }
  u8() {
    this.need(1);
    return this.buf[this.pos++];
  }
  u16() {
    this.need(2);
    const v = this.buf.readUInt16LE(this.pos);
    this.pos += 2;
    return v;
  }
  u32() {
    this.need(4);
    const v = this.buf.readUInt32LE(this.pos);
    this.pos += 4;
    return v;
  }
  skip(n: number) {
    this.need(n);
    this.pos += n;
  }
  get done() {
    return this.pos >= this.buf.length;
  }
}

/** 문단 목록 읽기: 글자 수가 0인 문단이 목록의 끝 */
function readParaList(r: Reader, out: string[], depth: number): void {
  if (depth > 20) throw new HwpReadError("한글 파일 구조가 너무 깊어 읽을 수 없습니다.");
  for (;;) {
    const reuseShape = r.u8();
    const nch = r.u16();
    const nline = r.u16();
    const containCshape = r.u8();
    r.u8(); // etcflag
    r.u32(); // ctrlflag
    r.u8(); // 스타일 번호
    r.skip(CHAR_SHAPE_LEN); // 문단 대표 글자 모양
    if (nch === 0) return; // 목록 끝
    if (!reuseShape) r.skip(PARA_SHAPE_LEN);
    r.skip(nline * LINE_INFO_LEN);
    if (containCshape) {
      for (let i = 0; i < nch; i++) if (r.u8() === 0) r.skip(CHAR_SHAPE_LEN);
    }
    readParaChars(r, nch, out, depth);
  }
}

/** 문단 글자 읽기. 표·글상자 같은 특수 문자는 안쪽 문단을 먼저 꺼내기 전에 앞 글자를 내보낸다. */
function readParaChars(r: Reader, nch: number, out: string[], depth: number): void {
  let text = "";
  const flush = () => {
    if (text.trim()) out.push(text);
    text = "";
  };
  const tail = (hh: number) => {
    if (r.u16() !== hh) throw new HwpReadError("한글 파일 본문이 손상돼 읽을 수 없습니다. 한글에서 다시 저장해 올려 주세요.");
  };
  for (let i = 0; i < nch; ) {
    const hh = r.u16();
    if (hh === 13) break; // 문단 끝
    i += hh < 32 ? WSIZE[hh] : 1;
    if (hh >= 32) {
      text += hcharToText(hh);
      continue;
    }
    switch (hh) {
      case 0: case 1: case 2: case 3: case 4: case 12: case 27: case 29: {
        const len = r.u32(); // 건너뛸 자료
        tail(hh);
        r.skip(len);
        break;
      }
      case 5: { // 필드 코드
        r.u32();
        tail(hh);
        r.skip(2 + 4 + 2 + 22);
        const l1 = r.u32(), l2 = r.u32(), l3 = r.u32(), bin = r.u32();
        r.skip(l1 + l2 + l3 + bin);
        break;
      }
      case 6: { // 책갈피
        const len = r.u32();
        tail(hh);
        r.skip(len);
        break;
      }
      case 7: r.skip(40 * 2); tail(hh); break; // 날짜 형식
      case 8: r.skip(40 * 2 + 6 * 2); tail(hh); break; // 날짜 코드
      case 9: r.skip(4); tail(hh); text += "\t"; break; // 탭
      case 10: { // 표·글상자·수식·단추
        r.skip(4);
        tail(hh);
        r.skip(8 + 10 + 24 + 14 + 2 + 4 + 18);
        const nCell = r.u16();
        r.skip(2); // protect
        if (nCell === 0 || nCell > 4096) throw new HwpReadError("한글 파일의 표 정보가 손상돼 읽을 수 없습니다.");
        r.skip(nCell * CELL_LEN);
        flush();
        for (let c = 0; c < nCell; c++) readParaList(r, out, depth + 1);
        readParaList(r, out, depth + 1); // 캡션
        break;
      }
      case 11: { // 그림
        r.skip(4);
        tail(hh);
        const follow = r.u32();
        r.skip(4 + 10 + 24 + 14 + 2 + 4 + 12 + 1 + 8 + 256 + 9);
        r.skip(follow);
        flush();
        readParaList(r, out, depth + 1); // 캡션
        break;
      }
      case 14: r.skip(4); tail(hh); r.skip(8 + 10 + 24 + 14 + 4 + 2 + 8 + 8 + 6); break; // 선
      case 15: r.skip(4); tail(hh); r.skip(8); flush(); readParaList(r, out, depth + 1); break; // 숨은 설명
      case 16: r.skip(4); tail(hh); r.skip(8 + 2); flush(); readParaList(r, out, depth + 1); break; // 머리말·꼬리말
      case 17: r.skip(4); tail(hh); r.skip(8 + 6); flush(); readParaList(r, out, depth + 1); break; // 각주·미주
      case 18: case 19: case 20: case 21: r.skip(4); tail(hh); break; // 번호·쪽 번호
      case 22: r.skip(20); tail(hh); break; // 메일 머지
      case 23: r.skip(6); tail(hh); break; // 글자 겹침
      case 24: case 25: r.skip(2); tail(hh); break; // 하이픈·차례 표시
      case 26: r.skip(240 + 2); tail(hh); break; // 찾아보기 표시
      case 28: r.skip(2 + 2 + 14 + 14 + 28); tail(hh); break; // 개요 번호
      case 30: case 31: tail(hh); text += " "; break; // 묶음 빈칸·고정폭 빈칸
      default:
        throw new HwpReadError("한글 파일 본문이 손상돼 읽을 수 없습니다. 한글에서 다시 저장해 올려 주세요.");
    }
  }
  flush();
}

/** 구버전(HWP 3.0) 한글 파일 내용을 받아 본문 글자를 문단(표 칸 포함)마다 한 줄씩 돌려준다. */
export function readHwp3Paragraphs(file: Buffer | Uint8Array): string[] {
  const buf = Buffer.from(file);
  if (!isHwp3(buf)) throw new HwpReadError("구버전 한글(HWP 3.0) 파일 형식이 아닙니다.");
  const head = 30;
  if (buf.length < head + DOC_INFO_LEN + SUMMARY_LEN) throw new HwpReadError("한글 파일 본문이 손상돼 읽을 수 없습니다. 한글에서 다시 저장해 올려 주세요.");
  const info = buf.subarray(head, head + DOC_INFO_LEN);
  if (info.readUInt16LE(96) !== 0) throw new HwpReadError("암호가 걸린 한글 파일은 읽을 수 없습니다.");
  const compressed = info[124] !== 0;
  const infoBlockLen = info.readUInt16LE(126);
  let body: Buffer = buf.subarray(head + DOC_INFO_LEN + SUMMARY_LEN + infoBlockLen);
  if (compressed) {
    try {
      body = inflateAny(body);
    } catch {
      throw new HwpReadError("한글 파일 본문이 손상돼 읽을 수 없습니다. 한글에서 다시 저장해 올려 주세요.");
    }
  }

  const r = new Reader(body);
  for (let lang = 0; lang < LANGUAGES; lang++) r.skip(r.u16() * FONT_NAME_LEN); // 글꼴 이름
  r.skip(r.u16() * STYLE_LEN); // 스타일
  const out: string[] = [];
  readParaList(r, out, 0);
  if (out.length === 0) throw new HwpReadError("한글 파일에서 본문을 찾지 못했습니다.");
  return out.map((p) => p.replace(/\s+$/u, ""));
}
