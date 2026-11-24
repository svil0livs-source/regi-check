// 비용 청구서 엑셀 파일(.xlsx, .xls) 읽기 (2026-11-20 사용자 지시: 청구서는 엑셀, 영수증은 PDF).
// 브라우저에서 바로 읽고 서버로 보내지 않는다. 칸 값(글자·숫자·날짜)만 꺼내고, 수식은 저장된 계산 결과를 쓴다.
// - .xlsx: 압축 묶음 안 XML (fflate로 풀기)
// - .xls: 엑셀 97~2003 형식 (CFB 묶음 안 BIFF8 레코드). 엑셀 95 이전 형식은 받지 않는다.
import CFB from "cfb";
import { unzipSync, strFromU8 } from "fflate";
import { categoryOf, mergeClaimPages, parseClaimLines } from "./parse";
import type { CaseColumn, ClaimCase, ClaimItem, ClaimRead, ClaimTable, PageRead } from "./types";

export type Cell = string | number | null;
export interface Sheet {
  name: string;
  /** rows[행][열] (0부터). 빈 칸은 null. 날짜 칸은 "YYYY-MM-DD" 글자 */
  rows: Cell[][];
}

export class ExcelReadError extends Error {}

// ── 공통: 날짜 서식 판별 ──────────────────────────────────────────
/** 엑셀 기본 서식 번호 중 날짜·시각 (한국어판 27~36, 50~58 포함) */
const DATE_FMT_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

export function isDateFormat(id: number, code: string | undefined): boolean {
  if (code === undefined) return DATE_FMT_IDS.has(id);
  const bare = code
    .replace(/"[^"]*"/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\\./g, "")
    .replace(/General/gi, "");
  return /[ymdhse]/i.test(bare) && !/^[#0,.\s%-]*$/.test(bare);
}

function serialToDate(serial: number, date1904: boolean): string {
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const d = new Date(base + Math.floor(serial) * 86_400_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

function setCell(rows: Cell[][], r: number, c: number, v: Cell) {
  while (rows.length <= r) rows.push([]);
  const row = rows[r];
  while (row.length <= c) row.push(null);
  row[c] = v;
}

// ── .xlsx ─────────────────────────────────────────────────────
const decodeXml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[e.toLowerCase()] ?? "";
  });

const attr = (tag: string, name: string) => {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag);
  return m ? decodeXml(m[1]) : undefined;
};

/** <si>·<is> 안의 글자 (읽는 법 표시 rPh는 뺀다) */
const richText = (xml: string) =>
  [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g)].map((m) => decodeXml(m[1] ?? "")).join("");

function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.toUpperCase()) {
    if (ch < "A" || ch > "Z") break;
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}

