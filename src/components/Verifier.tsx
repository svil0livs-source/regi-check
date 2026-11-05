"use client";
// Design Ref: DESIGN.md §3 — 화면 3개(업로드 → 요약 → 상세)를 한 페이지에서 바꿔 가며 보여 준다. (PLAN 12~15번)
// 디자인: 검은 바탕 + 움직이는 액체 영상 + 유리 패널 (사용자 제공 "Cinematic Liquid Glass" 문서, 2026-11-05)

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import BackgroundVideo from "@/components/BackgroundVideo";
import Hero from "@/components/Hero";
import InfoModal, { type InfoTopic } from "@/components/InfoModal";
import Navbar, { type NavLink } from "@/components/Navbar";
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
  all_match: "bg-emerald-400/10 text-emerald-200 ring-emerald-300/30",
  mismatch_found: "bg-red-400/10 text-red-200 ring-red-300/30",
  needs_review: "bg-amber-300/10 text-amber-100 ring-amber-200/30",
  file_problem: "bg-white/5 text-white/70 ring-white/20",
  processing_failed: "bg-white/5 text-white/70 ring-white/20",
};
const SUMMARY_MARK: Record<CaseSummary, string> = {
  all_match: "●",
  mismatch_found: "✕",
  needs_review: "?",
  file_problem: "–",
  processing_failed: "!",
};
const STATUS_STYLE: Record<FieldStatus, string> = {
  match: "text-emerald-300",
  mismatch: "text-red-300 font-semibold",
  needs_review: "text-amber-200 font-semibold",
  unreadable: "text-white/60 font-semibold",
};
const STATUS_ORDER: Record<FieldStatus, number> = { mismatch: 0, needs_review: 1, unreadable: 2, match: 3 };

const signatureOf = (hwp?: File, pdf?: File) =>
  hwp && pdf ? `${hwp.size}:${hwp.lastModified}|${pdf.size}:${pdf.lastModified}` : "";

