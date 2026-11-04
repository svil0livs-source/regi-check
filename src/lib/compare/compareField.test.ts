// 항목 비교 시험: PRD의 "한 글자/한 자리라도 다르면 불일치" 규칙과 확인 필요 규칙을 확인한다.
import { describe, expect, it } from "vitest";
import { compareField } from "./compareField";

const v = (value: string | null, lowConfidence = false) => ({ value, lowConfidence });

describe("compareField: 이름·주소", () => {
  it("한 글자라도 다르면 불일치", () => {
    expect(compareField("debtor", v("홍길동"), v("홍길돈")).status).toBe("mismatch");
    expect(
      compareField("location", v("서울특별시 강남구 역삼동"), v("서울특별시 강남구 역삼등")).status,
    ).toBe("mismatch");
  });

  it("한자 병기만 다르면 일치 (한자는 검사하지 않음)", () => {
    expect(compareField("owner", v("홍길동(洪吉童)"), v("홍길동")).status).toBe("match");
  });

  it("한자를 빼고 남은 한글이 다르면 불일치", () => {
    expect(compareField("owner", v("홍길동(洪吉童)"), v("홍길돈")).status).toBe("mismatch");
  });

  it("한자로만 적힌 이름은 비교할 수 없어 확인 필요", () => {
    expect(compareField("owner", v("洪吉童"), v("홍길동")).status).toBe("needs_review");
  });

  it("띄어쓰기만 다르면 일치", () => {
    expect(
      compareField("location", v("서울특별시 강남구 역삼동"), v("서울특별시강남구 역삼동")).status,
    ).toBe("match");
  });
});

describe("compareField: 빈칸", () => {
  it("지번·호수·면적이 양쪽 다 원래 빈칸이면 일치", () => {
    expect(compareField("unitNumber", v(""), v("  ")).status).toBe("match");
  });

  it("호수가 한쪽만 빈칸이면 불일치", () => {
    expect(compareField("unitNumber", v(""), v("101호")).status).toBe("mismatch");
  });

  it("이름이 빈칸이면 확인 필요", () => {
    expect(compareField("owner", v(""), v("")).status).toBe("needs_review");
  });

  it("호수가 한자로만 적혀 비면 확인 필요", () => {
    expect(compareField("unitNumber", v("壹號"), v("")).status).toBe("needs_review");
  });
});

describe("compareField: 채권최고액", () => {
  it("숫자 한 자리라도 다르면 불일치", () => {
    expect(
      compareField("maxClaimAmount", v("금 120,000,000원"), v("금 129,000,000원")).status,
    ).toBe("mismatch");
  });

  it("한자(金), 금, 쉼표, 원정 표기 차이는 일치", () => {
    expect(
      compareField("maxClaimAmount", v("金120,000,000원정"), v("금 120000000원")).status,
    ).toBe("match");
  });

  it("자릿수가 다르면 불일치 (0 하나 빠짐)", () => {
    expect(
      compareField("maxClaimAmount", v("금 12,000,000원"), v("금 120,000,000원")).status,
    ).toBe("mismatch");
  });

  it("숫자를 한글로 쓴 금액은 확인 필요", () => {
    expect(
      compareField("maxClaimAmount", v("금일억이천만원"), v("금 120,000,000원")).status,
    ).toBe("needs_review");
  });
});

describe("compareField: 접수번호", () => {
  it("숫자 한 자리라도 다르면 불일치", () => {
    expect(compareField("receiptNumber", v("제12345호"), v("제12346호")).status).toBe("mismatch");
  });

  it("제·호·공백 차이는 일치", () => {
    expect(compareField("receiptNumber", v("제 12345 호"), v("12345")).status).toBe("match");
  });
});

describe("compareField: 등기날짜", () => {
  it("연·월·일 중 하나라도 다르면 불일치", () => {
    expect(
      compareField("registrationDate", v("2026년 11월 4일"), v("2026년 11월 5일")).status,
    ).toBe("mismatch");
    expect(
      compareField("registrationDate", v("2026년 11월 4일"), v("2025년 11월 4일")).status,
    ).toBe("mismatch");
  });

  it("표기 형식만 다르면 일치", () => {
    expect(compareField("registrationDate", v("2026.11.04"), v("2026년 11월 4일")).status).toBe(
      "match",
    );
  });

  it("날짜로 읽을 수 없으면 확인 필요", () => {
    expect(
      compareField("registrationDate", v("2026년 11월"), v("2026년 11월 4일")).status,
    ).toBe("needs_review");
  });
});

describe("compareField: 읽지 못함·확신 낮음", () => {
  it("어느 한쪽이라도 읽지 못하면 읽지 못함", () => {
    const result = compareField("owner", v(null), v("홍길동"));
    expect(result.status).toBe("unreadable");
    expect(result.reason).toContain("한글 서류");
  });

  it("확신이 낮으면 값이 같아도 일치가 아니라 확인 필요", () => {
    expect(compareField("owner", v("홍길동"), v("홍길동", true)).status).toBe("needs_review");
  });

  it("확신이 낮으면 값이 달라도 확인 필요 (낮은 확신 값은 그대로 쓰지 않음)", () => {
    expect(compareField("owner", v("홍길동"), v("홍길돈", true)).status).toBe("needs_review");
  });

  it("두 문서 값을 결과에 그대로 담는다 (상세 화면용)", () => {
    const result = compareField("debtor", v("홍길동"), v("홍길돈"));
    expect(result.hwpValue).toBe("홍길동");
    expect(result.registryValue).toBe("홍길돈");
    expect(result.group).toBe("parties");
  });
});