function readXlsx(bytes: Uint8Array): Sheet[] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => f.name.startsWith("xl/") && f.name.endsWith(".xml") || f.name.endsWith(".rels") });
  } catch {
    throw new ExcelReadError("엑셀 파일을 풀지 못했습니다.");
  }
  const text = (p: string) => (files[p] ? strFromU8(files[p]) : "");
  const workbook = text("xl/workbook.xml");
  if (!workbook) throw new ExcelReadError("엑셀 통합 문서를 찾지 못했습니다.");
  const date1904 = /<workbookPr\b[^>]*date1904="(1|true)"/.test(workbook);

  const rels = new Map<string, string>();
  for (const m of text("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], "Id");
    const target = attr(m[0], "Target");
    if (id && target) rels.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`);
  }

  const shared = [...text("xl/sharedStrings.xml").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)].map((m) => richText(m[1] ?? ""));

  const styles = text("xl/styles.xml");
  const fmtCodes = new Map<number, string>();
  for (const m of styles.matchAll(/<numFmt\b[^>]*>/g)) {
    const id = Number(attr(m[0], "numFmtId"));
    const code = attr(m[0], "formatCode");
    if (code !== undefined) fmtCodes.set(id, code);
  }
  const xfBlock = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? "";
  const dateStyle = [...xfBlock.matchAll(/<xf\b[^>]*>/g)].map((m) => {
    const id = Number(attr(m[0], "numFmtId") ?? 0);
    return isDateFormat(id, fmtCodes.get(id));
  });

  const sheets: Sheet[] = [];
  for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    if (attr(m[0], "state") === "hidden" || attr(m[0], "state") === "veryHidden") continue;
    const rid = attr(m[0], "r:id");
    const path = rid ? rels.get(rid) : undefined;
    const xml = path ? text(path) : "";
    if (!xml) continue;
    const rows: Cell[][] = [];
    let autoRow = -1;
    for (const rowM of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      const rAttr = attr(rowM[1], "r");
      const r = rAttr ? Number(rAttr) - 1 : autoRow + 1;
      autoRow = r;
      let autoCol = -1;
      for (const c of rowM[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = attr(c[1], "r");
        const col = ref ? colIndex(ref) : autoCol + 1;
        autoCol = col;
        const body = c[2] ?? "";
        const t = attr(c[1], "t") ?? "n";
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let value: Cell = null;
        if (t === "s") value = v !== undefined ? (shared[Number(v)] ?? null) : null;
        else if (t === "inlineStr") value = richText(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? "");
        else if (t === "str") value = v !== undefined ? decodeXml(v) : null;
        else if (t === "b") value = v === "1" ? "TRUE" : "FALSE";
        else if (t === "e") value = null;
        else if (v !== undefined && v !== "") {
          const num = Number(v);
          if (Number.isFinite(num)) value = dateStyle[Number(attr(c[1], "s") ?? 0)] ? serialToDate(num, date1904) : num;
        }
        if (value !== null && value !== "") setCell(rows, r, col, value);
      }
    }
    sheets.push({ name: attr(m[0], "name") ?? `시트${sheets.length + 1}`, rows });
  }
  return sheets;
}

// ── .xls (BIFF8) ─────────────────────────────────────────────
interface Rec {
  type: number;
  data: Uint8Array;
  /** 스트림 안 위치 (시트 시작 위치 찾기용) */
  pos: number;
}

function records(buf: Uint8Array): Rec[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out: Rec[] = [];
  for (let p = 0; p + 4 <= buf.length; ) {
    const type = dv.getUint16(p, true);
    const len = dv.getUint16(p + 2, true);
    out.push({ type, data: buf.subarray(p + 4, p + 4 + len), pos: p });
    p += 4 + len;
  }
  return out;
}

const u16 = (d: Uint8Array, o: number) => d[o] | (d[o + 1] << 8);
const u32 = (d: Uint8Array, o: number) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16)) + d[o + 3] * 0x1000000;
const f64 = (d: Uint8Array, o: number) => new DataView(d.buffer, d.byteOffset + o, 8).getFloat64(0, true);

function rkValue(rk: number): number {
  let v: number;
  if (rk & 2) v = (rk >> 2) | 0;
  else {
    const b = new DataView(new ArrayBuffer(8));
    b.setUint32(4, rk & 0xfffffffc, true);
    v = b.getFloat64(0, true);
  }
  return rk & 1 ? v / 100 : v;
}

function chars(d: Uint8Array, o: number, n: number, wide: boolean): string {
  let s = "";
  for (let i = 0; i < n; i++) s += String.fromCharCode(wide ? u16(d, o + i * 2) : d[o + i]);
  return s;
}

/** XLUnicodeString (글자 수 2바이트) / ShortXLUnicodeString (1바이트) */
function xlString(d: Uint8Array, o: number, short = false): string {
  const n = short ? d[o] : u16(d, o);
  const flags = d[o + (short ? 1 : 2)];
  return chars(d, o + (short ? 2 : 3), n, (flags & 1) === 1);
}

/** SST(공유 글자표): 글자가 CONTINUE 레코드에 걸쳐 나뉠 수 있다 */
function readSst(parts: Uint8Array[]): string[] {
  const out: string[] = [];
  let part = 0;
  let o = 8; // 첫 레코드: cstTotal, cstUnique
  const total = parts[0] ? u32(parts[0], 4) : 0;
  const ensure = () => {
    while (part < parts.length && o >= parts[part].length) {
      part++;
      o = 0;
    }
    return part < parts.length;
  };
  const skip = (n: number) => {
    while (n > 0 && ensure()) {
      const take = Math.min(n, parts[part].length - o);
      o += take;
      n -= take;
    }
  };
  for (let i = 0; i < total && ensure(); i++) {
    let d = parts[part];
    const cch = u16(d, o);
    const flags = d[o + 2];
    o += 3;
    let wide = (flags & 1) === 1;
    let runs = 0;
    let ext = 0;
    if (flags & 8) {
      runs = u16(d, o);
      o += 2;
    }
    if (flags & 4) {
      ext = u32(d, o);
      o += 4;
    }
    let s = "";
    let left = cch;
    while (left > 0) {
      if (o >= d.length) {
        // 다음 CONTINUE 레코드: 첫 바이트가 이어지는 글자의 폭
        part++;
        if (part >= parts.length) break;
        d = parts[part];
        wide = (d[0] & 1) === 1;
        o = 1;
      }
      const room = Math.floor((d.length - o) / (wide ? 2 : 1));
      const n = Math.min(left, room);
      s += chars(d, o, n, wide);
      o += n * (wide ? 2 : 1);
      left -= n;
      if (n === 0) o = d.length;
    }
    out.push(s);
    skip(runs * 4 + ext);
  }
  return out;
}

function readXls(bytes: Uint8Array): Sheet[] {
  let stream: Uint8Array | null = null;
  try {
    const cfb = CFB.read(bytes, { type: "array" });
    const entry = CFB.find(cfb, "Workbook") ?? CFB.find(cfb, "Book");
    if (entry?.content) stream = Uint8Array.from(entry.content as ArrayLike<number>);
    if (entry && entry.name === "Book") throw new ExcelReadError("엑셀 95 이전 형식은 읽지 못합니다. 엑셀에서 「다른 이름으로 저장」으로 .xlsx 형식으로 저장해 주세요.");
  } catch (e) {
    if (e instanceof ExcelReadError) throw e;
    throw new ExcelReadError("엑셀 파일을 열지 못했습니다.");
  }
  if (!stream) throw new ExcelReadError("엑셀 통합 문서를 찾지 못했습니다.");
  const recs = records(stream);

  // 통합 문서 영역: 시트 목록, 공유 글자표, 서식
  const bounds: { name: string; pos: number; hidden: boolean; type: number }[] = [];
  const formats = new Map<number, string>();
  const xfFmt: number[] = [];
  let date1904 = false;
  let sst: string[] = [];
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    if (r.type === 0x000a) break; // EOF
    if (r.type === 0x0085) bounds.push({ pos: u32(r.data, 0), hidden: r.data[4] !== 0, type: r.data[5], name: xlString(r.data, 6, true) });
    else if (r.type === 0x041e) formats.set(u16(r.data, 0), xlString(r.data, 2));
    else if (r.type === 0x00e0) xfFmt.push(u16(r.data, 2));
    else if (r.type === 0x0022) date1904 = u16(r.data, 0) === 1;
    else if (r.type === 0x00fc) {
      const parts = [r.data];
      while (recs[i + 1]?.type === 0x003c) parts.push(recs[++i].data);
      sst = readSst(parts);
    }
  }
  const isDate = (ixfe: number) => {
    const id = xfFmt[ixfe];
    return id !== undefined && isDateFormat(id, formats.get(id));
  };
  const num = (ixfe: number, v: number): Cell => (isDate(ixfe) ? serialToDate(v, date1904) : v);

  const sheets: Sheet[] = [];
  for (const b of bounds) {
    if (b.hidden || b.type !== 0) continue; // 숨긴 시트, 차트·매크로 시트는 뺀다
    const start = recs.findIndex((r) => r.pos === b.pos);
    if (start < 0) continue;
    const rows: Cell[][] = [];
    let pendingFormula: { r: number; c: number } | null = null;
    for (let i = start + 1; i < recs.length; i++) {
      const { type, data: d } = recs[i];
      if (type === 0x000a) break;
      if (type === 0x00fd) setCell(rows, u16(d, 0), u16(d, 2), sst[u32(d, 6)] ?? null);
      else if (type === 0x0204) setCell(rows, u16(d, 0), u16(d, 2), xlString(d, 6));
      else if (type === 0x0203) setCell(rows, u16(d, 0), u16(d, 2), num(u16(d, 4), f64(d, 6)));
      else if (type === 0x027e) setCell(rows, u16(d, 0), u16(d, 2), num(u16(d, 4), rkValue(u32(d, 6))));
      else if (type === 0x00bd) {
        const row = u16(d, 0);
        const first = u16(d, 2);
        const count = (d.length - 6) / 6;
        for (let k = 0; k < count; k++) setCell(rows, row, first + k, num(u16(d, 4 + k * 6), rkValue(u32(d, 6 + k * 6))));
      } else if (type === 0x0006) {
        const r = u16(d, 0);
        const c = u16(d, 2);
        if (u16(d, 12) === 0xffff) {
          // 계산 결과가 숫자가 아님: 0 글자(다음 STRING 레코드), 1 참·거짓, 2 오류, 3 빈 글자
          if (d[6] === 0) pendingFormula = { r, c };
          else if (d[6] === 1) setCell(rows, r, c, d[8] ? "TRUE" : "FALSE");
        } else setCell(rows, r, c, num(u16(d, 4), f64(d, 6)));
      } else if (type === 0x0207 && pendingFormula) {
        setCell(rows, pendingFormula.r, pendingFormula.c, xlString(d, 0));
        pendingFormula = null;
      }
    }
    for (const row of rows) for (let c = 0; c < row.length; c++) if (row[c] === "") row[c] = null;
    sheets.push({ name: b.name, rows });
  }
  return sheets;
}

/** 엑셀 파일 → 보이는 시트들. 형식은 파일 앞부분으로 판단한다 */
export function readWorkbook(bytes: Uint8Array): Sheet[] {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return readXlsx(bytes);
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) return readXls(bytes);
  throw new ExcelReadError("엑셀 파일(.xlsx, .xls)이 아닙니다.");
}

export const isExcelName = (name: string) => /\.(xlsx|xlsm|xls)$/i.test(name);

/** 칸 값을 청구서 줄 글자로: 정수는 쉼표를 넣어 금액처럼, 날짜는 그대로 */
export function cellText(v: Cell): string {
  if (v === null) return "";
  if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString("en-US") : String(Math.round(v * 100) / 100);
  return v.replace(/\s+/g, " ").trim();
}

/**
 * 엑셀 청구서 → 청구 항목. 행 하나를 청구서 한 줄로 보고 PDF 청구서와 같은 규칙(parseClaimLines)으로 읽는다.
 * 엑셀 칸 숫자는 글자 읽기가 아니라 정확한 값이라 「확인 필요」로 두지 않는다. 100 미만 정수(수량·번호)는 금액으로 보지 않는다.
 */
export function parseClaimSheets(sheets: Sheet[]): { claim: ClaimRead; pages: PageRead[] } {
  const table = readClaimTable(sheets);
  if (table) return table;
  const reads: ClaimRead[] = [];
  const pages: PageRead[] = [];
  sheets.forEach((sheet, si) => {
    const page = si + 1;
    let found = 0;
    sheet.rows.forEach((row, ri) => {
      const cells = row.map((v) => (typeof v === "number" && Number.isInteger(v) && Math.abs(v) >= 100 ? `${cellText(v)}원` : cellText(v))).filter(Boolean);
      if (!cells.length) return;
      const text = cells.join("   ");
      const read = parseClaimLines([{ text, words: text.split(/\s+/).map((w) => ({ text: w, confidence: 100 })) }], page);
      const compact = (t: string) => t.replace(/[^가-힣A-Za-z()]/g, "");
      const texts = row.filter((v): v is string => typeof v === "string" && /[가-힣]{2,}/.test(v)).map((v) => cellText(v));
      for (const it of read.items) {
        // 앞 칸 분류(예: 「공과금」)가 이름에 붙었으면 항목 이름 칸만 남긴다 (종류는 붙은 이름으로 이미 정했다)
        const own = [...texts].reverse().find((t) => compact(t) && compact(it.label).endsWith(compact(t)));
        Object.assign(it, { sheet: sheet.name, row: ri + 1 }, own ? { label: own } : {});
      }
      found += read.items.length;
      reads.push(read);
    });
    pages.push({ page, source: "text", found });
  });
  return { claim: mergeClaimPages(reads), pages };
}

// ── 사건별 비용표 (2026-11-23 실제 엑셀: 한 줄 = 경매 사건 한 건, 칸마다 비용 종류) ──────────────
const squash = (t: string) => t.replace(/[^가-힣A-Za-z0-9]/g, "");
const TOTAL_CELL_RE = /^(합계|총계|계|소계\d*|합|총합계|금액합계)$/;
type IdKey = "no" | "caseNo" | "court" | "debtor" | "date";
const ID_RULES: [IdKey, RegExp][] = [
  ["caseNo", /^사건번호$|^사건$/],
  ["debtor", /^채무자(명)?$|^소유자(명)?$/],
  ["court", /^법원(명)?$|^관할법원$/],
  ["date", /^접수일(자)?$|^신청일(자)?$|^일자$/],
  ["no", /^번호$|^순번$|^no$/i],
];

function dateText(v: Cell): string | null {
  if (v === null) return null;
  const m = /((?:19|20)\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/.exec(String(v));
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : null;
}

function caseNoText(v: Cell): string | null {
  if (v === null) return null;
  if (typeof v === "number") return Number.isInteger(v) && v > 0 ? String(v) : null;
  const m = /타\s*경\s*(\d{1,7})/.exec(v) ?? /(\d{1,7})\s*$/.exec(v.replace(/,/g, ""));
  return m ? String(Number(m[1])) : null;
}

/**
 * 머리줄에 비용 종류 칸(인지대·등록세·송달료·보관금·보수 …)이 셋 이상 있는 시트를 사건별 비용표로 읽는다.
 * 머리줄 아래 줄마다 사건 한 건, 「합계」로 시작하는 줄은 합계 줄. 소계·합계 칸은 대조하지 않는다.
 * 사건별 비용표가 아니면 null (기존처럼 「항목 | 금액」 청구서로 읽는다).
 */
function readClaimTable(sheets: Sheet[]): { claim: ClaimRead; pages: PageRead[] } | null {
  for (const [si, sheet] of sheets.entries()) {
    for (const [hi, header] of sheet.rows.entries()) {
      const columns: CaseColumn[] = [];
      const ids: Partial<Record<IdKey, number>> = {};
      header.forEach((v, col) => {
        if (typeof v !== "string") return;
        const key = squash(v);
        if (!key) return;
        const id = ID_RULES.find(([, re]) => re.test(key));
        if (id) {
          if (ids[id[0]] === undefined) ids[id[0]] = col;
          return;
        }
        if (TOTAL_CELL_RE.test(key) || /소계|합계/.test(key)) return;
        const category = categoryOf(v);
        if (category !== "other") columns.push({ header: cellText(v), category, col });
      });
      if (columns.filter((c) => c.category !== "fee").length < 3) continue;

      const cases: ClaimCase[] = [];
      let totalRow: ClaimTable["totalRow"] = null;
      for (let ri = hi + 1; ri < sheet.rows.length; ri++) {
        const row = sheet.rows[ri];
        const lead = row.find((v) => v !== null && cellText(v) !== "");
        if (typeof lead === "string" && TOTAL_CELL_RE.test(squash(lead))) {
          const values: Record<number, number> = {};
          for (const c of columns) if (typeof row[c.col] === "number") values[c.col] = Math.round(row[c.col] as number);
          totalRow = { row: ri + 1, values };
          break;
        }
        const items: ClaimItem[] = [];
        for (const c of columns) {
          const v = row[c.col];
          const n = typeof v === "number" ? v : typeof v === "string" && /^[\d,\s]+원?$/.test(v.trim()) ? Number(v.replace(/[^\d]/g, "")) : null;
          if (n === null || n === 0) continue;
          const exact = Number.isInteger(n) && n > 0;
          items.push({ label: c.header, category: c.category, amount: { value: exact ? n : Math.round(n), uncertain: !exact }, page: si + 1, sheet: sheet.name, row: ri + 1 });
        }
        // 비용이 하나도 없는 줄(빈 줄·설명 줄)은 사건이 아니다
        if (!items.length) continue;
        const at = (k: IdKey) => (ids[k] === undefined ? null : row[ids[k]!]);
        const text = (v: Cell) => (v === null || cellText(v) === "" ? null : cellText(v));
        cases.push({
          sheet: sheet.name,
          page: si + 1,
          row: ri + 1,
          no: text(at("no")) ?? String(cases.length + 1),
          caseNo: caseNoText(at("caseNo")),
          court: text(at("court")),
          debtor: text(at("debtor")),
          date: dateText(at("date")),
          items,
        });
      }
      if (!cases.length) continue;
      const items = cases.flatMap((c) => c.items);
      const sum = items.reduce((s, i) => s + (i.amount.value ?? 0), 0);
      const pages: PageRead[] = sheets.map((_, i) => ({ page: i + 1, source: "text" as const, found: i === si ? items.length : 0 }));
      return { claim: { items, total: { value: sum, uncertain: false, page: si + 1 }, table: { columns, cases, totalRow } }, pages: pages.filter((p) => p.page === si + 1) };
    }
  }
  return null;
}
