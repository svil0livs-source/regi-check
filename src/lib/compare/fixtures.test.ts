// 시험용 서류 20건의 값(scripts/fixtures/cases.mjs가 만든 데이터)을 대조 코드에 그대로 넣어
// 정답표대로 나오는지 확인한다. 서류를 읽는 부분은 빼고, "값을 정확히 읽었다면" 결과가 맞는지만 본다.
// 데이터(tests/fixtures-build/cases.json)는 커밋하지 않으므로, 없으면 이 시험은 건너뛴다.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DocumentFields, ExtractedValue, PropertyEntry } from "@/types/verification";
import { compareDocuments } from "./compareDocuments";
import { summarizeCase } from "./summarize";

const dataPath = join(process.cwd(), "tests", "fixtures-build", "cases.json");

interface RawDoc {
  parties: Record<"mortgagee" | "assignee" | "debtor" | "owner", string[]>;
  properties: Record<keyof PropertyEntry, string>[];
  maxClaimAmount: string;
  receiptNumber: string;
  transferReceiptNumber: string;
  registrationDate: string;
  transferRegistrationDate: string;
  extra: { persons: Record<string, { id: string }> };
}
interface RawCase {
  folder: string;
  expected: "전부 일치" | "불일치 있음";
  errors: { key: string }[];
  hwp: RawDoc;
  registry: RawDoc;
}

const v = (value: string): ExtractedValue => ({ value });

function toFields(d: RawDoc): DocumentFields {
  return {
    parties: {
      mortgagee: d.parties.mortgagee.map(v),
      assignee: d.parties.assignee.map(v),
      debtor: d.parties.debtor.map(v),
      owner: d.parties.owner.map(v),
    },
    properties: d.properties.map((p) => ({
      location: v(p.location),
      lotNumber: v(p.lotNumber),
      unitNumber: v(p.unitNumber),
      area: v(p.area),
    })),
    maxClaimAmount: v(d.maxClaimAmount),
    receiptNumber: v(d.receiptNumber),
    transferReceiptNumber: v(d.transferReceiptNumber),
    registrationDate: v(d.registrationDate),
    transferRegistrationDate: v(d.transferRegistrationDate),
    // 등록번호는 앞 6자리만 (뒷자리는 쓰지 않는다)
    mortgageeIdFront: v(d.extra.persons[d.parties.mortgagee[0]].id.split("-")[0]),
    assigneeIdFront: v(d.extra.persons[d.parties.assignee[0]].id.split("-")[0]),
  };
}

const cases: RawCase[] = existsSync(dataPath) ? JSON.parse(readFileSync(dataPath, "utf8")) : [];

describe.skipIf(cases.length === 0)("시험용 서류 20건 정답표 (값을 정확히 읽었다고 가정)", () => {
  it.each(cases.map((c) => [c.folder, c] as const))("%s", (_folder, c) => {
    const results = compareDocuments(toFields(c.hwp), toFields(c.registry));
    const summary = summarizeCase(results);

    if (c.expected === "전부 일치") {
      // 오탐이 나면 안 된다
      expect(summary).toBe("all_match");
    } else {
      // 심어 둔 오류 항목이 「불일치」 또는 「확인 필요」로 잡혀야 한다 (검출)
      expect(summary).not.toBe("all_match");
      for (const e of c.errors) {
        const hit = results.filter((r) => r.key === e.key && r.status !== "match");
        expect(hit.length, `${c.folder}의 ${e.key} 오류를 놓침`).toBeGreaterThan(0);
      }
      // 심지 않은 항목이 틀렸다고 나오면 안 된다
      const wrong = results.filter(
        (r) => r.status !== "match" && !c.errors.some((e) => e.key === r.key),
      );
      expect(wrong.map((r) => r.key)).toEqual([]);
    }
  });
});
