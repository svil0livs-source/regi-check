"use client";
// Design Ref: DESIGN.md §3 — 화면 3개(업로드 → 요약 → 상세)를 한 페이지에서 바꿔 가며 보여 준다. (PLAN 12~15번)

import { useEffect, useMemo, useRef, useState } from "react";
import { checkFolders, type CaseCheck } from "@/lib/upload/checkFolders";
import { fromDataTransfer, fromFileList, type PickedFile } from "@/lib/upload/collectFiles";
import { clearAll, loadAll, save, type StoredOutcome } from "@/lib/storage/resultStore";
import type { CaseOutcome } from "@/lib/verify/processCase";
import {
  CASE_SUMMARY_LABELS,
  FIELD_KEY_LABELS,
  FIELD_STATUS_LABELS,
  type CaseSummary,
  type FieldResult,
  type FieldStatus,
} from "@/types/verification";

type Row = {
  check: CaseCheck;
  state: "waiting" | "running" | "done";
  outcome?: CaseOutcome;
  resumed?: boolean;
};

const SUMMARY_STYLE: Record<CaseSummary, string> = {
  all_match: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  mismatch_found: "bg-red-50 text-red-800 ring-red-200",
  needs_review: "bg-amber-50 text-amber-800 ring-amber-200",
  file_problem: "bg-zinc-100 text-zinc-700 ring-zinc-200",
  processing_failed: "bg-zinc-100 text-zinc-700 ring-zinc-200",
};
const SUMMARY_MARK: Record<CaseSummary, string> = {
  all_match: "●",
  mismatch_found: "✕",
  needs_review: "?",
  file_problem: "–",
  processing_failed: "!",
};
const STATUS_STYLE: Record<FieldStatus, string> = {
  match: "text-emerald-700",
  mismatch: "text-red-700 font-semibold",
  needs_review: "text-amber-700 font-semibold",
  unreadable: "text-zinc-600 font-semibold",
};
const STATUS_ORDER: Record<FieldStatus, number> = { mismatch: 0, needs_review: 1, unreadable: 2, match: 3 };

const signatureOf = (hwp?: File, pdf?: File) =>
  hwp && pdf ? `${hwp.size}:${hwp.lastModified}|${pdf.size}:${pdf.lastModified}` : "";

