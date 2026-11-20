"use client";
// 비용 청구 검증 화면 (2026-11-20 사용자 지시서): 법무사 비용 청구서 PDF 1개 + 영수증 전체 스캔 PDF 1개를 올려
// 모든 페이지를 읽고, 청구 항목과 영수증 금액을 항목 종류별로 대조한다. 근이전 검증과 상태·코드를 함께 쓰지 않는다.
// 파일과 읽은 값은 이 브라우저 메모리에만 있고, 스캔 페이지 사진만 서버(/api/cost/read)에 보내 글자를 읽는다.
import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, X } from "lucide-react";
import ChamferButton from "@/components/ChamferButton";
import { isTextPage, openPdf, pageTextLines, renderForOcr, renderPreview, type PdfDoc } from "@/lib/cost/browserPdf";
import { compareCosts } from "@/lib/cost/compare";
import { CATEGORY_LABELS, mergeClaimPages, parseClaimLines, parseReceiptPage } from "@/lib/cost/parse";
import { filters, selectPageImages } from "@/lib/readers/pdfPages";
import type { ParseLine } from "@/lib/readers/registryParse";
import { COST_STATUS_LABELS, type ClaimRead, type CostResult, type CostStatus, type PageRead, type Receipt } from "@/lib/cost/types";

type Kind = "claim" | "receipt";
/** scans: 페이지(1부터)마다 스캔 원본 JPEG (사진 한 장짜리 페이지만). 있으면 다시 그리지 않고 원본을 보낸다(다시 그리면 글자가 흐려짐) */
type Loaded = { file: File; doc: PdfDoc; pages: number; thumbs: string[]; scans: Map<number, Blob> };

/** 페이지에 사진이 한 장뿐이고 JPEG 하나로만 압축됐으면 그 원본 (요청 한도 안일 때만) */
function scanJpegs(bytes: Uint8Array): Map<number, Blob> {
  const out = new Map<number, Blob>();
  let images;
  try {
    images = selectPageImages(bytes);
  } catch {
    return out;
  }
  const byPage = new Map<number, typeof images>();
  for (const im of images) byPage.set(im.page, [...(byPage.get(im.page) ?? []), im]);
  for (const [page, list] of byPage) {
    const f = filters(list[0].dict);
    if (list.length === 1 && f.length === 1 && f[0] === "DCTDecode" && list[0].data.byteLength <= 3_800_000) {
      out.set(page + 1, new Blob([list[0].data.slice()], { type: "image/jpeg" }));
    }
  }
  return out;
}

