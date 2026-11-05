// 업로드 검사 규칙 시험 (DESIGN.md §3.1)
import { describe, expect, it } from "vitest";
import { checkFolders, MAX_CASE_BYTES, MAX_FILE_BYTES } from "./checkFolders";

const f = (path: string, size = 1000) => ({ path, size });

describe("checkFolders", () => {
  it("한글 1개 + PDF 1개면 검증 가능", () => {
    const r = checkFolders([f("2026-0001/신청서.hwp"), f("2026-0001/등기부.pdf")]);
    expect(r.cases).toHaveLength(1);
    expect(r.cases[0]).toMatchObject({ folder: "2026-0001", ok: true, hwpPath: "2026-0001/신청서.hwp" });
  });

  it("상위 폴더째 고르면 하위 건 폴더들을 건으로 보고, 상위의 정답표 파일은 무시", () => {
    const r = checkFolders([
      f("fixtures/정답표.md"),
      f("fixtures/2026-0001/a.hwp"),
      f("fixtures/2026-0001/a.pdf"),
      f("fixtures/2026-0002/b.hwp"),
      f("fixtures/2026-0002/b.pdf"),
    ]);
    expect(r.cases.map((c) => c.folder)).toEqual(["2026-0001", "2026-0002"]);
    expect(r.cases.every((c) => c.ok)).toBe(true);
  });

  it("PDF가 없으면 그 폴더만 문제, 나머지는 계속", () => {
    const r = checkFolders([f("A/a.hwp"), f("B/b.hwp"), f("B/b.pdf")]);
    expect(r.cases.find((c) => c.folder === "A")).toMatchObject({ ok: false, reasons: ["등기부등본 PDF 없음"] });
    expect(r.cases.find((c) => c.folder === "B")?.ok).toBe(true);
  });

  it("한글 파일이 2개면 초과", () => {
    const r = checkFolders([f("A/a.hwp"), f("A/b.hwp"), f("A/a.pdf")]);
    expect(r.cases[0].reasons).toContain("한글 파일이 2개");
  });

  it("다른 파일이 섞여 있으면 문제", () => {
    const r = checkFolders([f("A/a.hwp"), f("A/a.pdf"), f("A/메모.txt")]);
    expect(r.cases[0].reasons).toContain("다른 파일이 들어 있음");
  });

  it("Thumbs.db, desktop.ini, 숨김 파일은 무시", () => {
    const r = checkFolders([f("A/a.hwp"), f("A/a.pdf"), f("A/Thumbs.db"), f("A/desktop.ini"), f("A/.DS_Store")]);
    expect(r.cases[0].ok).toBe(true);
  });

  it(".hwpx는 아직 지원하지 않는다고 알려 준다", () => {
    const r = checkFolders([f("A/a.hwpx"), f("A/a.pdf")]);
    expect(r.cases[0].reasons).toContain("한글 파일이 .hwpx 형식임 (.hwp만 지원)");
  });

  it("한 건의 두 파일 합계가 4.3MB를 넘으면 문제 (배포본 요청 한도)", () => {
    const r = checkFolders([f("A/a.hwp", 1024 * 1024), f("A/a.pdf", MAX_CASE_BYTES)]);
    expect(r.cases[0].ok).toBe(false);
    expect(r.cases[0].reasons.join(" ")).toContain("합계");
    const ok = checkFolders([f("B/b.hwp", 100 * 1024), f("B/b.pdf", 3 * 1024 * 1024)]);
    expect(ok.cases[0].ok).toBe(true);
  });

  it("20MB 초과 파일이 있으면 문제", () => {
    const r = checkFolders([f("A/a.hwp"), f("A/a.pdf", MAX_FILE_BYTES + 1)]);
    expect(r.cases[0].reasons).toContain("20MB 초과: a.pdf");
  });

  it("같은 이름 폴더가 두 군데 있으면 둘 다 문제", () => {
    const r = checkFolders([f("x/A/a.hwp"), f("x/A/a.pdf"), f("y/A/a.hwp"), f("y/A/a.pdf")]);
    expect(r.cases).toHaveLength(2);
    expect(r.cases.every((c) => !c.ok && c.reasons.includes("같은 이름 폴더가 있음"))).toBe(true);
  });

  it("31건이면 아무것도 처리하지 않고 안내", () => {
    const entries = Array.from({ length: 31 }, (_, i) => [f(`c${i}/a.hwp`), f(`c${i}/a.pdf`)]).flat();
    const r = checkFolders(entries);
    expect(r.cases).toEqual([]);
    expect(r.blockingError).toContain("30건");
  });

  it("30건까지는 받는다", () => {
    const entries = Array.from({ length: 30 }, (_, i) => [f(`c${i}/a.hwp`), f(`c${i}/a.pdf`)]).flat();
    expect(checkFolders(entries).cases).toHaveLength(30);
  });

  it("확장자 대소문자는 구분하지 않는다", () => {
    expect(checkFolders([f("A/a.HWP"), f("A/a.Pdf")]).cases[0].ok).toBe(true);
  });
});