function Badge({ summary }: { summary: CaseSummary }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-sm ring-1 ${SUMMARY_STYLE[summary]}`}>
      <span aria-hidden>{SUMMARY_MARK[summary]}</span>
      {CASE_SUMMARY_LABELS[summary]}
    </span>
  );
}

export default function Verifier() {
  const [files, setFiles] = useState<Map<string, File>>(new Map());
  const [rows, setRows] = useState<Row[]>([]);
  const [blocking, setBlocking] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const [stored, setStored] = useState<Map<string, StoredOutcome>>(new Map());
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    loadAll().then(setStored);
  }, []);

  // 「폴더 선택」 버튼은 폴더째 고르게 한다 (React 타입에 없는 속성이라 직접 붙인다)
  useEffect(() => {
    inputRef.current?.setAttribute("webkitdirectory", "");
    inputRef.current?.setAttribute("directory", "");
  }, []);

  async function accept(picked: PickedFile[]) {
    if (running) return;
    const map = new Map(picked.map((p) => [p.path, p.file]));
    const result = checkFolders(picked.map((p) => ({ path: p.path, size: p.file.size })));
    setFiles(map);
    setDetail(null);
    setBlocking(result.blockingError ?? null);

    // 이어서 처리: 같은 폴더(이름·파일 크기·수정 시각이 같음)의 끝난 결과는 다시 쓰고, 하나도 안 겹치면 예전 결과는 지운다
    let saved = stored;
    const overlaps = result.cases.some((c) => c.ok && saved.get(c.folder)?.signature === signatureOf(map.get(c.hwpPath!), map.get(c.pdfPath!)));
    if (!overlaps && saved.size > 0) {
      await clearAll();
      saved = new Map();
      setStored(saved);
    }
    setRows(
      result.cases.map((check): Row => {
        if (!check.ok) return { check, state: "done", outcome: { folder: check.folder, summary: "file_problem", results: [], error: check.reasons.join(", ") } };
        const prev = saved.get(check.folder);
        if (prev && prev.signature === signatureOf(map.get(check.hwpPath!), map.get(check.pdfPath!))) {
          return { check, state: "done", outcome: prev.outcome, resumed: true };
        }
        return { check, state: "waiting" };
      }),
    );
  }

  async function run() {
    setRunning(true);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      for (const row of rows) {
        if (ac.signal.aborted) break;
        if (row.state !== "waiting") continue;
        const { folder, hwpPath, pdfPath } = row.check;
        setRows((rs) => rs.map((r) => (r.check.dir === row.check.dir ? { ...r, state: "running" } : r)));

        let outcome: CaseOutcome;
        try {
          const body = new FormData();
          body.set("folder", folder);
          body.set("hwp", files.get(hwpPath!)!);
          body.set("pdf", files.get(pdfPath!)!);
          const res = await fetch("/api/verify", { method: "POST", body, signal: ac.signal });
          const json = await res.json();
          outcome = res.ok ? json : { folder, summary: "processing_failed", results: [], error: json.error ?? `오류 (HTTP ${res.status})` };
        } catch (err) {
          if (ac.signal.aborted) {
            setRows((rs) => rs.map((r) => (r.check.dir === row.check.dir ? { ...r, state: "waiting" } : r)));
            break;
          }
          outcome = { folder, summary: "processing_failed", results: [], error: "서버와 연결이 끊겼습니다. 같은 폴더를 다시 고르면 이어서 처리합니다." };
          void err;
        }

        // 끝난 건은 바로 보관 (창이 닫혀도 이어서 처리할 수 있게). 처리 실패는 다시 시도할 수 있게 보관하지 않는다.
        if (outcome.summary !== "processing_failed") {
          const item = { signature: signatureOf(files.get(hwpPath!), files.get(pdfPath!)), outcome, savedAt: Date.now() };
          await save(folder, item);
          setStored((m) => new Map(m).set(folder, item));
        }
        setRows((rs) => rs.map((r) => (r.check.dir === row.check.dir ? { ...r, state: "done", outcome } : r)));
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  async function reset() {
    abortRef.current?.abort();
    await clearAll();
    setStored(new Map());
    setRows([]);
    setFiles(new Map());
    setBlocking(null);
    setDetail(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  const counts = useMemo(() => {
    const ok = rows.filter((r) => r.check.ok);
    return { total: ok.length, done: ok.filter((r) => r.state === "done").length, waiting: ok.filter((r) => r.state === "waiting").length };
  }, [rows]);

  const detailRow = rows.find((r) => r.check.dir === detail);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">근이전 서류 검증기</h1>
          <p className="mt-1 text-sm text-zinc-600">한글 신청서와 등기부등본을 항목별로 대조합니다. 등기부등본이 정답입니다.</p>
        </div>
        {(rows.length > 0 || stored.size > 0) && (
          <button onClick={reset} className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50">
            새 검증 시작
          </button>
        )}
      </header>

      {stored.size > 0 && rows.length === 0 && (
        <p className="mb-4 rounded-md bg-sky-50 px-4 py-3 text-sm text-sky-900 ring-1 ring-sky-200">
          이전에 끝난 결과 {stored.size}건이 남아 있습니다. 같은 폴더를 다시 고르면 끝난 건은 건너뛰고 이어서 처리합니다.
        </p>
      )}

      {/* 화면 1: 업로드 */}
      {!detailRow && (
        <section
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={async (e) => {
            e.preventDefault();
            setDragging(false);
            await accept(await fromDataTransfer(e.dataTransfer));
          }}
          className={`rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors ${dragging ? "border-sky-500 bg-sky-50" : "border-zinc-300 bg-white"}`}
        >
          <p className="text-zinc-800">건별 폴더들을 여기에 끌어다 놓거나</p>
          <button
            onClick={() => inputRef.current?.click()}
            disabled={running}
            className="mt-3 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
          >
            폴더 선택
          </button>
          <input ref={inputRef} type="file" multiple hidden onChange={(e) => accept(fromFileList(e.target.files))} />
          <p className="mt-3 text-xs text-zinc-500">폴더 하나에 한글(.hwp) 1개 + 등기부등본 PDF 1개 · 한 번에 30건까지 · 파일 20MB 이하</p>
        </section>
      )}

      {blocking && <p className="mt-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-200">{blocking}</p>}

      {/* 화면 2: 요약 */}
      {rows.length > 0 && !detailRow && (
        <section className="mt-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-zinc-700">
              {running ? "처리 중" : "진행"}: <b>{counts.done}</b> / {counts.total}건
              {running && <span className="ml-2 text-zinc-500">(한 건에 1분 안팎 걸릴 수 있습니다. 정확도를 위해 여러 번 읽습니다.)</span>}
            </p>
            <button
              onClick={run}
              disabled={running || counts.waiting === 0}
              className="rounded-md bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              검증하기
            </button>
          </div>
          <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-zinc-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-50 text-zinc-600">
                <tr>
                  <th className="px-4 py-2 font-medium">폴더 이름</th>
                  <th className="px-4 py-2 font-medium">결과</th>
                  <th className="px-4 py-2 font-medium">안내</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.map((r) => {
                  const s = r.outcome?.summary;
                  const canOpen = s === "mismatch_found" || s === "needs_review";
                  return (
                    <tr key={r.check.dir}>
                      <td className="px-4 py-2.5 font-mono text-zinc-900">{r.check.folder}</td>
                      <td className="px-4 py-2.5">
                        {r.state === "waiting" && <span className="text-zinc-500">대기</span>}
                        {r.state === "running" && <span className="animate-pulse text-sky-700">읽는 중…</span>}
                        {r.state === "done" && s && <Badge summary={s} />}
                      </td>
                      <td className="px-4 py-2.5 text-zinc-600">
                        {r.outcome?.error}
                        {r.resumed && <span className="text-zinc-500">이전 결과 이어 씀</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {canOpen && (
                          <button onClick={() => setDetail(r.check.dir)} className="text-sm font-medium text-sky-700 hover:underline">
                            자세히
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 화면 3: 상세 */}
      {detailRow?.outcome && <Detail outcome={detailRow.outcome} onBack={() => setDetail(null)} />}
    </div>
  );
}

function Detail({ outcome, onBack }: { outcome: CaseOutcome; onBack: () => void }) {
  const counts = new Map<string, number>();
  for (const r of outcome.results) counts.set(r.key, (counts.get(r.key) ?? 0) + 1);
  const label = (r: FieldResult) =>
    FIELD_KEY_LABELS[r.key] + ((counts.get(r.key) ?? 0) > 1 && r.index ? ` ${r.index}` : "");
  const sorted = [...outcome.results].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
  const show = (v: string | null, r: FieldResult) => (v === null ? <span className="text-zinc-400">{r.reason?.includes("없음") ? "없음" : "읽지 못함"}</span> : v === "" ? <span className="text-zinc-400">(빈칸)</span> : v);

  return (
    <section className="mt-2">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="font-mono text-lg font-semibold text-zinc-900">{outcome.folder}</h2>
          <Badge summary={outcome.summary} />
        </div>
        <button onClick={onBack} className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50">
          ← 목록으로
        </button>
      </div>
      <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-zinc-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 text-zinc-600">
            <tr>
              <th className="px-4 py-2 font-medium">항목</th>
              <th className="px-4 py-2 font-medium">한글 서류</th>
              <th className="px-4 py-2 font-medium">등기부등본 (정답)</th>
              <th className="px-4 py-2 font-medium">상태</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {sorted.map((r, i) => (
              <tr key={`${r.key}-${r.index ?? 0}-${i}`} className={r.status === "match" ? "" : "bg-zinc-50/60"}>
                <td className="whitespace-nowrap px-4 py-2.5 text-zinc-700">{label(r)}</td>
                <td className="px-4 py-2.5 text-zinc-900">{show(r.hwpValue, r)}</td>
                <td className="px-4 py-2.5 text-zinc-900">{show(r.registryValue, r)}</td>
                <td className={`whitespace-nowrap px-4 py-2.5 ${STATUS_STYLE[r.status]}`}>
                  {FIELD_STATUS_LABELS[r.status]}
                  {r.reason && r.status !== "match" && <div className="mt-0.5 whitespace-normal text-xs font-normal text-zinc-500">{r.reason}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
