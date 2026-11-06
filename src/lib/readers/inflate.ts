// 압축 풀기 (서버와 브라우저 공용).
// 2026-11-06: 한글 파일을 브라우저에서 읽도록 바뀌어(파일당 6000KB까지 받기 위해) node:zlib 대신 fflate를 쓴다.
import { Buffer } from "buffer";
import { inflateSync, unzlibSync } from "fflate";

/** zlib 머리말(2바이트)이 붙은 압축인지 */
const hasZlibHeader = (b: Uint8Array) => b.length >= 2 && (b[0] & 0x0f) === 8 && ((b[0] << 8) | b[1]) % 31 === 0;

/** 머리말 없는 deflate 압축을 푼다. 깨진 압축이면 오류를 던진다 */
export const inflateRaw = (data: Uint8Array): Buffer => Buffer.from(inflateSync(data));

/** zlib 머리말이 붙은 압축을 푼다. 깨진 압축이면 오류를 던진다 */
export const inflateZlib = (data: Uint8Array): Buffer => Buffer.from(unzlibSync(data));

/** 머리말이 있으면 zlib로, 없으면 deflate로 푼다 (어느 쪽이든 실패하면 다른 쪽을 한 번 더 시도) */
export function inflateAny(data: Uint8Array): Buffer {
  const [first, second] = hasZlibHeader(data) ? [inflateZlib, inflateRaw] : [inflateRaw, inflateZlib];
  try {
    return first(data);
  } catch {
    return second(data);
  }
}
