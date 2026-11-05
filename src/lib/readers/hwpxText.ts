// Design Ref: DESIGN.md §4 단계 2 — 신버전 한글 파일(.hwpx)과 한글 XML 문서(.hml)에서 본문 글자를 꺼낸다.
// (2026-11-05 사용자 결정: 구버전·신버전 한글 파일 모두 받음)
// .hwpx 구조: ZIP 묶음 안에 mimetype("application/hwp+zip"), Contents/section0.xml … 이 있고,
// 문단은 <hp:p>, 글자는 그 안의 <hp:t>에 들어 있다. 표 칸 문단은 <hp:tbl>…<hp:tc>…<hp:p>로 겹쳐 들어간다.
// 서버 안에서만 읽고, 서류는 외부로 보내지 않는다. 결과 모양은 HWP 5.x 읽기(hwpText.ts)와 같다.

import { inflateRawSync } from "node:zlib";
import { HwpReadError } from "./hwpText";

const ZIP_LOCAL = 0x04034b50;
const ZIP_CENTRAL = 0x02014b50;
const ZIP_END = 0x06054b50;

/** ZIP 파일인지 (앞 4바이트 "PK\x03\x04") */
export const isZip = (b: Buffer) => b.length >= 4 && b.readUInt32LE(0) === ZIP_LOCAL;

/** ZIP 묶음 안 파일 이름 → 내용. 압축 안 함(0)·deflate(8)만 읽는다. */
function readZip(buf: Buffer): Map<string, Buffer> {
  const bad = () => new HwpReadError("한글(.hwpx) 파일이 손상돼 읽을 수 없습니다.");
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === ZIP_END) {
      end = i;
      break;
    }
  }
  if (end < 0) throw bad();
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== ZIP_CENTRAL) throw bad();
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    p += 46 + nameLen + extraLen + commentLen;

    if (flags & 0x1) throw new HwpReadError("암호가 걸린 한글 파일은 읽을 수 없습니다.");
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== ZIP_LOCAL) throw bad();
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + compSize);
    if (data.length !== compSize) throw bad();
    if (method === 0) out.set(name, data);
    else if (method === 8) {
      try {
        out.set(name, inflateRawSync(data));
      } catch {
        throw bad();
      }
    } // 그 밖의 압축 방식은 본문이 아닌 파일에서만 나오므로 건너뛴다
  }
  return out;
}

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (m, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e] ?? m),
  );

/**
 * section XML 하나에서 문단 글자들을 순서대로 꺼낸다.
 * 표가 든 문단은 표 앞 글자 → 표 칸 문단들 → 표 뒤 글자 순서가 되도록, 안쪽 문단이 시작될 때 바깥 문단 글자를 먼저 내보낸다.
 */
export function readXmlParagraphs(xml: string, tags: XmlTags): string[] {
  const out: string[] = [];
  const stack: string[] = []; // 열린 문단마다 모은 글자
  let inText = 0; // 글자 태그(<hp:t>, <CHAR>) 안인지
  const flush = (i: number) => {
    if (stack[i].trim()) out.push(stack[i]);
    stack[i] = "";
  };
  const re = /<(\/?)([A-Za-z][\w.-]*:)?([A-Za-z][\w.-]*)\b[^>]*?(\/?)>|([^<]+)/g;
  for (let m; (m = re.exec(xml)); ) {
    const [, close, , tag, selfClose, text] = m;
    if (text !== undefined) {
      if (inText && stack.length) stack[stack.length - 1] += decodeEntities(text);
      continue;
    }
    if (tag === tags.para) {
      if (close) {
        if (stack.length) {
          flush(stack.length - 1);
          stack.pop();
        }
      } else if (!selfClose) {
        if (stack.length) flush(stack.length - 1);
        stack.push("");
      }
    } else if (tag === tags.text) {
      if (close) inText = Math.max(0, inText - 1);
      else if (!selfClose) inText++;
    } else if (inText && stack.length && !close) {
      if (tag === tags.tab) stack[stack.length - 1] += "\t";
      else if (tag === tags.lineBreak) stack[stack.length - 1] += "\n";
    }
  }
  return out;
}

interface XmlTags {
  para: string;
  text: string;
  tab: string;
  lineBreak: string;
}
/** .hwpx(OWPML)의 문단·글자 태그 */
const HWPX_TAGS: XmlTags = { para: "p", text: "t", tab: "tab", lineBreak: "lineBreak" };
/** 한글 XML 문서(.hml, HWPML 2.x)의 문단·글자 태그 */
const HML_TAGS: XmlTags = { para: "P", text: "CHAR", tab: "TAB", lineBreak: "LINEBREAK" };

/** 한글 XML 문서(.hml)인지: 맨 앞 <?xml …?> 다음에 <HWPML 태그 */
export const isHml = (b: Buffer) => /^﻿?\s*<\?xml[^>]*\?>\s*<HWPML\b/.test(b.subarray(0, 512).toString("utf8"));

/** 한글 XML 문서(.hml) 내용을 받아 본문(<BODY>) 글자를 문단(표 칸 포함)마다 한 줄씩 돌려준다. */
export function readHmlParagraphs(file: Buffer | Uint8Array): string[] {
  const buf = Buffer.from(file);
  if (!isHml(buf)) throw new HwpReadError("한글 XML 문서(.hml) 형식이 아닙니다.");
  const xml = buf.toString("utf8");
  const start = xml.indexOf("<BODY");
  const end = xml.lastIndexOf("</BODY>");
  if (start < 0 || end < start) throw new HwpReadError("한글 파일에서 본문을 찾지 못했습니다.");
  const paras = readXmlParagraphs(xml.slice(start, end), HML_TAGS);
  if (paras.length === 0) throw new HwpReadError("한글 파일에서 본문을 찾지 못했습니다.");
  return paras.map((p) => p.replace(/\s+$/u, ""));
}

/** .hwpx 파일 내용을 받아 본문 글자를 문단(표 칸 포함)마다 한 줄씩 돌려준다. */
export function readHwpxParagraphs(file: Buffer | Uint8Array): string[] {
  const buf = Buffer.from(file);
  if (!isZip(buf)) throw new HwpReadError("한글(.hwpx) 파일 형식이 아닙니다.");
  const entries = readZip(buf);
  const mime = entries.get("mimetype")?.toString("utf8").trim();
  if (mime !== "application/hwp+zip") throw new HwpReadError("한글(.hwpx) 파일 형식이 아닙니다.");

  const sections = [...entries.keys()]
    .map((name) => ({ name, n: /^Contents\/section(\d+)\.xml$/.exec(name)?.[1] }))
    .filter((s): s is { name: string; n: string } => s.n !== undefined)
    .sort((a, b) => Number(a.n) - Number(b.n));
  const paras = sections.flatMap((s) => readXmlParagraphs(entries.get(s.name)!.toString("utf8"), HWPX_TAGS));
  if (paras.length === 0) throw new HwpReadError("한글 파일에서 본문을 찾지 못했습니다.");
  return paras.map((p) => p.replace(/\s+$/u, ""));
}
