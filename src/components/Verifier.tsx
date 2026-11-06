"use client";
// Design Ref: DESIGN.md §3 — 화면 3개(업로드 → 요약 → 상세)를 한 페이지에서 바꿔 가며 보여 준다. (PLAN 12~15번)
// 디자인: 검은 바탕 + 움직이는 액체 영상 + 유리 패널 (사용자 제공 "Cinematic Liquid Glass" 문서, 2026-11-05)

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import BackgroundVideo from "@/components/BackgroundVideo";
import Hero from "@/components/Hero";
import InfoModal, { type InfoTopic } from "@/components/InfoModal";
import Navbar, { type NavLink } from "@/components/Navbar";
import UploadModal from "@/components/UploadModal";
import { checkFolders, type CaseCheck } from "@/lib/upload/checkFolders";
import { fromDataTransfer, fromFileList, type PickedFile } from "@/lib/upload/collectFiles";
import { prepareCase } from "@/lib/upload/prepareCase";
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
  /** 읽는 중일 때 진행 (예: "2/5") */
  progress?: string;
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

/** JSON 응답이 없는 서버 오류의 화면 문구 (다시 시도해도 같은 이유로 실패하는 경우는 그렇게 알린다) */
/** 요청 하나(읽기 한 번)를 기다리는 최대 시간 (서버 한도 300초 + 여유) */
const REQUEST_TIMEOUT_MS = 330_000;

function httpErrorMessage(status: number): string {
  if (status === 413) return "보낼 내용이 너무 커서 서버가 받지 못했습니다. 등기부등본에서 필요한 페이지만 담아 다시 올려 주세요.";
  if (status === 504 || status === 408) return "처리 시간이 한도(300초)를 넘었습니다. 페이지가 많은 등기부는 처리하지 못할 수 있습니다.";
  if (status >= 500) return `서버 오류로 처리하지 못했습니다 (HTTP ${status}). 잠시 뒤 같은 폴더를 다시 고르면 이어서 처리합니다.`;
  return `처리하지 못했습니다 (HTTP ${status}).`;
}

/** 요청 하나를 보내고 JSON을 받는다. 서버 앞단 오류(413·504 등)는 화면 문구로 바꿔 던진다 */
async function post<T>(folder: string, body: FormData, signal: AbortSignal): Promise<T> {
  // 연결이 멈춰도 끝없이 기다리지 않게 요청마다 시간 한도를 둔다 (CHECK 11번)
  const res = await fetch("/api/verify", { method: "POST", body, signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) });
  const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !json) throw new PrepareFailed({ folder, summary: "processing_failed", results: [], error: json?.error ?? httpErrorMessage(res.status) });
  return json;
}

type PassResponse = { ok: true; read: unknown; total: number } | { ok: false; outcome: CaseOutcome };

/**
 * 한 건 처리 (2026-11-06): 서버 한도(요청마다 300초)에 막히지 않도록 등기부 읽기를 한 번씩 따로 요청하고,
 * 모은 결과(대조 항목 값만)를 마지막에 한글 서류 값과 함께 보내 대조한다. 오래 걸려도 끝까지 처리한다.
 */
async function runCase(folder: string, prepared: FormData, signal: AbortSignal, onProgress: (n: number, total: number) => void): Promise<CaseOutcome> {
  const reads: unknown[] = [];
  let total = 1;
  for (let pass = 0; pass < total; pass++) {
    onProgress(pass + 1, pass === 0 ? READ_PASSES_HINT : total);
    const body = new FormData();
    for (const [k, v] of prepared) if (k !== "fields") body.append(k, v);
    body.set("step", "read");
    body.set("pass", String(pass));
    const r = await post<PassResponse>(folder, body, signal);
    if (!r.ok) return r.outcome;
    reads.push(r.read);
    total = r.total;
  }
  const body = new FormData();
  body.set("step", "compare");
  body.set("folder", folder);
  body.set("fields", String(prepared.get("fields")));
  body.set("reads", JSON.stringify(reads));
  return post<CaseOutcome>(folder, body, signal);
}
/** 첫 응답 전 진행 표시에 쓸 읽기 횟수 (Tesseract 기본 5번) */
const READ_PASSES_HINT = 5;

