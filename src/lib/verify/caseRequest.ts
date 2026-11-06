// Design Ref: DESIGN.md §4.1 — 건 하나의 요청 모양 (브라우저 ↔ 서버, 2026-11-06).
// 파일당 6000KB까지 받으려고 원본 파일을 통째로 보내지 않는다(배포본 요청 한도 약 4.5MB).
//   - 한글 파일: 브라우저가 읽어 대조 항목 값만 보낸다 (fields, JSON)
//   - 등기부 PDF: 브라우저가 페이지 사진 후보만 꺼내 보낸다 (images, 각 사진의 사전 + 자료)
// 서버는 받은 값을 그대로 믿지 않고 모양을 엄격히 검사한다. 검사에 실패하면 null.
import type { PageImageObject } from "@/lib/readers/pdfPages";
import { PARTY_ROLES, PROPERTY_FIELD_KEYS, type DocumentFields, type ExtractedValue, type PropertyEntry } from "@/types/verification";

/** 요청 하나의 최대 크기: 배포본(Vercel) 요청 한도 약 4.5MB에서 머리말 몫을 뺀 값 */
export const MAX_REQUEST_BYTES = Math.floor(4.3 * 1024 * 1024);
/** 페이지 사진 후보 최대 개수 */
export const MAX_IMAGES = 200;
/** 값 하나의 최대 길이 (주소도 이보다 길지 않다) */
const MAX_VALUE_CHARS = 500;
/** 여러 명·여러 개의 최대 개수 */
const MAX_LIST = 100;
/** 사진 사전의 최대 길이 */
export const MAX_DICT_CHARS = 4000;

/** 요청 안 사진 하나의 정보 (자료는 따로 img0, img1… 파일로 보낸다) */
export interface ImageMeta {
  page: number;
  dict: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function value(v: unknown): ExtractedValue | null {
  if (!isObj(v)) return null;
  const { value: text, lowConfidence } = v;
  if (text !== null && (typeof text !== "string" || text.length > MAX_VALUE_CHARS)) return null;
  if (lowConfidence !== undefined && typeof lowConfidence !== "boolean") return null;
  return lowConfidence === undefined ? { value: text } : { value: text, lowConfidence };
}

function list<T>(v: unknown, item: (x: unknown) => T | null): T[] | null {
  if (!Array.isArray(v) || v.length > MAX_LIST) return null;
  const out: T[] = [];
  for (const x of v) {
    const r = item(x);
    if (r === null) return null;
    out.push(r);
  }
  return out;
}

function property(v: unknown): PropertyEntry | null {
  if (!isObj(v)) return null;
  const out = {} as PropertyEntry;
  for (const k of PROPERTY_FIELD_KEYS) {
    const r = value(v[k]);
    if (!r) return null;
    out[k] = r;
  }
  return out;
}

const SINGLE_KEYS = [
  "maxClaimAmount",
  "receiptNumber",
  "transferReceiptNumber",
  "registrationDate",
  "transferRegistrationDate",
  "mortgageeIdFront",
  "assigneeIdFront",
] as const;

/** 브라우저가 보낸 한글 서류 값(JSON 글자)을 검사해 돌려준다. 모양이 틀리면 null */
export function parseDocumentFields(json: string): DocumentFields | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isObj(raw) || !isObj(raw.parties)) return null;
  const parties = {} as DocumentFields["parties"];
  for (const role of PARTY_ROLES) {
    const people = list(raw.parties[role], value);
    if (!people) return null;
    parties[role] = people;
  }
  const properties = list(raw.properties, property);
  if (!properties) return null;
  const out = { parties, properties } as DocumentFields;
  for (const k of SINGLE_KEYS) {
    const r = value(raw[k]);
    if (!r) return null;
    out[k] = r;
  }
  // 등록번호는 앞 6자리만 받는다 (뒷자리가 섞여 오면 받지 않음)
  for (const k of ["mortgageeIdFront", "assigneeIdFront"] as const) {
    const v = out[k].value;
    if (v !== null && v.replace(/\D/g, "").length > 6) return null;
  }
  return out;
}

/** 사진 정보 목록(JSON 글자)을 검사해 돌려준다. 모양이 틀리면 null */
export function parseImageMeta(json: string): ImageMeta[] | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(raw) || raw.length > MAX_IMAGES) return null;
  const out: ImageMeta[] = [];
  for (const m of raw) {
    if (!isObj(m) || !Number.isInteger(m.page) || (m.page as number) < 0 || (m.page as number) >= MAX_IMAGES) return null;
    if (typeof m.dict !== "string" || m.dict.length > MAX_DICT_CHARS || !/\/Subtype\s*\/Image/.test(m.dict)) return null;
    out.push({ page: m.page as number, dict: m.dict });
  }
  return out;
}

/** 사진 정보와 자료를 합친다 */
export const toPageObjects = (meta: ImageMeta[], data: Uint8Array[]): PageImageObject[] =>
  meta.map((m, i) => ({ page: m.page, dict: m.dict, data: data[i] }));
