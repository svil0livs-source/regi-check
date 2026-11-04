// 정규화 규칙 시험: 같다고 볼 것(공백·쉼표·한자)과 같다고 보면 안 되는 것을 함께 확인한다.
import { describe, expect, it } from "vitest";
import {
  normalizeAmount,
  normalizeReceiptNumber,
  normalizeText,
  parseDate,
} from "./normalize";

describe("normalizeText", () => {
  it("공백·줄바꿈·전각 공백을 없앤다", () => {
    expect(normalizeText(" 서울특별시  강남구\n역삼동　")).toBe("서울특별시강남구역삼동");
  });

  it("쉼표(전각 포함)를 없앤다", () => {
    expect(normalizeText("1,234，567")).toBe("1234567");
  });

  it("金을 금으로 바꾼다", () => {
    expect(normalizeText("金120,000,000원")).toBe(normalizeText("금 120,000,000원"));
  });

  it("전각 숫자를 일반 숫자로 바꾼다", () => {
    expect(normalizeText("１２３")).toBe("123");
  });

  it("㎡와 m²를 같게 본다", () => {
    expect(normalizeText("84.97㎡")).toBe(normalizeText("84.97m²"));
  });

  it("글자가 다르면 그대로 다르게 남긴다", () => {
    expect(normalizeText("홍길동")).not.toBe(normalizeText("홍길돈"));
  });
});

describe("normalizeAmount", () => {
  it("금·원·원정·쉼표·공백을 떼고 숫자만 남긴다", () => {
    expect(normalizeAmount("金 120,000,000원정")).toBe("120000000");
    expect(normalizeAmount("금120000000원")).toBe("120000000");
    expect(normalizeAmount("120,000,000")).toBe("120000000");
  });

  it("숫자를 한글로 쓴 금액은 자동 변환하지 않는다 (확인 필요)", () => {
    expect(normalizeAmount("금일억이천만원")).toBeNull();
  });

  it("숫자 외 글자가 섞이면 null", () => {
    expect(normalizeAmount("금 12O,000,000원")).toBeNull(); // 영문 O
  });
});

describe("normalizeReceiptNumber", () => {
  it("제·호를 떼고 숫자만 남긴다", () => {
    expect(normalizeReceiptNumber("제12345호")).toBe("12345");
    expect(normalizeReceiptNumber("제 12345 호")).toBe("12345");
  });

  it("숫자가 아닌 글자가 섞이면 null", () => {
    expect(normalizeReceiptNumber("제1234S호")).toBeNull();
  });
});

describe("parseDate", () => {
  it("여러 형식을 같은 연·월·일로 읽는다", () => {
    const expected = { year: 2026, month: 11, day: 4 };
    expect(parseDate("2026년 11월 4일")).toEqual(expected);
    expect(parseDate("2026.11.04")).toEqual(expected);
    expect(parseDate("2026. 11. 4.")).toEqual(expected);
    expect(parseDate("2026-11-04")).toEqual(expected);
    expect(parseDate("2026/11/4")).toEqual(expected);
  });

  it("달력에 없는 날짜는 null", () => {
    expect(parseDate("2026년 2월 30일")).toBeNull();
  });

  it("형식이 다르면 null", () => {
    expect(parseDate("11월 4일")).toBeNull();
  });
});