const NAV_LINKS: NavLink[] = [
  { id: "rules", label: "검증 기준" },
  { id: "privacy", label: "개인정보" },
];

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
  const [info, setInfo] = useState<InfoTopic | null>(null);
  const closeInfo = useCallback(() => setInfo(null), []);
  const showHero = rows.length === 0;
  const hasWork = rows.length > 0 || stored.size > 0;

  return (
    <main
      className={`relative flex flex-col bg-black selection:bg-white selection:text-black ${showHero ? "h-screen overflow-hidden" : "min-h-screen"}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={async (e) => {
        e.preventDefault();
        setDragging(false);
        await accept(await fromDataTransfer(e.dataTransfer));
      }}
    >
      <BackgroundVideo />
      {/* 폴더를 끌고 오면 화면 전체에 놓을 자리를 보여 준다 */}
      {dragging && (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-4 z-40 flex items-center justify-center rounded-3xl border-2 border-dashed border-white/70 bg-white/10 backdrop-blur-sm"
        >
          <p className="font-serif text-3xl text-white [text-shadow:0_1px_14px_rgba(0,0,0,0.75)]">여기에 폴더를 놓으세요</p>
        </div>
      )}
      <input ref={inputRef} type="file" multiple hidden onChange={(e) => accept(fromFileList(e.target.files))} />

      <Navbar
        links={NAV_LINKS}
        onLink={(id) => setInfo(id as InfoTopic)}
        action={hasWork ? { label: "새 검증 시작", onClick: reset } : null}
      />

      {showHero ? (
        <Hero
          dragging={dragging}
          storedCount={stored.size}
          blocking={blocking}
          onPick={() => inputRef.current?.click()}
          onInfo={() => setInfo("rules")}
        />
      ) : (
        <div className="relative z-10 mx-auto w-full max-w-5xl flex-1 px-4 pb-16 sm:px-6">
          {blocking && (
            <p role="alert" className="mb-4 rounded-2xl border border-red-300/30 bg-red-400/10 px-4 py-3 text-sm text-red-100">
              {blocking}
            </p>
          )}

          {!detailRow ? (
            <section aria-label="건별 결과" className="glass-panel liquid-glass rounded-3xl p-5 sm:p-8">
              <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-white/60">검증 결과</p>
                  <h1 className="mt-2 font-serif text-3xl font-normal leading-tight text-white sm:text-4xl">
                    {running ? "읽고 대조하는 중" : counts.waiting > 0 ? "검증할 준비가 됐습니다" : "검증이 끝났습니다"}
                  </h1>
                  <p className="mt-2 text-sm text-white/60">
                    <b className="font-semibold text-white">{counts.done}</b> / {counts.total}건 완료
                    {running && " · 한 건에 30초 안팎 걸립니다. 정확도를 위해 여러 번 읽습니다."}
                  </p>
                </div>
                <button
                  onClick={run}
                  disabled={running || counts.waiting === 0}
                  className="glass-pill border border-white/20 px-8 py-3 text-sm font-medium text-white transition-colors hover:border-white/50 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  검증하기
                </button>
              </div>

              <div className="overflow-x-auto rounded-2xl ring-1 ring-white/10">
                <table className="w-full text-left text-sm">
                  <thead className="bg-white/5 text-white/60">
                    <tr>
                      <th scope="col" className="px-4 py-3 font-medium">폴더 이름</th>
                      <th scope="col" className="px-4 py-3 font-medium">결과</th>
                      <th scope="col" className="px-4 py-3 font-medium">안내</th>
                      <th scope="col" className="px-4 py-3"><span className="sr-only">자세히</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {rows.map((r) => {
                      const s = r.outcome?.summary;
                      const canOpen = s === "mismatch_found" || s === "needs_review";
                      return (
                        <tr key={r.check.dir} className="transition-colors hover:bg-white/[0.03]">
                          <td className="px-4 py-3 font-mono text-white">{r.check.folder}</td>
                          <td className="px-4 py-3">
                            {r.state === "waiting" && <span className="text-white/50">대기</span>}
                            {r.state === "running" && <span className="animate-pulse text-violet-200">읽는 중…</span>}
                            {r.state === "done" && s && <Badge summary={s} />}
                          </td>
                          <td className="px-4 py-3 text-white/60">
                            {r.outcome?.error}
                            {r.resumed && <span className="text-white/45">이전 결과 이어 씀</span>}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {canOpen && (
                              <button onClick={() => setDetail(r.check.dir)} className="rounded text-sm font-medium text-violet-200 hover:text-white hover:underline">
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
          ) : (
            detailRow.outcome && <Detail outcome={detailRow.outcome} onBack={() => setDetail(null)} />
          )}
        </div>
      )}

      <InfoModal topic={info} onClose={closeInfo} />
    </main>
  );
}

function Detail({ outcome, onBack }: { outcome: CaseOutcome; onBack: () => void }) {
  const counts = new Map<string, number>();
  for (const r of outcome.results) counts.set(r.key, (counts.get(r.key) ?? 0) + 1);
  const label = (r: FieldResult) =>
    FIELD_KEY_LABELS[r.key] + ((counts.get(r.key) ?? 0) > 1 && r.index ? ` ${r.index}` : "");
  const sorted = [...outcome.results].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
  const show = (v: string | null, r: FieldResult) => (v === null ? <span className="text-white/40">{r.reason?.includes("없음") ? "없음" : "읽지 못함"}</span> : v === "" ? <span className="text-white/40">(빈칸)</span> : v);

  return (
    <section aria-label="상세 결과" className="glass-panel liquid-glass rounded-3xl p-5 sm:p-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-mono text-lg font-semibold text-white">{outcome.folder}</h2>
          <Badge summary={outcome.summary} />
        </div>
        <button
          onClick={onBack}
          className="glass-pill flex items-center gap-2 border border-white/15 px-5 py-2 text-sm text-white/90 transition-colors hover:border-white/40"
        >
          <ArrowLeft size={15} aria-hidden /> 목록으로
        </button>
      </div>
      <div className="overflow-x-auto rounded-2xl ring-1 ring-white/10">
        <table className="w-full text-left text-sm">
          <thead className="bg-white/5 text-white/60">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">항목</th>
              <th scope="col" className="px-4 py-3 font-medium">한글 서류</th>
              <th scope="col" className="px-4 py-3 font-medium">등기부등본 (정답)</th>
              <th scope="col" className="px-4 py-3 font-medium">상태</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {sorted.map((r, i) => (
              <tr key={`${r.key}-${r.index ?? 0}-${i}`} className={r.status === "match" ? "" : "bg-white/[0.04]"}>
                <td className="whitespace-nowrap px-4 py-3 text-white/70">{label(r)}</td>
                <td className="px-4 py-3 text-white">{show(r.hwpValue, r)}</td>
                <td className="px-4 py-3 text-white">{show(r.registryValue, r)}</td>
                <td className={`whitespace-nowrap px-4 py-3 ${STATUS_STYLE[r.status]}`}>
                  {FIELD_STATUS_LABELS[r.status]}
                  {r.reason && r.status !== "match" && <div className="mt-0.5 whitespace-normal text-xs font-normal text-white/50">{r.reason}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
