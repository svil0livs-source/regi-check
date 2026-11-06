// 등기부 사진을 요청 한도(약 4.5MB)에 맞게 몇 쪽씩 나눠 보내는 규칙 (2026-11-06, 파일 크기 한도를 없애면서).
// 화면과 분리된 순수 함수. 한 페이지의 사진들은 같은 요청에 함께 넣는다.
import type { PageImageObject } from "@/lib/readers/pdfPages";
import { MAX_REQUEST_BYTES, type ImageMeta } from "@/lib/verify/caseRequest";

/** 요청 안 칸마다 붙는 머리말 몫 (넉넉히) */
export const PART_OVERHEAD = 200;
/** 사진 말고 요청에 들어가는 것(건 이름·단계·순서 등)의 몫 */
export const BASE_OVERHEAD = 4 * 1024;
/** 앞 조각에서 넘어오는 이어 읽기 꾸러미 몫 (실제 등기부 23쪽에서 수십 KB였다. 넉넉히 1MB) */
export const CARRY_RESERVE = 1024 * 1024;
/** 페이지 하나가 넘으면 안 되는 크기: 이보다 크면 화질을 낮춰 다시 저장한다 */
export const PAGE_ROOM = MAX_REQUEST_BYTES - BASE_OVERHEAD - CARRY_RESERVE;

const metaOf = (o: PageImageObject): ImageMeta => ({ page: o.page, dict: o.dict });
/** 사진 하나가 요청에서 차지하는 크기 (자료 + 사진 정보 + 머리말) */
export const imageCost = (o: PageImageObject) => o.data.byteLength + JSON.stringify(metaOf(o)).length + 2 + PART_OVERHEAD;

/** 페이지 순서대로 사진을 페이지마다 묶는다 */
export function groupByPage(images: PageImageObject[]): PageImageObject[][] {
  const groups: PageImageObject[][] = [];
  for (const o of images) {
    const g = groups[groups.length - 1];
    if (g && g[0].page === o.page) g.push(o);
    else groups.push([o]);
  }
  return groups;
}

/**
 * start번째 사진부터 room 바이트 안에 들어가는 만큼(페이지 단위로) 고른다. 끝 위치(포함하지 않음)를 돌려준다.
 * 첫 페이지조차 안 들어가면 start를 그대로 돌려준다.
 */
export function takeChunk(images: PageImageObject[], start: number, room: number): number {
  let end = start;
  let used = 0;
  while (end < images.length) {
    let next = end;
    let cost = 0;
    while (next < images.length && images[next].page === images[end].page) cost += imageCost(images[next++]);
    if (used + cost > room) break;
    used += cost;
    end = next;
  }
  return end;
}

/** 이번 요청에 사진을 담을 수 있는 크기 (앞 조각 꾸러미와 건 이름 몫을 뺌) */
export const chunkRoom = (folder: string, carry?: string) =>
  MAX_REQUEST_BYTES - BASE_OVERHEAD - new Blob([folder]).size - (carry?.length ?? 0) - (carry ? PART_OVERHEAD : 0);

/** 읽기 요청 하나 (step=read) */
export function readBody(
  folder: string,
  images: PageImageObject[],
  at: { pass: number; chunk: number; last: boolean; carry?: string },
): FormData {
  const body = new FormData();
  body.set("step", "read");
  body.set("folder", folder);
  body.set("pass", String(at.pass));
  body.set("chunk", String(at.chunk));
  body.set("last", at.last ? "1" : "0");
  if (at.carry) body.set("carry", at.carry);
  body.set("images", JSON.stringify(images.map(metaOf)));
  images.forEach((o, i) => body.set(`img${i}`, new Blob([o.data as BlobPart]), `p${i}`));
  return body;
}
