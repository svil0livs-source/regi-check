// Design Ref: DESIGN.md §3.1 업로드 검사 규칙 (PLAN 6번)
// 브라우저에서 고른 파일 목록을 폴더(=건)별로 묶고, 검증할 수 있는 건인지 판정한다.
// 화면과 분리된 순수 함수라서 서류 없이 시험할 수 있다.

/** 한 번에 올릴 수 있는 최대 건 수 */
export const MAX_CASES = 30;
/** 파일 하나의 최대 크기 (20MB) */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** 검사에 필요한 파일 정보 (브라우저 File에서 뽑는다) */
export interface UploadEntry {
  /** 폴더를 포함한 경로. 예: "fixtures/2026-0001/신청서.hwp" (File.webkitRelativePath) */
  path: string;
  size: number;
}

export interface CaseCheck {
  /** 폴더 이름 (건을 구분하는 기준) */
  folder: string;
  /** 폴더 전체 경로 (같은 이름 폴더를 구분하기 위해) */
  dir: string;
  /** 검증할 수 있으면 두 파일의 경로 */
  hwpPath?: string;
  pdfPath?: string;
  ok: boolean;
  /** 문제가 있을 때 화면에 보일 이유 */
  reasons: string[];
}

export interface UploadCheckResult {
  cases: CaseCheck[];
  /** 30건 초과 등 전체를 막는 문제 (있으면 아무것도 처리하지 않는다) */
  blockingError?: string;
}

/** 개수에 세지 않고 무시하는 파일 (윈도·맥이 자동으로 만드는 파일) */
function isIgnored(name: string): boolean {
  const lower = name.toLowerCase();
  return name.startsWith(".") || lower === "thumbs.db" || lower === "desktop.ini";
}

function splitPath(path: string): { dir: string; name: string } {
  const norm = path.replace(/\\/g, "/");
  const i = norm.lastIndexOf("/");
  return i === -1 ? { dir: "", name: norm } : { dir: norm.slice(0, i), name: norm.slice(i + 1) };
}

const ext = (name: string) => name.slice(name.lastIndexOf(".") + 1).toLowerCase();

/**
 * 파일 목록을 건별로 검사한다.
 * - 건 = 파일이 바로 들어 있는 폴더. 폴더 이름이 건 이름이다.
 * - 다른 건 폴더를 품고 있는 상위 폴더는, 자기 안에 한글·PDF가 없으면 건으로 보지 않는다
 *   (예: 여러 건 폴더를 담은 상위 폴더에 정답표.md만 있는 경우).
 */
export function checkFolders(entries: UploadEntry[]): UploadCheckResult {
  const byDir = new Map<string, { name: string; path: string; size: number }[]>();
  for (const e of entries) {
    const { dir, name } = splitPath(e.path);
    if (isIgnored(name)) continue;
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir)!.push({ name, path: e.path, size: e.size });
  }

  const dirs = [...byDir.keys()];
  const isContainer = (dir: string) => dirs.some((d) => d !== dir && d.startsWith(dir === "" ? "" : dir + "/"));
  const hasDocs = (dir: string) => byDir.get(dir)!.some((f) => ["hwp", "pdf"].includes(ext(f.name)));

  const caseDirs = dirs.filter((d) => !(isContainer(d) && !hasDocs(d))).sort();

  if (caseDirs.length > MAX_CASES) {
    return {
      cases: [],
      blockingError: `한 번에 ${MAX_CASES}건까지 올릴 수 있습니다. (지금 ${caseDirs.length}건)`,
    };
  }

  const folderName = (dir: string) => (dir === "" ? "(최상위)" : dir.slice(dir.lastIndexOf("/") + 1));
  const nameCount = new Map<string, number>();
  for (const d of caseDirs) nameCount.set(folderName(d), (nameCount.get(folderName(d)) ?? 0) + 1);

  const cases = caseDirs.map((dir): CaseCheck => {
    const files = byDir.get(dir)!;
    const hwps = files.filter((f) => ext(f.name) === "hwp");
    const pdfs = files.filter((f) => ext(f.name) === "pdf");
    const hwpx = files.filter((f) => ext(f.name) === "hwpx");
    const others = files.filter((f) => !["hwp", "pdf", "hwpx"].includes(ext(f.name)));
    const folder = folderName(dir);
    const reasons: string[] = [];

    if ((nameCount.get(folder) ?? 0) > 1) reasons.push("같은 이름 폴더가 있음");
    if (hwps.length === 0) reasons.push(hwpx.length ? "한글 파일이 .hwpx 형식임 (.hwp만 지원)" : "한글 파일 없음");
    if (hwps.length > 1) reasons.push(`한글 파일이 ${hwps.length}개`);
    if (pdfs.length === 0) reasons.push("등기부등본 PDF 없음");
    if (pdfs.length > 1) reasons.push(`PDF가 ${pdfs.length}개`);
    if (others.length || (hwpx.length && hwps.length)) reasons.push("다른 파일이 들어 있음");
    for (const f of files) {
      if (f.size > MAX_FILE_BYTES) reasons.push(`20MB 초과: ${f.name}`);
    }

    const ok = reasons.length === 0;
    return {
      folder,
      dir,
      ok,
      reasons,
      ...(ok ? { hwpPath: hwps[0].path, pdfPath: pdfs[0].path } : {}),
    };
  });

  return { cases };
}
