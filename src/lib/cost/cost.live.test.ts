// 비용 청구 검증: 시험용 가짜 청구서·영수증(tests/fixtures/cost)을 실제 글자 읽기(서버 안 Tesseract)로 끝까지 대조해 정답표와 비교한다.
// 몇 분 걸려 평소(npm test)에는 건너뛴다. 실행: RUN_OCR=1 npx vitest run src/lib/cost/cost.live.test.ts
// 시험 서류 다시 만들기: node scripts/fixtures/make-cost-fixtures.mjs
// 스캔 페이지는 PDF 안 사진(200dpi)을 그대로 보낸다(브라우저는 같은 크기로 그려서 보낸다). 결과 요약은 tests/fixtures-build/cost-ocr-report.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { selectPageImages } from "@/lib/readers/pdfPages";
import { linesFromPieces, readTextPieces, type PdfJsLike } from "@/lib/readers/pdfText";
import { isTextPage } from "./browserPdf";
import { compareCosts } from "./compare";
import { readClaimImage, readReceiptImage } from "./costOcr";
import { mergeClaimPages, parseClaimLines, parseReceiptPage } from "./parse";
import type { ClaimRead, CostStatus, PageRead, Receipt } from "./types";

const root = process.cwd();
const dir = join(root, "tests", "fixtures", "cost");
// summary가 "전부 일치 아님"이면 「전부 일치」만 아니면 된다(글자 읽기 오류 시험: 흐린 페이지)
type Answer = { folder: string; summary: string; rows?: Record<string, CostStatus>; extra?: number };
const answers: Answer[] = existsSync(join(dir, "정답표.json")) ? JSON.parse(readFileSync(join(dir, "정답표.json"), "utf8")) : [];

async function readDoc(file: string, kind: "claim" | "receipt") {
  const data = new Uint8Array(readFileSync(file));
  const pieces = await readTextPieces(pdfjs as unknown as PdfJsLike, data);
  const images = selectPageImages(data);
  const pages: PageRead[] = [];
  const claims: ClaimRead[] = [];
  const receipts: Receipt[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const n = i + 1;
    const lines = linesFromPieces(pieces[i]);
    if (isTextPage(lines)) {
      let found: number;
      if (kind === "claim") {
        const c = parseClaimLines(lines, n);
        claims.push(c);
        found = c.items.length;
      } else {
        const got = parseReceiptPage(lines, n);
        receipts.push(...got);
        found = got.filter((x) => x.items.length > 0).length;
      }
      pages.push({ page: n, source: "text", found });
      continue;
    }
    const img = images.find((x) => x.page === i);
    if (!img) {
      pages.push({ page: n, source: "ocr", error: "사진 없음" });
      continue;
    }
    const buf = Buffer.from(img.data);
    let found: number;
    if (kind === "claim") {
      const c = await readClaimImage(buf, n);
      claims.push(c);
      found = c.items.length;
    } else {
      const got = await readReceiptImage(buf, n);
      receipts.push(...got);
      found = got.filter((x) => x.items.length > 0).length;
    }
    pages.push({ page: n, source: "ocr", found });
  }
  return { pages, claim: mergeClaimPages(claims), receipts };
}

describe.skipIf(!process.env.RUN_OCR || answers.length === 0)("비용 검증 글자 읽기 시험", () => {
  const report: unknown[] = [];
  for (const a of answers) {
    it(
      a.folder,
      async () => {
        const started = Date.now();
        const c = await readDoc(join(dir, a.folder, "청구서.pdf"), "claim");
        const r = await readDoc(join(dir, a.folder, "영수증.pdf"), "receipt");
        const res = compareCosts(c.claim, r.receipts, { claim: c.pages, receipts: r.pages });
        const rows = Object.fromEntries(res.rows.map((x) => [x.category, x.status]));
        // 금액·항목 이름은 가상 자료라 남겨도 되지만, 실제 서류에 같은 시험을 돌릴 때를 생각해 상태·개수만 남긴다
        report.push({ folder: a.folder, seconds: Math.round((Date.now() - started) / 1000), summary: res.summary, rows, counts: res.counts, extra: res.extraReceipts.length, receipts: r.receipts.length, warnings: res.warnings.length, totals: res.totals });
        mkdirSync(join(root, "tests", "fixtures-build"), { recursive: true });
        writeFileSync(join(root, "tests", "fixtures-build", "cost-ocr-report.json"), JSON.stringify(report, null, 2));
        if (a.summary === "전부 일치 아님") expect(res.summary).not.toBe("전부 일치");
        else expect(res.summary).toBe(a.summary);
        if (a.rows) expect(rows).toEqual(a.rows);
        if (a.extra !== undefined) expect(res.extraReceipts.length).toBe(a.extra);
      },
      15 * 60_000,
    );
  }
});
