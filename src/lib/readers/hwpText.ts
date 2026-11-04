// Design Ref: DESIGN.md §4 단계 2 — 한글(HWP 5.x) 파일에서 본문 글자를 꺼낸다. (PLAN 7번)
// 서버 안에서만 읽고, 서류는 외부로 보내지 않는다.
// HWP 5.x 구조: 묶음 파일(CFB) 안에 FileHeader, BodyText/Section0..N 이 있고,
// 각 Section은 (대개 압축된) 레코드 목록이다. 문단 글자는 PARA_TEXT 레코드(태그 67)에 UTF-16으로 들어 있다.

import CFB from "cfb";
import { inflateRawSync } from "node:zlib";

const HWPTAG_PARA_TEXT = 67; // HWPTAG_BEGIN(16) + 51

export class HwpReadError extends Error {}

function entryBytes(container: CFB.CFB$Container, path: string): Buffer | null {
  const entry = CFB.find(container, path);
  if (!entry || !entry.content) return null;
  return Buffer.from(entry.content as Uint8Array);
}

/** PARA_TEXT 레코드 한 개를 글자로 바꾼다. 표·그림 같은 조절 문자는 건너뛴다. */
function decodeParaText(buf: Buffer): string {
  let out = "";
  for (let i = 0; i + 1 < buf.length; ) {
    const code = buf.readUInt16LE(i);
    if (code >= 32) {
      out += String.fromCharCode(code);
      i += 2;
      continue;
    }
    // 1글자짜리 조절 문자
    if (code === 0 || code === 10 || code === 13 || (code >= 24 && code <= 31)) {
      if (code === 10) out += "\n";
      else if (code === 30 || code === 31) out += " "; // 묶음 빈칸, 고정폭 빈칸
      i += 2;
      continue;
    }
    // 그 밖의 조절 문자는 8글자(16바이트) 크기다. 9는 탭.
    if (code === 9) out += "\t";
    i += 16;
  }
  return out;
}

/** Section 스트림 하나에서 문단 글자들을 순서대로 꺼낸다. */
function readSection(data: Buffer): string[] {
  const paras: string[] = [];
  let i = 0;
  while (i + 4 <= data.length) {
    const header = data.readUInt32LE(i);
    i += 4;
    const tag = header & 0x3ff;
    let size = (header >>> 20) & 0xfff;
    if (size === 0xfff) {
      size = data.readUInt32LE(i);
      i += 4;
    }
    if (i + size > data.length) break;
    if (tag === HWPTAG_PARA_TEXT) paras.push(decodeParaText(data.subarray(i, i + size)));
    i += size;
  }
  return paras;
}

/**
 * HWP 파일 내용을 받아 본문 글자를 문단(표 칸 포함)마다 한 줄씩 돌려준다.
 * 암호가 걸렸거나 형식이 다르면 HwpReadError를 던진다.
 */
export function readHwpParagraphs(file: Buffer | Uint8Array): string[] {
  let container: CFB.CFB$Container;
  try {
    container = CFB.read(Buffer.from(file), { type: "buffer" });
  } catch {
    throw new HwpReadError("한글(HWP 5.x) 파일 형식이 아닙니다.");
  }

  const header = entryBytes(container, "/FileHeader");
  if (!header || !header.subarray(0, 17).toString("latin1").startsWith("HWP Document File")) {
    throw new HwpReadError("한글(HWP 5.x) 파일 형식이 아닙니다.");
  }
  const flags = header.readUInt32LE(36);
  const compressed = (flags & 0x1) !== 0;
  if ((flags & 0x2) !== 0) throw new HwpReadError("암호가 걸린 한글 파일은 읽을 수 없습니다.");
  if ((flags & 0x4) !== 0) throw new HwpReadError("배포용 한글 파일은 읽을 수 없습니다.");

  const paras: string[] = [];
  for (let n = 0; ; n++) {
    const raw = entryBytes(container, `/BodyText/Section${n}`);
    if (!raw) break;
    const data = compressed ? inflateRawSync(raw) : raw;
    paras.push(...readSection(data));
  }
  if (n0(paras)) throw new HwpReadError("한글 파일에서 본문을 찾지 못했습니다.");
  return paras.map((p) => p.replace(/\s+$/u, ""));
}

const n0 = (a: unknown[]) => a.length === 0;