/** 브라우저에서 보낼 준비를 하다 멈춘 건 (서버에 보내지 않고 바로 결과로 쓴다) */
class PrepareFailed extends Error {
  constructor(readonly outcome: CaseOutcome) {
    super("prepare failed");
  }
}

const signatureOf = (hwp?: File, pdf?: File) =>
  hwp && pdf ? `${hwp.size}:${hwp.lastModified}|${pdf.size}:${pdf.lastModified}` : "";

const NAV_LINKS: NavLink[] = [
  { id: "history", label: "이전 결과" },
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
  const [uploadOpen, setUploadOpen] = useState(false);
  /** 「이전 결과」 화면을 보는 중, 그리고 거기서 상세를 연 폴더 이름 */
  const [history, setHistory] = useState(false);
  const [historyDetail, setHistoryDetail] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** 저장된 결과 불러오기 (다 불러오기 전에 폴더를 골라도 끝난 건을 다시 처리하지 않도록 기다릴 때 씀, CHECK 13번) */
  const loadRef = useRef<Promise<Map<string, StoredOutcome>> | null>(null);
  /** 브라우저가 결과 저장을 막을 때(시크릿 창 등) 보여 줄 안내 (CHECK 12번) */
  const [storageWarning, setStorageWarning] = useState(false);

  useEffect(() => {
    loadRef.current = loadAll().then((m) => {
      setStored(m);
      return m;
    });
  }, []);

  // 「폴더 선택」 버튼은 폴더째 고르게 한다 (React 타입에 없는 속성이라 직접 붙인다)
  useEffect(() => {
    inputRef.current?.setAttribute("webkitdirectory", "");
    inputRef.current?.setAttribute("directory", "");
  }, []);

  async function accept(picked: PickedFile[]) {
    if (running) return;
    setUploadOpen(false);
    const loaded = loadRef.current ? await loadRef.current : new Map<string, StoredOutcome>();
    const map = new Map(picked.map((p) => [p.path, p.file]));
    const result = checkFolders(picked.map((p) => ({ path: p.path, size: p.file.size })));
    setFiles(map);
    setDetail(null);
    setBlocking(result.blockingError ?? null);

    // 이어서 처리: 같은 폴더(이름·파일 크기·수정 시각이 같음)의 끝난 결과는 다시 쓴다. 예전 결과는 「이전 결과」 화면에 남겨 둔다.
    const saved = new Map([...loaded, ...stored]);
    setHistory(false);
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
        setRows((rs) => rs.map((r) => (r.check.id === row.check.id ? { ...r, state: "running" } : r)));

        let outcome: CaseOutcome;
        try {
          // 원본 파일 대신 한글 서류 값과 등기부 사진만 보낸다 (파일당 6000KB까지 받기 위해, 2026-11-06)
          const prepared = await prepareCase(folder, files.get(hwpPath!)!, files.get(pdfPath!)!);
          if (!prepared.ok) throw new PrepareFailed({ folder, summary: prepared.summary, results: [], error: prepared.error });
          outcome = await runCase(folder, prepared.body, ac.signal, (n, total) =>
            setRows((rs) => rs.map((r) => (r.check.id === row.check.id ? { ...r, progress: `${n}/${total}` } : r))),
          );
        } catch (err) {
          if (err instanceof PrepareFailed) {
            outcome = err.outcome;
          } else if (ac.signal.aborted) {
            setRows((rs) => rs.map((r) => (r.check.id === row.check.id ? { ...r, state: "waiting" } : r)));
            break;
          } else {
            const timedOut = (err as Error)?.name === "TimeoutError";
            outcome = {
              folder,
              summary: "processing_failed",
              results: [],
              error: timedOut
                ? `읽기 한 번이 ${REQUEST_TIMEOUT_MS / 1000}초 안에 끝나지 않아 멈췄습니다. 같은 폴더를 다시 고르면 이어서 처리합니다.`
                : "서버와 연결이 끊겼습니다. 같은 폴더를 다시 고르면 이어서 처리합니다.",
            };
          }
        }

        // 끝난 건은 바로 보관 (창이 닫혀도 이어서 처리할 수 있게). 처리 실패는 다시 시도할 수 있게 보관하지 않는다.
        if (outcome.summary !== "processing_failed") {
          const item = { signature: signatureOf(files.get(hwpPath!), files.get(pdfPath!)), outcome, savedAt: Date.now() };
          if (!(await save(folder, item))) setStorageWarning(true);
          setStored((m) => new Map(m).set(folder, item));
        }
        setRows((rs) => rs.map((r) => (r.check.id === row.check.id ? { ...r, state: "done", outcome } : r)));
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  async function reset() {
    abortRef.current?.abort();
    setRows([]);
    setFiles(new Map());
    setBlocking(null);
    setDetail(null);
    setHistory(false);
    setHistoryDetail(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  /** 「이전 결과」 화면의 「기록 지우기」: 이 브라우저에 남은 결과를 모두 지운다 */
  async function clearHistory() {
    if (!window.confirm("이 브라우저에 남은 이전 결과를 모두 지웁니다. 지운 뒤에는 되돌릴 수 없습니다.")) return;
    const cleared = await clearAll();
    setStored(new Map());
    if (!cleared) window.alert("이 브라우저의 저장소를 지우지 못했습니다. 브라우저 설정에서 사이트 데이터를 직접 지워 주세요.");
    setHistoryDetail(null);
  }

  const historyList = useMemo(() => [...stored.entries()].sort((a, b) => b[1].savedAt - a[1].savedAt), [stored]);

  const counts = useMemo(() => {
    const ok = rows.filter((r) => r.check.ok);
    return { total: ok.length, done: ok.filter((r) => r.state === "done").length, waiting: ok.filter((r) => r.state === "waiting").length };
  }, [rows]);

  const detailRow = rows.find((r) => r.check.id === detail);
  const [info, setInfo] = useState<InfoTopic | null>(null);
  const closeInfo = useCallback(() => setInfo(null), []);
  const showHero = rows.length === 0 && !history;
  const hasWork = rows.length > 0 || history;
  const historyDetailItem = historyDetail ? stored.get(historyDetail) : undefined;

  return (
    <main
      className={`relative flex flex-col bg-black selection:bg-white selection:text-black ${showHero ? "h-screen overflow-hidden" : "min-h-screen"}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        // 창 밖으로 나가면 relatedTarget이 없다 → 안내를 닫는다 (CHECK 14번)
        if (e.currentTarget === e.target || e.relatedTarget === null) setDragging(false);
      }}
      onDrop={async (e) => {
        e.preventDefault();
        setDragging(false);
        if (running) {
          setBlocking("검증하는 중에는 폴더를 새로 올릴 수 없습니다. 끝난 뒤(또는 「새 검증 시작」 뒤) 다시 올려 주세요.");
          return;
        }
        let picked: PickedFile[];
        try {
          picked = await fromDataTransfer(e.dataTransfer);
        } catch {
          setBlocking("끌어다 놓은 폴더를 읽지 못했습니다. 「폴더 선택」으로 다시 골라 주세요.");
          return;
        }
        await accept(picked);
      }}
    >
      <BackgroundVideo />
      {/* 폴더를 끌고 오면 화면 전체에 놓을 자리를 보여 준다 */}
      {dragging && !uploadOpen && (
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
        onLink={(id) => (id === "history" ? (setHistory(true), setHistoryDetail(null)) : setInfo(id as InfoTopic))}
        action={hasWork ? { label: "새 검증 시작", onClick: reset } : null}
      />

      {showHero ? (
        <Hero
          dragging={dragging}
          storedCount={stored.size}
          blocking={blocking}
          onPick={() => setUploadOpen(true)}
          onInfo={() => setInfo("rules")}
          onHistory={() => setHistory(true)}
        />
      ) : (
        <div className="relative z-10 mx-auto w-full max-w-5xl flex-1 px-4 pb-16 sm:px-6">
          {blocking && (
            <p role="alert" className="mb-4 rounded-2xl border border-red-300/30 bg-red-400/10 px-4 py-3 text-sm text-red-100">
              {blocking}
            </p>
          )}
          {storageWarning && (
            <p role="status" className="mb-4 break-keep rounded-2xl border border-amber-300/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
              이 브라우저가 결과 저장을 막고 있습니다(시크릿 창 등). 지금 화면의 결과는 볼 수 있지만, 새로고침하거나 창을 닫으면 사라지고 「이전 결과」에도 남지 않습니다.
            </p>
          )}

          {history ? (
            historyDetailItem ? (
              <Detail outcome={historyDetailItem.outcome} onBack={() => setHistoryDetail(null)} />
            ) : (
              <section aria-label="이전 결과" className="glass-panel liquid-glass rounded-3xl p-5 sm:p-8">
                <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-white/60">이전 결과</p>
                    <h1 className="mt-2 font-serif text-3xl font-normal leading-tight text-white sm:text-4xl">지금까지 끝낸 검증</h1>
                    <p className="mt-2 break-keep text-sm text-white/60">
                      <b className="font-semibold text-white">{historyList.length}</b>건 · 이 컴퓨터의 이 브라우저에만 보관됩니다. 다른 기기에서는 보이지 않습니다.
                    </p>
                  </div>
                  <button
                    onClick={clearHistory}
                    disabled={historyList.length === 0}
                    className="glass-pill border border-white/20 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:border-red-300/60 hover:bg-red-400/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    기록 지우기
                  </button>
                </div>
                {historyList.length === 0 ? (
                  <p className="rounded-2xl bg-white/5 px-4 py-10 text-center text-sm text-white/60">아직 끝낸 검증이 없습니다.</p>
                ) : (
                  <div className="overflow-x-auto rounded-2xl ring-1 ring-white/10">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-white/5 text-white/60">
                        <tr>
                          <th scope="col" className="px-4 py-3 font-medium">폴더 이름</th>
                          <th scope="col" className="px-4 py-3 font-medium">결과</th>
                          <th scope="col" className="px-4 py-3 font-medium">검증한 때</th>
                          <th scope="col" className="px-4 py-3"><span className="sr-only">자세히</span></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/10">
                        {historyList.map(([folder, item]) => {
                          const s = item.outcome.summary;
                          const canOpen = s === "mismatch_found" || s === "needs_review";
                          return (
                            <tr key={folder} className="transition-colors hover:bg-white/[0.03]">
                              <td className="px-4 py-3 font-mono text-white">{folder}</td>
                              <td className="px-4 py-3">
                                <Badge summary={s} />
                              </td>
                              <td className="px-4 py-3 text-white/60">{new Date(item.savedAt).toLocaleString("ko-KR")}</td>
                              <td className="px-4 py-3 text-right">
                                {canOpen && (
                                  <button onClick={() => setHistoryDetail(folder)} className="rounded text-sm font-medium text-violet-200 hover:text-white hover:underline">
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
                )}
              </section>
            )
          ) : !detailRow ? (
            <section aria-label="건별 결과" className="glass-panel liquid-glass rounded-3xl p-5 sm:p-8">
              <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-white/60">검증 결과</p>
                  <h1 className="mt-2 font-serif text-3xl font-normal leading-tight text-white sm:text-4xl">
                    {running ? "읽고 대조하는 중" : counts.waiting > 0 ? "검증할 준비가 됐습니다" : "검증이 끝났습니다"}
                  </h1>
                  <p className="mt-2 text-sm text-white/60">
                    <b className="font-semibold text-white">{counts.done}</b> / {counts.total}건 완료
                    {running && " · 한 건에 45초쯤 걸립니다. 정확도를 위해 여러 번 읽습니다."}
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
                        <tr key={r.check.id} className="transition-colors hover:bg-white/[0.03]">
                          <td className="px-4 py-3 font-mono text-white">{r.check.folder}</td>
                          <td className="px-4 py-3">
                            {r.state === "waiting" && <span className="text-white/50">대기</span>}
                            {r.state === "running" && <span className="animate-pulse text-violet-200">읽는 중…{r.progress ? ` ${r.progress}` : ""}</span>}
                            {r.state === "done" && s && <Badge summary={s} />}
                          </td>
                          <td className="px-4 py-3 text-white/60">
                            {r.outcome?.error}
                            {r.resumed && <span className="text-white/45">이전 결과 이어 씀</span>}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {canOpen && (
                              <button onClick={() => setDetail(r.check.id)} className="rounded text-sm font-medium text-violet-200 hover:text-white hover:underline">
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
      <UploadModal
        open={uploadOpen}
        dragging={dragging}
        onClose={() => setUploadOpen(false)}
        onBrowse={() => inputRef.current?.click()}
      />
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
