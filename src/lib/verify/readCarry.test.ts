// 나눠 읽기 꾸러미(암호화된 앞부분) 시험 (2026-11-06)
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { CARRY_TTL_MS, CarryKeyMissing, openCarry, sealCarry } from "./readCarry";

const state = {
  skip: "skip" as const,
  lines: [{ text: "근저당권설정 제12345호", words: [{ text: "근저당권설정", confidence: 91.4 }, { text: "제12345호", confidence: 88.6 }] }],
};
const at = { folder: "2026-0001", pass: 1, chunk: 2 };

describe("readCarry", () => {
  it("같은 자리에서 열면 읽은 줄과 상태가 그대로 돌아온다 (확신도는 정수로)", () => {
    const sealed = sealCarry(state, at);
    expect(openCarry(sealed, at)).toEqual({
      skip: "skip",
      lines: [{ text: "근저당권설정 제12345호", words: [{ text: "근저당권설정", confidence: 91 }, { text: "제12345호", confidence: 89 }] }],
    });
  });

  it("브라우저에서 내용을 볼 수 없다 (읽은 글자가 그대로 들어 있지 않음)", () => {
    const sealed = sealCarry(state, at);
    expect(sealed).not.toContain("12345");
    expect(Buffer.from(sealed, "base64url").toString("utf8")).not.toContain("12345");
  });

  it("다른 건·다른 읽기 순서·다른 조각에서는 열리지 않는다", () => {
    const sealed = sealCarry(state, at);
    expect(openCarry(sealed, { ...at, folder: "2026-0002" })).toBeNull();
    expect(openCarry(sealed, { ...at, pass: 0 })).toBeNull();
    expect(openCarry(sealed, { ...at, chunk: 3 })).toBeNull();
  });

  it("고쳤거나 시간이 지났거나 모양이 틀리면 열리지 않는다", () => {
    const now = Date.now();
    const sealed = sealCarry(state, at, now);
    const raw = Buffer.from(sealed, "base64url");
    raw[raw.length - 1] ^= 1;
    expect(openCarry(raw.toString("base64url"), at, now)).toBeNull();
    expect(openCarry(sealed, at, now + CARRY_TTL_MS + 1)).toBeNull();
    expect(openCarry("not base64 !!", at)).toBeNull();
    expect(openCarry("", at)).toBeNull();
  });

  it("배포본(Vercel)에 열쇠가 없으면 임시 열쇠를 쓰지 않고 알린다", () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("READ_CARRY_KEY", "");
    try {
      expect(() => sealCarry(state, at)).toThrow(CarryKeyMissing);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("열쇠가 있으면 그 열쇠로 연다 (서버가 여러 대여도 같은 열쇠)", () => {
    vi.stubEnv("READ_CARRY_KEY", "시험용-열쇠");
    try {
      const sealed = sealCarry(state, at);
      expect(openCarry(sealed, at)?.skip).toBe("skip");
      vi.stubEnv("READ_CARRY_KEY", "다른-열쇠");
      expect(openCarry(sealed, at)).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
