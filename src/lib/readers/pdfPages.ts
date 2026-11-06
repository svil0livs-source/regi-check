// Design Ref: DESIGN.md §4.4 — 스캔 PDF에서 페이지마다 스캔 사진 후보를 고른다 (서버·브라우저 공용).
// 2026-11-06: 요청 한도 때문에 브라우저가 PDF에서 사진만 꺼내 서버로 보낸다(배포본 요청 한도 약 4.5MB).
//   사진 자료는 고치지 않고 그대로 보낸다. 압축 풀기·사진 만들기는 서버(pdfImages.ts)가 한다.
//   색 공간이 다른 객체를 가리키면(ICCBased 등) 여기서 이름(/DeviceRGB·/DeviceGray)으로 바꿔 사진 사전만으로 읽을 수 있게 한다.
// 서류 내용은 로그에 남기지 않는다.
import { Buffer } from "buffer";

/** 페이지 사진으로 볼 최소 크기(픽셀). 이보다 작으면 로고·도장으로 본다 */
export const MIN_SIDE = 300;

export interface PdfObject {
  dict: string;
  /** stream 본문 (있으면) */
  data?: Buffer;
}

/** "12 0 obj << … >> stream … endstream endobj" 들을 번호별로 모은다 */
function readObjects(b: Buffer): Map<number, PdfObject> {
  const text = b.toString("latin1");
  const objs = new Map<number, PdfObject>();
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const id = Number(m[1]);
    const bodyStart = m.index + m[0].length;
    const endobj = text.indexOf("endobj", bodyStart);
    if (endobj === -1) break;
    const streamAt = text.indexOf("stream", bodyStart);
    if (streamAt !== -1 && streamAt < endobj && text.slice(bodyStart, streamAt).includes(">>")) {
      let start = streamAt + "stream".length;
      if (b[start] === 0x0d) start++;
      if (b[start] === 0x0a) start++;
      const end = text.indexOf("endstream", start);
      const stop = end === -1 ? endobj : end;
      // endstream 앞의 줄바꿈은 본문이 아니다
      let dataEnd = stop;
      if (b[dataEnd - 1] === 0x0a) dataEnd--;
      if (b[dataEnd - 1] === 0x0d) dataEnd--;
      objs.set(id, { dict: text.slice(bodyStart, streamAt), data: b.subarray(start, dataEnd) });
      re.lastIndex = (end === -1 ? endobj : end) + 1;
    } else {
      objs.set(id, { dict: text.slice(bodyStart, endobj) });
      re.lastIndex = endobj + 1;
    }
  }
  return objs;
}

export const num = (dict: string, key: string) => {
  const m = new RegExp(`/${key}\\s+(\\d+)`).exec(dict);
  return m ? Number(m[1]) : undefined;
};
const ref = (dict: string, key: string) => {
  const m = new RegExp(`/${key}\\s+(\\d+)\\s+\\d+\\s+R`).exec(dict);
  return m ? Number(m[1]) : undefined;
};
/** /Filter 값 목록 (이름 하나 또는 배열) */
export function filters(dict: string): string[] {
  const m = /\/Filter\s*(\[[^\]]*\]|\/\w+)/.exec(dict);
  if (!m) return [];
  return [...m[1].matchAll(/\/(\w+)/g)].map((x) => x[1]);
}
/** 사전 안에서 /Key << … >> 부분을 꺼낸다 (중첩 고려) */
export function subDict(dict: string, key: string): string | undefined {
  const at = dict.indexOf(`/${key}`);
  if (at === -1) return undefined;
  const open = dict.indexOf("<<", at);
  const nextSlash = dict.slice(at + key.length + 1).search(/\S/);
  if (open === -1 || open > at + key.length + 1 + nextSlash) return undefined;
  let depth = 0;
  for (let i = open; i < dict.length - 1; i++) {
    if (dict[i] === "<" && dict[i + 1] === "<") {
      depth++;
      i++;
    } else if (dict[i] === ">" && dict[i + 1] === ">") {
      depth--;
      i++;
      if (depth === 0) return dict.slice(open, i + 1);
    }
  }
  return undefined;
}

/** 페이지 목록 순서대로 페이지 객체 번호 */
function pageOrder(objs: Map<number, PdfObject>): number[] {
  const catalog = [...objs.values()].find((o) => /\/Type\s*\/Catalog/.test(o.dict));
  const root = catalog ? ref(catalog.dict, "Pages") : undefined;
  const out: number[] = [];
  const seen = new Set<number>();
  const walk = (id: number) => {
    if (seen.has(id)) return;
    seen.add(id);
    const o = objs.get(id);
    if (!o) return;
    if (/\/Type\s*\/Pages\b/.test(o.dict)) {
      const kids = /\/Kids\s*\[([^\]]*)\]/.exec(o.dict)?.[1] ?? "";
      for (const k of kids.matchAll(/(\d+)\s+\d+\s+R/g)) walk(Number(k[1]));
    } else if (/\/Type\s*\/Page\b/.test(o.dict)) out.push(id);
  };
  if (root !== undefined) walk(root);
  return out;
}