const KIND_LABEL: Record<Kind, string> = { claim: "비용 청구서", receipt: "영수증" };
const won = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n.toLocaleString("ko-KR")}원`);
const signed = (n: number | null) => (n === null ? "—" : n === 0 ? "0원" : `${n > 0 ? "+" : "−"}${Math.abs(n).toLocaleString("ko-KR")}원`);

const STATUS_STYLE: Record<CostStatus, string> = {
  match: "text-emerald-800",
  mismatch: "text-red-700 font-semibold",
  missing: "text-red-700 font-semibold",
  needs_review: "text-amber-800 font-semibold",
};
const SUMMARY_STYLE: Record<CostResult["summary"], string> = {
  "전부 일치": "bg-emerald-600/10 text-emerald-800 ring-emerald-700/30",
  "불일치 있음": "bg-red-600/10 text-red-800 ring-red-700/30",
  "확인 필요": "bg-amber-500/15 text-amber-900 ring-amber-700/35",
};

/** 미리보기 작은 그림은 앞에서 이만큼만 그린다 (나머지는 「N쪽 더」) */
const THUMB_MAX = 24;

async function postPage(kind: Kind, page: number, image: Blob, signal: AbortSignal): Promise<{ claim?: ClaimRead; receipts?: Receipt[] }> {
  const form = new FormData();
  form.set("kind", kind);
  form.set("page", String(page));
  form.set("image", image, `page-${page}.jpg`);
  const res = await fetch("/api/cost/read", { method: "POST", body: form, signal });
  const body = (await res.json().catch(() => null)) as { error?: string; claim?: ClaimRead; receipts?: Receipt[] } | null;
  if (!res.ok || !body) throw new Error(body?.error ?? `서버 오류 (${res.status})`);
  return body;
}

export default function CostVerifier() {
  const [files, setFiles] = useState<Partial<Record<Kind, Loaded>>>({});
  const [fileError, setFileError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ kind: Kind; page: number; pages: number; how: "text" | "ocr" } | null>(null);
  const [claim, setClaim] = useState<ClaimRead | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [result, setResult] = useState<CostResult | null>(null);
  const [viewer, setViewer] = useState<{ kind: Kind; page: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const filesRef = useRef(files);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  // 화면을 떠나면 그려 둔 그림을 버린다
  useEffect(
    () => () => {
      abortRef.current?.abort();
      for (const f of Object.values(filesRef.current)) f?.thumbs.forEach((u) => URL.revokeObjectURL(u));
    },
    [],
  );

  async function pick(kind: Kind, file: File | undefined) {
    if (!file || running) return;
    setFileError(null);
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
      setFileError(`${KIND_LABEL[kind]}는 PDF 파일만 올릴 수 있습니다. (${file.name})`);
      return;
    }
    let doc: PdfDoc;
    try {
      doc = await openPdf(file);
    } catch {
      setFileError(`${file.name}을(를) PDF로 열지 못했습니다. 암호가 걸렸거나 손상된 파일인지 확인해 주세요.`);
      return;
    }
    const old = files[kind];
    old?.thumbs.forEach((u) => URL.revokeObjectURL(u));
    void old?.doc.destroy();
    setResult(null);
    const loaded: Loaded = { file, doc, pages: doc.numPages, thumbs: [], scans: scanJpegs(new Uint8Array(await file.arrayBuffer())) };
    setFiles((f) => ({ ...f, [kind]: loaded }));
    // 미리보기 그림은 하나씩 그려 붙인다
    for (let n = 1; n <= Math.min(doc.numPages, THUMB_MAX); n++) {
      try {
        const url = await renderPreview(doc, n, 180);
        loaded.thumbs.push(url);
        // 그 사이 다른 파일로 바꿨으면 붙이지 않는다 (같은 PDF인지는 doc으로 본다)
        setFiles((f) => (f[kind]?.doc === doc ? { ...f, [kind]: { ...loaded, thumbs: [...loaded.thumbs] } } : f));
      } catch {
        break;
      }
      // 다른 파일로 바뀌었으면 그만 그린다
      if (filesRef.current[kind] && filesRef.current[kind]?.doc !== doc) break;
    }
  }

  async function run() {
    const c = files.claim;
    const r = files.receipt;
    if (!c || !r || running) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRunning(true);
    setResult(null);
    setClaim(null);
    setReceipts([]);
    const pageReads: Record<Kind, PageRead[]> = { claim: [], receipt: [] };
    const claimReads: ClaimRead[] = [];
    const allReceipts: Receipt[] = [];
    try {
      for (const [kind, loaded] of [["claim", c], ["receipt", r]] as const) {
        for (let n = 1; n <= loaded.pages; n++) {
          if (ctrl.signal.aborted) throw new DOMException("취소", "AbortError");
          let lines: ParseLine[];
          try {
            lines = await pageTextLines(loaded.doc, n);
          } catch {
            lines = [];
          }
          const text = isTextPage(lines);
          setProgress({ kind, page: n, pages: loaded.pages, how: text ? "text" : "ocr" });
          if (text) {
            let found: number;
            if (kind === "claim") {
              const read = parseClaimLines(lines, n);
              claimReads.push(read);
              found = read.items.length;
            } else {
              const got = parseReceiptPage(lines, n).filter((x) => x.items.length > 0 || x.notes.length > 0);
              allReceipts.push(...got);
              found = got.filter((x) => x.items.length > 0).length;
            }
            pageReads[kind].push({ page: n, source: "text", found });
            continue;
          }
          // 스캔 페이지: 서버에서 글자 읽기 (한 번 실패하면 한 번 더)
          let error: string | undefined;
          let found = 0;
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const image = loaded.scans.get(n) ?? (await renderForOcr(loaded.doc, n));
              const body = await postPage(kind, n, image, ctrl.signal);
              if (kind === "claim" && body.claim) {
                claimReads.push(body.claim);
                found = body.claim.items.length;
              }
              if (kind === "receipt" && body.receipts) {
                allReceipts.push(...body.receipts);
                found = body.receipts.filter((x) => x.items.length > 0).length;
              }
              error = undefined;
              break;
            } catch (err) {
              if (ctrl.signal.aborted) throw err;
              error = err instanceof Error ? err.message : "읽기 실패";
            }
          }
          pageReads[kind].push({ page: n, source: "ocr", found, ...(error ? { error } : {}) });
        }
      }
      const claimRead = mergeClaimPages(claimReads);
      setClaim(claimRead);
      setReceipts(allReceipts);
      setResult(compareCosts(claimRead, allReceipts, { claim: pageReads.claim, receipts: pageReads.receipt }));
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) setFileError("검증 중 오류가 났습니다. 다시 시도해 주세요.");
    } finally {
      setRunning(false);
      setProgress(null);
      abortRef.current = null;
    }
  }

  function resetAll() {
    abortRef.current?.abort();
    for (const f of Object.values(files)) {
      f?.thumbs.forEach((u) => URL.revokeObjectURL(u));
      void f?.doc.destroy();
    }
    setFiles({});
    setResult(null);
    setClaim(null);
    setReceipts([]);
    setFileError(null);
  }

  function openOriginal(kind: Kind) {
    const f = files[kind];
    if (!f) return;
    const url = URL.createObjectURL(f.file);
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  const ready = !!files.claim && !!files.receipt;

  return (
    <div className="relative z-10 mx-auto w-full max-w-5xl flex-1 px-4 pb-16 pt-2 sm:px-6 md:px-12">
      <section aria-label="비용 청구 검증" className="panel p-5 sm:p-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">비용 검증시스템</p>
            <h1 className="display mt-2 text-3xl sm:text-4xl">비용 청구 검증</h1>
            <p className="mt-2 max-w-xl break-keep text-sm text-black/60">
              법무사 비용 청구서 PDF와 영수증 전체 스캔 PDF를 올리면 모든 페이지를 읽어 항목별 청구금액과 영수증 금액을 대조합니다. 법무사 보수는 영수증과 대조하지 않고 따로 보여 줍니다.
            </p>
          </div>
          {(ready || result) && !running && (
            <ChamferButton small onClick={resetAll}>
              새로 올리기
            </ChamferButton>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {(["claim", "receipt"] as const).map((kind, i) => (
            <FileSlot
              key={kind}
              step={i + 1}
              title={kind === "claim" ? "법무사 비용 청구서 PDF" : "영수증 전체 스캔 PDF"}
              hint={kind === "claim" ? "청구서 1개 (여러 쪽이어도 됩니다)" : "여러 장의 영수증을 한 PDF로 스캔한 파일 1개"}
              loaded={files[kind]}
              disabled={running}
              onPick={(f) => pick(kind, f)}
              onView={(page) => setViewer({ kind, page })}
            />
          ))}
        </div>

        {fileError && (
          <p role="alert" className="mt-4 break-keep border-l-2 border-red-700 bg-white/70 px-4 py-3 text-sm text-red-800">
            {fileError}
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-4">
          {running ? (
            <ChamferButton small onClick={() => abortRef.current?.abort()}>
              멈추기
            </ChamferButton>
          ) : (
            <ChamferButton onClick={run} disabled={!ready}>
              {result ? "다시 검증" : "검증 시작"}
            </ChamferButton>
          )}
          {progress && (
            <p role="status" className="break-keep text-sm text-black/70">
              {KIND_LABEL[progress.kind]} {progress.page} / {progress.pages}쪽 {progress.how === "text" ? "글자 바로 읽는 중" : "스캔 글자 읽는 중 (한 쪽에 30초~1분, 정확도를 위해 세 번 읽습니다)"}
            </p>
          )}
          {!ready && !running && <p className="text-sm text-black/50">두 파일을 모두 올리면 시작할 수 있습니다.</p>}
        </div>
      </section>

      {result && claim && (
        <Results
          result={result}
          claim={claim}
          receipts={receipts}
          onView={(kind, page) => setViewer({ kind, page })}
          onOriginal={openOriginal}
        />
      )}

      {viewer && files[viewer.kind] && (
        <PageViewer
          kind={viewer.kind}
          loaded={files[viewer.kind]!}
          page={viewer.page}
          receipts={viewer.kind === "receipt" ? receipts.filter((r) => r.page === viewer.page) : []}
          claim={viewer.kind === "claim" && claim ? claim.items.filter((i) => i.page === viewer.page) : []}
          onPage={(page) => setViewer({ ...viewer, page })}
          onClose={() => setViewer(null)}
        />
      )}
    </div>
  );
}

function FileSlot({
  step,
  title,
  hint,
  loaded,
  disabled,
  onPick,
  onView,
}: {
  step: number;
  title: string;
  hint: string;
  loaded?: Loaded;
  disabled: boolean;
  onPick: (f: File | undefined) => void;
  onView: (page: number) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      className={`border bg-white/50 p-4 transition-colors ${over ? "border-black" : "border-black/15"}`}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        if (!disabled) onPick(e.dataTransfer.files[0]);
      }}
    >
      <p className="text-xs text-black/50">{`STEP ${step}`}</p>
      <h2 className="mt-1 text-base font-semibold">{title}</h2>
      <p className="mt-1 break-keep text-xs text-black/60">{hint}</p>
      <input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => (onPick(e.target.files?.[0]), (e.target.value = ""))} />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          disabled={disabled}
          onClick={() => input.current?.click()}
          className="border border-black px-3 py-1.5 text-sm transition-opacity duration-300 hover:opacity-60 disabled:opacity-40"
        >
          {loaded ? "다른 파일" : "PDF 선택"}
        </button>
        {loaded ? (
          <span className="flex min-w-0 items-center gap-1.5 text-sm">
            <FileText size={16} strokeWidth={1.5} aria-hidden className="shrink-0" />
            <span className="truncate font-medium" title={loaded.file.name}>
              {loaded.file.name}
            </span>
            <span className="shrink-0 text-black/50">· {loaded.pages}쪽</span>
          </span>
        ) : (
          <span className="text-sm text-black/40">또는 여기에 끌어다 놓기</span>
        )}
      </div>
      {loaded && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label={`${title} 미리보기`}>
          {loaded.thumbs.map((url, i) => (
            <button key={url} onClick={() => onView(i + 1)} className="shrink-0 border border-black/15 bg-white transition-opacity hover:opacity-70" title={`${i + 1}쪽 크게 보기`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- 브라우저에서 그린 그림(object URL) */}
              <img src={url} alt={`${i + 1}쪽`} className="h-24 w-auto" />
              <span className="block py-0.5 text-center text-[11px] text-black/60">{i + 1}쪽</span>
            </button>
          ))}
          {loaded.pages > loaded.thumbs.length && loaded.thumbs.length >= THUMB_MAX && (
            <span className="self-center whitespace-nowrap px-2 text-xs text-black/50">외 {loaded.pages - loaded.thumbs.length}쪽</span>
          )}
        </div>
      )}
    </div>
  );
}

function PageLink({ page, onClick }: { page: number; onClick: () => void }) {
  return (
    <button onClick={onClick} className="whitespace-nowrap rounded text-sm text-black underline underline-offset-4 transition-opacity duration-300 hover:opacity-60">
      PDF {page}쪽
    </button>
  );
}

function Results({
  result,
  claim,
  receipts,
  onView,
  onOriginal,
}: {
  result: CostResult;
  claim: ClaimRead;
  receipts: Receipt[];
  onView: (kind: Kind, page: number) => void;
  onOriginal: (kind: Kind) => void;
}) {
  const t = result.totals;
  const stats: [string, string, boolean][] = [
    ["총 청구금액", won(t.claimedTotal), false],
    ["실비 청구액 (보수 제외)", won(t.claimedExpenses), false],
    ["총 증빙금액", won(t.evidencedTotal), false],
    ["금액 차이 (실비 − 증빙)", signed(t.diff), t.diff !== 0],
  ];
  return (
    <section aria-label="비용 검증 결과" className="panel mt-6 p-5 sm:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="display text-2xl sm:text-3xl">검증 결과</h2>
          <span className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ring-1 ${SUMMARY_STYLE[result.summary]}`}>{result.summary}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => onOriginal("claim")} className="border border-black/30 px-3 py-1.5 text-sm hover:border-black">
            청구서 원본 열기
          </button>
          <button onClick={() => onOriginal("receipt")} className="border border-black/30 px-3 py-1.5 text-sm hover:border-black">
            영수증 원본 열기
          </button>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-px border border-black/10 bg-black/10 sm:grid-cols-4">
        {stats.map(([k, v, alert]) => (
          <div key={k} className={`p-3 ${alert ? "bg-red-50" : "bg-white/70"}`}>
            <dt className="break-keep text-xs text-black/55">{k}</dt>
            <dd className={`mt-1 text-lg font-semibold tabular-nums ${alert ? "text-red-700" : ""}`}>{v}</dd>
          </div>
        ))}
      </dl>
      {!t.claimedTotalFromDoc && <p className="mt-2 text-xs text-black/50">청구서에서 합계 줄을 찾지 못해 총 청구금액은 항목 금액을 더한 값입니다.</p>}
      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {(["match", "mismatch", "missing", "needs_review"] as const).map((s) => (
          <span key={s} className={STATUS_STYLE[s]}>
            {COST_STATUS_LABELS[s]} {result.counts[s]}
          </span>
        ))}
      </p>

      {result.warnings.length > 0 && (
        <ul role="status" className="mt-4 space-y-1 border-l-2 border-amber-700 bg-amber-50/70 px-4 py-3 text-sm text-amber-900">
          {result.warnings.map((w) => (
            <li key={w} className="break-keep">
              {w}
            </li>
          ))}
        </ul>
      )}

      <h3 className="mt-8 text-base font-semibold">항목별 대조 (실비)</h3>
      <div className="mt-2 overflow-x-auto border-y border-black/10">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="text-xs text-black/50">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">항목</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">청구금액</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">증빙금액</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">차이</th>
              <th scope="col" className="px-3 py-2 font-medium">결과</th>
              <th scope="col" className="px-3 py-2 font-medium">영수증</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/10 border-t border-black/10">
            {result.rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-black/50">
                  대조할 실비 항목이 없습니다.
                </td>
              </tr>
            )}
            {result.rows.map((row) => (
              <tr key={row.category + row.label} className={row.status === "match" ? "" : "bg-black/[0.02]"}>
                <td className="px-3 py-2 align-top">
                  <span className="font-medium">{row.label}</span>
                  {row.category !== "other" && row.label !== CATEGORY_LABELS[row.category] && <span className="block text-xs text-black/50">{CATEGORY_LABELS[row.category]}</span>}
                  {row.reasons.length > 0 && <span className="mt-0.5 block break-keep text-xs text-black/60">{row.reasons.join(" · ")}</span>}
                </td>
                <td className="px-3 py-2 text-right align-top tabular-nums">{won(row.claimed)}</td>
                <td className="px-3 py-2 text-right align-top tabular-nums">{won(row.evidenced)}</td>
                <td className={`px-3 py-2 text-right align-top tabular-nums ${row.diff ? "font-semibold text-red-700" : ""}`}>{row.diff === null ? "—" : signed(row.diff)}</td>
                <td className={`px-3 py-2 align-top ${STATUS_STYLE[row.status]}`}>{COST_STATUS_LABELS[row.status]}</td>
                <td className="px-3 py-2 align-top">
                  <span className="flex flex-col items-start gap-1">
                    {row.receipts.length === 0 ? <span className="text-black/40">—</span> : row.receipts.map((x) => <PageLink key={x.id} page={x.page} onClick={() => onView("receipt", x.page)} />)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {result.extraReceipts.length > 0 && (
        <>
          <h3 className="mt-8 text-base font-semibold">청구서에 대응하지 않는 영수증</h3>
          <ul className="mt-2 divide-y divide-black/10 border-y border-black/10 text-sm">
            {result.extraReceipts.map((e, i) => (
              <li key={e.id + i} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span>
                  <span className="font-medium">{e.label || "(이름 없음)"}</span> <span className="tabular-nums">{won(e.amount)}</span>
                  <span className="block text-xs text-amber-800">{e.reason}</span>
                </span>
                <PageLink page={e.page} onClick={() => onView("receipt", e.page)} />
              </li>
            ))}
          </ul>
        </>
      )}

      {result.duplicates.length > 0 && (
        <>
          <h3 className="mt-8 text-base font-semibold">중복 의심 영수증</h3>
          <ul className="mt-2 divide-y divide-black/10 border-y border-black/10 text-sm">
            {result.duplicates.map((d) => (
              <li key={d.ids.join()} className="px-3 py-2 text-amber-900">
                {d.ids.join(", ")} — {d.reason}
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 className="mt-8 text-base font-semibold">법무사 보수 (영수증과 대조하지 않음)</h3>
      {result.feeItems.length === 0 ? (
        <p className="mt-2 text-sm text-black/50">청구서에서 보수 항목을 찾지 못했습니다.</p>
      ) : (
        <ul className="mt-2 divide-y divide-black/10 border-y border-black/10 text-sm">
          {result.feeItems.map((f, i) => (
            <li key={i} className="flex justify-between gap-2 px-3 py-2">
              <span>{f.label}</span>
              <span className={`tabular-nums ${f.amount.uncertain ? "text-amber-800" : ""}`}>
                {won(f.amount.value)}
                {f.amount.uncertain && " (확인 필요)"}
              </span>
            </li>
          ))}
        </ul>
      )}

      <details className="mt-8">
        <summary className="cursor-pointer text-base font-semibold">영수증별 읽은 결과 ({receipts.length}장)</summary>
        <div className="mt-2 overflow-x-auto border-y border-black/10">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs text-black/50">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">페이지</th>
                <th scope="col" className="px-3 py-2 font-medium">발급기관</th>
                <th scope="col" className="px-3 py-2 font-medium">항목</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">납부금액</th>
                <th scope="col" className="px-3 py-2 font-medium">납부일자</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/10 border-t border-black/10">
              {receipts.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2 align-top">
                    <PageLink page={r.page} onClick={() => onView("receipt", r.page)} />
                    <span className="block text-xs text-black/50">{r.id}</span>
                  </td>
                  <td className="px-3 py-2 align-top">{r.issuer ?? <span className="text-black/40">읽지 못함</span>}</td>
                  <td className="px-3 py-2 align-top">
                    {r.items.map((it, i) => (
                      <span key={i} className="block">
                        {it.label}
                      </span>
                    ))}
                    {r.notes.length > 0 && <span className="block text-xs text-amber-800">{r.notes.join(" · ")}</span>}
                  </td>
                  <td className="px-3 py-2 text-right align-top tabular-nums">
                    {r.items.map((it, i) => (
                      <span key={i} className={`block ${it.amount.uncertain ? "font-semibold text-amber-800" : ""}`}>
                        {won(it.amount.value)}
                        {it.amount.uncertain && " ?"}
                      </span>
                    ))}
                  </td>
                  <td className="px-3 py-2 align-top">{r.date ?? <span className="text-black/40">읽지 못함</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <details className="mt-4">
        <summary className="cursor-pointer text-base font-semibold">청구서에서 읽은 항목 ({claim.items.length}개)</summary>
        <ul className="mt-2 divide-y divide-black/10 border-y border-black/10 text-sm">
          {claim.items.map((it, i) => (
            <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span>
                {it.label} <span className="text-xs text-black/50">({CATEGORY_LABELS[it.category]})</span>
              </span>
              <span className="flex items-center gap-3">
                <span className={`whitespace-nowrap tabular-nums ${it.amount.uncertain ? "font-semibold text-amber-800" : ""}`}>
                  {won(it.amount.value)}
                  {it.amount.uncertain && " ?"}
                </span>
                <PageLink page={it.page} onClick={() => onView("claim", it.page)} />
              </span>
            </li>
          ))}
          {claim.total && (
            <li className="flex justify-between gap-2 px-3 py-2 font-semibold">
              <span>합계 (청구서)</span>
              <span className="tabular-nums">{won(claim.total.value)}</span>
            </li>
          )}
        </ul>
      </details>
      <p className="mt-6 break-keep text-xs text-black/50">금액 옆 「?」는 글자 읽기가 불확실해 원본 확인이 필요한 값입니다. 결과는 이 화면에만 있고 저장되지 않습니다.</p>
    </section>
  );
}

function PageViewer({
  kind,
  loaded,
  page,
  receipts,
  claim,
  onPage,
  onClose,
}: {
  kind: Kind;
  loaded: Loaded;
  page: number;
  receipts: Receipt[];
  claim: ClaimRead["items"];
  onPage: (p: number) => void;
  onClose: () => void;
}) {
  const [shown, setShown] = useState<{ page: number; url: string } | null>(null);
  const url = shown?.page === page ? shown.url : null;
  const closeRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    renderPreview(loaded.doc, page, 1100)
      .then((u) => {
        made = u;
        if (alive) setShown({ page, url: u });
        else URL.revokeObjectURL(u);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [loaded.doc, page]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight" && page < loaded.pages) onPage(page + 1);
      if (e.key === "ArrowLeft" && page > 1) onPage(page - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, onPage, page, loaded.pages]);

  return (
    <div role="dialog" aria-modal="true" aria-label={`${KIND_LABEL[kind]} ${page}쪽`} className="fixed inset-0 z-50 flex flex-col bg-black/60 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-2 bg-[#f5f4f0] px-4 py-3 text-sm">
        <span className="min-w-0 truncate">
          <b className="font-semibold">{KIND_LABEL[kind]}</b> · {loaded.file.name} · {page} / {loaded.pages}쪽
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <button disabled={page <= 1} onClick={() => onPage(page - 1)} className="border border-black/30 px-2 py-1 disabled:opacity-30">
            이전
          </button>
          <button disabled={page >= loaded.pages} onClick={() => onPage(page + 1)} className="border border-black/30 px-2 py-1 disabled:opacity-30">
            다음
          </button>
          <button ref={closeRef} onClick={close} className="flex items-center gap-1 border border-black px-2 py-1">
            <X size={14} aria-hidden /> 닫기
          </button>
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="min-h-0 flex-1 overflow-auto p-4" onClick={(e) => e.target === e.currentTarget && close()}>
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element -- 브라우저에서 그린 그림(object URL)
            <img src={url} alt={`${KIND_LABEL[kind]} ${page}쪽`} className="mx-auto w-full max-w-[1100px] bg-white shadow" />
          ) : (
            <p className="py-20 text-center text-white">페이지를 그리는 중…</p>
          )}
        </div>
        <aside className="max-h-[40vh] overflow-auto bg-[#f5f4f0] p-4 text-sm md:max-h-none md:w-72">
          <h2 className="font-semibold">이 페이지에서 읽은 값</h2>
          {kind === "receipt" ? (
            receipts.length === 0 ? (
              <p className="mt-2 text-black/50">읽은 영수증이 없거나 아직 검증하지 않았습니다.</p>
            ) : (
              receipts.map((r) => (
                <div key={r.id} className="mt-3 border-t border-black/10 pt-2">
                  <p className="text-xs text-black/50">{r.id}</p>
                  <p>{r.issuer ?? "발급기관 읽지 못함"}</p>
                  <p className="text-black/60">{r.date ?? "날짜 읽지 못함"}</p>
                  {r.items.map((it, i) => (
                    <p key={i} className="flex justify-between gap-2">
                      <span>{it.label}</span>
                      <span className={`whitespace-nowrap tabular-nums ${it.amount.uncertain ? "font-semibold text-amber-800" : ""}`}>
                        {won(it.amount.value)}
                        {it.amount.uncertain && " ?"}
                      </span>
                    </p>
                  ))}
                  {r.notes.map((n) => (
                    <p key={n} className="text-xs text-amber-800">
                      {n}
                    </p>
                  ))}
                </div>
              ))
            )
          ) : claim.length === 0 ? (
            <p className="mt-2 text-black/50">읽은 항목이 없거나 아직 검증하지 않았습니다.</p>
          ) : (
            claim.map((it, i) => (
              <p key={i} className="mt-1 flex justify-between gap-2">
                <span>{it.label}</span>
                <span className={`whitespace-nowrap tabular-nums ${it.amount.uncertain ? "font-semibold text-amber-800" : ""}`}>{won(it.amount.value)}</span>
              </p>
            ))
          )}
        </aside>
      </div>
    </div>
  );
}
