// 큰 등기부를 몇 쪽씩 나눠 읽을 때, 앞 조각에서 읽은 줄을 다음 요청으로 넘기는 「이어 읽기 꾸러미」 (2026-11-06).
// 파일 크기 한도를 없애면서(사용자 결정), 요청 한도(약 4.5MB) 때문에 사진을 여러 요청으로 나눠 보낸다.
// 근저당권 한 줄이 페이지를 넘어갈 수 있어 조각마다 따로 해석하지 않고, 읽은 줄을 모아 마지막 조각에서 한꺼번에 해석한다.
// 읽은 원문이 브라우저에서 보이지 않도록 서버만 아는 열쇠로 암호화(AES-256-GCM)한다. 서버에는 아무것도 남기지 않는다.
//   - 열쇠: 환경 변수 READ_CARRY_KEY (없으면 이 서버 프로세스가 켜질 때 만든 임시 열쇠 — 개발용)
//   - 건 이름·읽기 순서·조각 번호에 묶여 있어 다른 건·다른 순서에 쓸 수 없고, 30분이 지나면 못 쓴다.
import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import type { ParseLine } from "@/lib/readers/registryParse";
import type { PassCarry } from "@/lib/readers/registryRead";

type CarryState = PassCarry;

/** 꾸러미가 묶이는 자리: 같은 건·같은 읽기 순서·바로 다음 조각에서만 열린다 */
export interface CarryBinding {
  folder: string;
  pass: number;
  chunk: number;
}

/** 꾸러미를 쓸 수 있는 시간 */
export const CARRY_TTL_MS = 30 * 60 * 1000;
/** 꾸러미 글자의 최대 길이 (브라우저가 보낸 값을 그대로 믿지 않는다) */
export const MAX_CARRY_CHARS = 3 * 1024 * 1024;

/** 배포본에 열쇠가 없을 때 (서버가 여러 대라 임시 열쇠로는 다음 요청에서 못 연다) */
export class CarryKeyMissing extends Error {}

let devKey: Buffer | null = null;
function key(): Buffer {
  const secret = process.env.READ_CARRY_KEY;
  if (secret) return createHash("sha256").update(secret).digest();
  if (process.env.VERCEL) throw new CarryKeyMissing("READ_CARRY_KEY 없음");
  devKey ??= randomBytes(32);
  return devKey;
}

const bindingOf = (b: CarryBinding) => Buffer.from(JSON.stringify([b.folder, b.pass, b.chunk]), "utf8");

/** 읽기 상태를 암호화한 글자로 만든다 */
export function sealCarry(state: CarryState, binding: CarryBinding, now = Date.now()): string {
  // 확신도는 정수로 줄여 꾸러미를 작게 한다
  const lines = state.lines.map((l) => ({ text: l.text, words: l.words.map((w) => ({ text: w.text, confidence: Math.round(w.confidence) })) }));
  const plain = deflateRawSync(Buffer.from(JSON.stringify({ exp: now + CARRY_TTL_MS, skip: state.skip, lines }), "utf8"));
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(bindingOf(binding));
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

/** 꾸러미를 연다. 위조·다른 자리·시간 초과·모양 틀림이면 null */
export function openCarry(sealed: string, binding: CarryBinding, now = Date.now()): CarryState | null {
  if (sealed.length > MAX_CARRY_CHARS || !/^[A-Za-z0-9_-]+$/.test(sealed)) return null;
  const k = key();
  try {
    const raw = Buffer.from(sealed, "base64url");
    if (raw.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", k, raw.subarray(0, 12));
    decipher.setAAD(bindingOf(binding));
    decipher.setAuthTag(raw.subarray(12, 28));
    const plain = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
    const data = JSON.parse(inflateRawSync(plain).toString("utf8")) as { exp?: unknown; skip?: unknown; lines?: unknown };
    if (typeof data.exp !== "number" || data.exp < now) return null;
    if (data.skip !== "none" && data.skip !== "skip") return null;
    if (!Array.isArray(data.lines)) return null;
    return { skip: data.skip, lines: data.lines as ParseLine[] };
  } catch {
    return null;
  }
}