/** 페이지가 쓰는 사진 객체 번호들 */
function pageImageIds(objs: Map<number, PdfObject>, pageId: number): number[] {
  const page = objs.get(pageId);
  if (!page) return [];
  let res = subDict(page.dict, "Resources");
  const resRef = res ? undefined : ref(page.dict, "Resources");
  if (resRef !== undefined) res = objs.get(resRef)?.dict;
  if (!res) return [];
  let xo = subDict(res, "XObject");
  const xoRef = xo ? undefined : ref(res, "XObject");
  if (xoRef !== undefined) xo = objs.get(xoRef)?.dict;
  if (!xo) return [];
  return [...xo.matchAll(/\/[\w.-]+\s+(\d+)\s+\d+\s+R/g)].map((m) => Number(m[1]));
}

export const isImage = (o: PdfObject | undefined): o is Required<PdfObject> => !!o?.data && /\/Subtype\s*\/Image/.test(o.dict);

/** 사진의 색 공간: DeviceGray / DeviceRGB (ICCBased는 성분 수 N으로 판단). 그 밖(Indexed 등)은 그대로 이름을 돌려준다 */
function colorSpaceOf(dict: string, objs: Map<number, PdfObject>): string | undefined {
  let v = /\/ColorSpace\s*(\[[^\]]*\]|\/\w+|\d+\s+\d+\s+R)/.exec(dict)?.[1];
  if (!v) return undefined;
  const r = /^(\d+)\s+\d+\s+R$/.exec(v);
  if (r) v = objs.get(Number(r[1]))?.dict.trim() ?? "";
  if (/ICCBased/.test(v)) {
    const icc = /ICCBased\s+(\d+)\s+\d+\s+R/.exec(v)?.[1];
    const n = icc ? num(objs.get(Number(icc))?.dict ?? "", "N") : undefined;
    return n === 3 ? "DeviceRGB" : n === 1 ? "DeviceGray" : `ICC${n ?? ""}`;
  }
  return /\/(\w+)/.exec(v)?.[1];
}


/** 페이지 사진 후보 하나: 사진 사전(글자)과 압축된 자료 그대로 */
export interface PageImageObject {
  /** 몇 번째 페이지인지 (0부터) */
  page: number;
  dict: string;
  data: Uint8Array;
}

/** 사진 사전의 /ColorSpace를 다른 객체 참조 없이 읽을 수 있는 이름으로 바꾼다 */
function selfContainedDict(dict: string, objs: Map<number, PdfObject>): string {
  if (!/\/ColorSpace\s*(\[|\d)/.test(dict)) return dict;
  const cs = colorSpaceOf(dict, objs);
  const name = cs === "DeviceRGB" || cs === "DeviceGray" ? cs : "Unsupported";
  return dict.replace(/\/ColorSpace\s*(\[[^\]]*\]|\d+\s+\d+\s+R)/, `/ColorSpace /${name}`);
}

/**
 * 스캔 PDF에서 페이지마다 페이지 사진 후보(작은 로고·도장 제외)를 페이지 순서대로 고른다.
 * 페이지 목록을 못 읽으면 파일 안 순서로 사진마다 한 페이지로 본다.
 */
export function selectPageImages(pdf: Uint8Array): PageImageObject[] {
  const b = Buffer.from(pdf.buffer, pdf.byteOffset, pdf.byteLength);
  const objs = readObjects(b);
  const order = pageOrder(objs);
  const groups: number[][] = order.length
    ? order.map((p) => pageImageIds(objs, p).filter((id) => isImage(objs.get(id))))
    : [...objs.entries()].filter(([, o]) => isImage(o)).map(([id]) => [id]);
  const out: PageImageObject[] = [];
  let page = 0;
  for (const ids of groups) {
    let found = false;
    for (const id of new Set(ids)) {
      const o = objs.get(id);
      if (!isImage(o)) continue;
      const w = num(o.dict, "Width") ?? 0;
      const h = num(o.dict, "Height") ?? 0;
      if (Math.min(w, h) < MIN_SIDE) continue;
      out.push({ page, dict: selfContainedDict(o.dict, objs), data: new Uint8Array(o.data) });
      found = true;
    }
    if (found) page++;
  }
  return out;
}
