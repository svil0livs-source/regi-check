// Design Ref: DESIGN.md §4 단계 2 — 한글 신청서 파일을 형식에 맞는 읽기 도구로 읽는다.
// 2026-11-05 사용자 결정: 구버전·신버전 한글 파일 모두 받는다. 확장자가 아니라 파일 내용(앞부분 서명)으로 구분한다.
//   .hwp  — 한글 2002 이후(HWP 5.x 묶음 파일) 또는 한글 97 이하(HWP 3.0)
//   .hwpx — 한글 2010 이후 신버전(ZIP 묶음)
//   .hml  — 한글 XML 문서(HWPML 2.x)
import { readHwp3Paragraphs, isHwp3 } from "./hwp3Text";
import { HwpReadError, readHwpParagraphs } from "./hwpText";
import { isHml, isZip, readHmlParagraphs, readHwpxParagraphs } from "./hwpxText";


const CFB_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const isHwp5 = (b: Buffer) => b.subarray(0, 8).equals(CFB_SIGNATURE);

/** 한글 파일인지 (어떤 형식이든) */
export const isHangulFile = (b: Buffer) => isHwp5(b) || isHwp3(b) || isZip(b) || isHml(b);

/** 한글 파일(구버전·신버전 모두)을 받아 본문 글자를 문단마다 한 줄씩 돌려준다 */
export function readHangulParagraphs(file: Buffer | Uint8Array): string[] {
  const buf = Buffer.from(file);
  if (isHwp5(buf)) return readHwpParagraphs(buf);
  if (isHwp3(buf)) return readHwp3Paragraphs(buf);
  if (isZip(buf)) return readHwpxParagraphs(buf);
  if (isHml(buf)) return readHmlParagraphs(buf);
  throw new HwpReadError("한글 파일 형식이 아닙니다. (.hwp·.hwpx·.hml을 받습니다)");
}
