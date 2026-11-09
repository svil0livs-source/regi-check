// 업로드 검사 규칙 시험 (DESIGN.md §3.1)
import { describe, expect, it } from "vitest";
import { checkFolders, pairByName } from "./checkFolders";

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

  it("한글·PDF가 아닌 파일은 무시 (2026-11-06)", () => {
    const r = checkFolders([f("A/a.hwp"), f("A/a.pdf"), f("A/메모.txt"), f("A/사진.jpg")]);
    expect(r.cases).toHaveLength(1);
    expect(r.cases[0].ok).toBe(true);
  });

  it("Thumbs.db, desktop.ini, 숨김 파일은 무시", () => {
    const r = checkFolders([f("A/a.hwp"), f("A/a.pdf"), f("A/Thumbs.db"), f("A/desktop.ini"), f("A/.DS_Store")]);
    expect(r.cases[0].ok).toBe(true);
  });

  it(".hwpx(신버전 한글)도 받는다", () => {
    const r = checkFolders([f("A/a.hwpx"), f("A/a.pdf")]);
    expect(r.cases[0].ok).toBe(true);
    expect(r.cases[0].hwpPath).toBe("A/a.hwpx");
  });

  it("파일 크기 한도는 없다 (2026-11-06 사용자 결정: 실제 등기부가 13.9MB)", () => {
    const r = checkFolders([f("A/a.hwp", 50 * 1024 * 1024), f("A/a.pdf", 200 * 1024 * 1024)]);
    expect(r.cases[0].ok).toBe(true);
  });

  it("같은 이름 폴더가 두 군데 있으면 둘 다 문제", () => {
    const r = checkFolders([f("x/A/a.hwp"), f("x/A/a.pdf"), f("y/A/a.hwp"), f("y/A/a.pdf")]);
    expect(r.cases).toHaveLength(2);
    expect(r.cases.every((c) => !c.ok && c.reasons.includes("같은 이름 폴더가 있음"))).toBe(true);
  });

  it("한 폴더에 여러 건: 파일 이름의 같은 값(채무자 이름)으로 짝짓는다", () => {
    const r = checkFolders([
      f("묶음/근저당권이전_홍길동.hwp"),
      f("묶음/근저당권이전_김철수.hwpx"),
      f("묶음/등기부_김철수.pdf"),
      f("묶음/등기부_홍길동.pdf"),
    ]);
    expect(r.cases).toHaveLength(2);
    expect(r.cases.every((c) => c.ok)).toBe(true);
    const hong = r.cases.find((c) => c.hwpPath === "묶음/근저당권이전_홍길동.hwp");
    expect(hong).toMatchObject({ folder: "묶음 / 근저당권이전_홍길동", pdfPaths: ["묶음/등기부_홍길동.pdf"] });
    expect(r.cases.find((c) => c.hwpPath?.endsWith("김철수.hwpx"))?.pdfPaths).toEqual(["묶음/등기부_김철수.pdf"]);
  });

  it("구분 기호 없이 붙어 있어도, 성이 같아도 이름 전체로 짝짓는다", () => {
    const r = checkFolders([f("A/김철수신청서.hwp"), f("A/김영희신청서.hwp"), f("A/김영희등기부.pdf"), f("A/김철수등기부.pdf")]);
    expect(r.cases.find((c) => c.hwpPath === "A/김철수신청서.hwp")?.pdfPaths).toEqual(["A/김철수등기부.pdf"]);
    expect(r.cases.find((c) => c.hwpPath === "A/김영희신청서.hwp")?.pdfPaths).toEqual(["A/김영희등기부.pdf"]);
  });

  it("등기부 하나에 한글 파일 여러 개가 짝지어질 수 있다", () => {
    const r = checkFolders([f("A/홍길동_1번.hwp"), f("A/홍길동_2번.hwp"), f("A/홍길동_등기부.pdf"), f("A/김철수_등기부.pdf"), f("A/김철수.hwp")]);
    expect(r.cases.filter((c) => c.pdfPaths.includes("A/홍길동_등기부.pdf"))).toHaveLength(2);
    expect(r.cases.every((c) => c.ok)).toBe(true);
  });

  it("짝을 못 찾은 한글 파일과 짝 없는 PDF는 「파일 부족/초과」로 따로 한 줄씩", () => {
    const r = checkFolders([f("A/홍길동.hwp"), f("A/김철수.hwp"), f("A/홍길동.pdf"), f("A/이영희.pdf")]);
    expect(r.cases.find((c) => c.hwpPath === "A/홍길동.hwp")?.ok).toBe(true);
    const kim = r.cases.find((c) => c.id === "A/김철수.hwp");
    expect(kim?.ok).toBe(false);
    expect(kim?.reasons[0]).toContain("같은 값이 들어 있는 등기부등본 PDF 없음");
    const orphan = r.cases.find((c) => c.id === "A/이영희.pdf");
    expect(orphan).toMatchObject({ ok: false, folder: "A / 이영희.pdf", reasons: ["짝이 되는 한글 파일 없음: 이영희.pdf"] });
  });

  it("이 한글 파일만 가진 이름이 든 PDF는 여러 개여도 모두 그 건의 등기부 (2026-11-09 사용자 결정: 토지·건물 등기부)", () => {
    const r = checkFolders([f("A/홍길동.hwp"), f("A/김철수.hwp"), f("A/홍길동_건물.pdf"), f("A/홍길동_토지.pdf"), f("A/김철수.pdf")]);
    expect(r.cases.find((c) => c.id === "A/홍길동.hwp")).toMatchObject({ ok: true, pdfPaths: ["A/홍길동_건물.pdf", "A/홍길동_토지.pdf"] });
    expect(r.cases.find((c) => c.id === "A/김철수.hwp")).toMatchObject({ ok: true, pdfPaths: ["A/김철수.pdf"] });
  });

  it("짝이 하나로 정해지지 않으면 추측하지 않는다", () => {
    const r = checkFolders([f("A/홍길동_1.hwp"), f("A/홍길동_2.hwp"), f("A/홍길동_건물.pdf"), f("A/홍길동_토지.pdf"), f("A/김철수.pdf")]);
    const hong = r.cases.find((c) => c.id === "A/홍길동_1.hwp");
    expect(hong?.ok).toBe(false);
    expect(hong?.reasons[0]).toContain("여러 개");
  });

  it("한글 파일 1개인 폴더는 PDF가 여러 개여도 1건 (2026-11-09)", () => {
    const r = checkFolders([f("6/양도증서.hwp"), f("6/6-1.건물.pdf"), f("6/6-2.토지.pdf")]);
    expect(r.cases).toHaveLength(1);
    expect(r.cases[0]).toMatchObject({ ok: true, folder: "6", pdfPaths: ["6/6-1.건물.pdf", "6/6-2.토지.pdf"] });
  });

  it("모든 파일 이름에 들어 있는 말(근저당권 등)로는 짝짓지 않는다", () => {
    const p = pairByName(
      [{ name: "근저당권_가.hwp", path: "A/근저당권_가.hwp", size: 1 }, { name: "근저당권_나.hwp", path: "A/근저당권_나.hwp", size: 1 }],
      [{ name: "근저당권_등기부.pdf", path: "A/근저당권_등기부.pdf", size: 1 }],
    );
    expect(p.pairs.size).toBe(0);
    expect(p.orphanPdfs).toEqual(["A/근저당권_등기부.pdf"]);
  });

  it("번호가 이름이면 번호 전체로 짝짓는다 (1과 10을 섞지 않음)", () => {
    const r = checkFolders([f("A/1.hwp"), f("A/10.hwp"), f("A/10.pdf"), f("A/1.pdf")]);
    expect(r.cases.find((c) => c.id === "A/1.hwp")?.pdfPaths).toEqual(["A/1.pdf"]);
    expect(r.cases.find((c) => c.id === "A/10.hwp")?.pdfPaths).toEqual(["A/10.pdf"]);
  });

  it("맥에서 고른 파일 이름(자모 분리)도 짝짓는다", () => {
    const r = checkFolders([f("A/홍길동.hwp".normalize("NFD")), f("A/김철수.hwp"), f("A/홍길동.pdf"), f("A/김철수.pdf")]);
    expect(r.cases.every((c) => c.ok)).toBe(true);
  });

  it("31건이면 아무것도 처리하지 않고 안내", () => {
    const entries = Array.from({ length: 31 }, (_, i) => [f(`c${i}/a.hwp`), f(`c${i}/a.pdf`)]).flat();
    const r = checkFolders(entries);
    expect(r.cases).toEqual([]);
    expect(r.blockingError).toContain("30건");
  });

  it("30건은 한글 파일 수로 센다 (한 폴더에 여러 건)", () => {
    const entries = Array.from({ length: 31 }, (_, i) => [f(`A/건${i}번.hwp`), f(`A/건${i}번.pdf`)]).flat();
    expect(checkFolders(entries).blockingError).toContain("30건");
  });

  it("30건까지는 받는다", () => {
    const entries = Array.from({ length: 30 }, (_, i) => [f(`c${i}/a.hwp`), f(`c${i}/a.pdf`)]).flat();
    expect(checkFolders(entries).cases).toHaveLength(30);
  });

  it("확장자 대소문자는 구분하지 않는다", () => {
    expect(checkFolders([f("A/a.HWP"), f("A/a.Pdf")]).cases[0].ok).toBe(true);
  });
});
