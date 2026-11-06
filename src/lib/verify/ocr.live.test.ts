// 실제 글자 읽기(기본 Tesseract, OCR_ENGINE=openai면 OpenAI)로 시험용 가짜 서류를 끝까지 대조해 정답표와 비교한다. (PLAN 17번)
// 몇 분 걸리는 시험이라(OpenAI면 비용도 듦) 평소(npm test)에는 건너뛴다.
// 실행: RUN_OCR=1 npx vitest run src/lib/verify/ocr.live.test.ts
//       특정 건만: RUN_OCR=1 OCR_CASES=2026-0001,2026-0007 npx vitest run src/lib/verify/ocr.live.test.ts
//       줄여 보낸 사진으로: RUN_OCR=1 OCR_SHRINK=0.75 npx vitest run src/lib/verify/ocr.live.test.ts
//         (2026-11-06) 브라우저가 큰 등기부를 회색조 JPEG로 다시 저장해 보내는 경우를 흉내 낸다. 값은 JPEG 화질(가장 낮은 0.75 권장).
// 결과 요약은 tests/fixtures-build/ocr-report.json 에 남긴다 (커밋 안 함). 서류 내용은 로그에 찍지 않는다.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { summarizeCase } from "@/lib/compare/summarize";
import { extractHwpFields } from "@/lib/readers/hwpFields";
import { readHangulParagraphs } from "@/lib/readers/hangulFile";
import { selectPageImages, type PageImageObject } from "@/lib/readers/pdfPages";
import { combineReads, readRegistryPass, type PassCarry } from "@/lib/readers/registryRead";
import type { RegistryRead } from "@/lib/readers/registryOcr";
import { grayJpegDict } from "@/lib/upload/fitImages";
import sharp from "sharp";
import { verifyCase } from "./verifyCase";

const root = process.cwd();

// .env 값을 읽어 둔다 (값은 출력하지 않는다)
const envPath = join(root, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const answerPath = join(root, "tests", "fixtures", "정답표.json");
type Answer = { folder: string; expected: "전부 일치" | "불일치 있음"; errors: { key: string; desc?: string }[] };
const answers: Answer[] = existsSync(answerPath) ? JSON.parse(readFileSync(answerPath, "utf8")) : [];
const only = process.env.OCR_CASES?.split(",").map((s) => s.trim());
const selected = answers.filter((a) => !only || only.includes(a.folder));

const run = process.env.RUN_OCR === "1" && selected.length > 0;

/** 브라우저처럼 페이지 사진을 꺼낸다. OCR_SHRINK면 회색조 JPEG로 다시 저장한 것을 흉내 낸다 */
const shrinkQuality = Number(process.env.OCR_SHRINK) || 0;
async function pageImages(pdf: Buffer): Promise<PageImageObject[]> {
  const images: PageImageObject[] = [];
  for (const o of selectPageImages(pdf)) {
    if (!shrinkQuality || !/\/Filter\s*\/DCTDecode/.test(o.dict)) {
      images.push(o);
      continue;
    }
    const { data, info } = await sharp(o.data).greyscale().jpeg({ quality: Math.round(shrinkQuality * 100) }).toBuffer({ resolveWithObject: true });
    images.push({ page: o.page, dict: grayJpegDict(info.width, info.height), data });
  }
  return images;
}

/** 배포본과 같은 방법으로 읽는다: 읽기 설정마다 한 번씩(중간에 멈추면 이어서) 읽고 다수결 (2026-11-06) */
async function readLikeApp(images: PageImageObject[]): Promise<RegistryRead> {
  const reads: RegistryRead[] = [];
  let total = 1;
  for (let pass = 0; pass < total; pass++) {
    let carry: PassCarry | null = null;
    let rest = images;
    for (;;) {
      const r = await readRegistryPass(rest, pass, undefined, { carry, last: true });
      if (r.done) {
        reads.push(r.read);
        total = r.total;
        break;
      }
      carry = r.carry;
      rest = rest.filter((o) => r.nextPage !== undefined && o.page >= r.nextPage);
    }
  }
  return combineReads(reads);
}

/** 건 폴더의 한글 파일 (.hwp·.hwpx·.hml) */
const hangulIn = (dir: string) => readdirSync(dir).find((f) => /\.(hwp|hwpx|hml)$/i.test(f));

describe.skipIf(!run)("실제 글자 읽기로 시험용 서류 대조", () => {
  it(
    "정답표와 비교",
    async () => {
      const report: { folder: string; expected: string; got: string; ok: boolean; problems: string[] }[] = [];
      const queue = [...selected];
      const worker = async () => {
        for (let a = queue.shift(); a; a = queue.shift()) {
          const dir = join(root, "tests", "fixtures", a.folder);
          const hwp = extractHwpFields(readHangulParagraphs(readFileSync(join(dir, hangulIn(dir) ?? "없음"))));
          let got = "처리 실패";
          const problems: string[] = [];
          try {
            const pdf = readFileSync(join(dir, "등기사항전부증명서.pdf"));
            const reg = await readLikeApp(await pageImages(pdf));
            const results = verifyCase(hwp, reg);
            const s = summarizeCase(results);
            got = { all_match: "전부 일치", mismatch_found: "불일치 있음", needs_review: "확인 필요" }[s as "all_match"] ?? s;
            for (const r of results) {
              if (r.status === "match") continue;
              const planted = a.errors.some((e) => e.key === r.key);
              // 접수번호가 틀리면 그 근저당권을 못 찾으므로 접수일·순위 등이 함께 「확인 필요」가 되는 것은 오탐이 아니다
              const follows = a.errors.some((e) => e.key === "receiptNumber");
              // 서류 내용은 남기지 않고 항목 이름·상태만 남긴다
              if (!planted && !follows) problems.push(`오탐 항목: ${r.key}(${r.status})`);
            }
            for (const e of a.errors) {
              if (!results.some((r) => r.key === e.key && r.status !== "match")) problems.push(`놓침: ${e.key}`);
            }
          } catch (err) {
            problems.push(`처리 실패: ${(err as Error).message}`);
          }
          const ok = problems.length === 0;
          report.push({ folder: a.folder, expected: a.expected, got, ok, problems });
        }
      };
      await Promise.all(process.env.OCR_ENGINE === "openai" ? [worker(), worker(), worker(), worker()] : [worker()]);
      report.sort((x, y) => x.folder.localeCompare(y.folder));

      const missed = report.filter((r) => r.problems.some((p) => p.startsWith("놓침"))).length;
      const falsePos = report.filter((r) => r.expected === "전부 일치" && r.got !== "전부 일치").length;
      const summary = { 건수: report.length, 놓친_건: missed, 오탐_건: falsePos, report };
      mkdirSync(join(root, "tests", "fixtures-build"), { recursive: true });
      writeFileSync(join(root, "tests", "fixtures-build", "ocr-report.json"), JSON.stringify(summary, null, 2), "utf8");
      console.log(`대조 ${report.length}건: 놓친 건 ${missed}, 오탐 건 ${falsePos}`);
      for (const r of report) console.log(`${r.ok ? "OK " : "XX "} ${r.folder} 기대=${r.expected} 결과=${r.got} ${r.problems.join("; ")}`);

      // PRD 성공 기준: 놓침 0건, 오탐 2건 이하
      expect(missed).toBe(0);
      expect(falsePos).toBeLessThanOrEqual(2);
    },
    120 * 60 * 1000,
  );
});
