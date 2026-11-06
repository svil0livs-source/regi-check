// Design Ref: DESIGN.md §3.1 업로드 검사 규칙 (PLAN 6번)
// 브라우저에서 고른 파일 목록을 건별로 묶고, 검증할 수 있는 건인지 판정한다.
// 화면과 분리된 순수 함수라서 서류 없이 시험할 수 있다.
// 2026-11-06 사용자 결정:
//   - 한 폴더에 여러 건(한글 파일 여러 개 + PDF 여러 개)이 있어도 된다. 파일 이름에 함께 들어 있는 값(예: 채무자 이름)으로 짝을 짓는다.
//   - 파일 하나 6000KB까지 받는다 (한 건 합계 4.3MB 제한은 없앰. 브라우저가 줄여 보낸다).
//   - 한 번에 최대 30건 = 한글 파일 30개.
//   - 한글·PDF가 아닌 파일은 세지 않고 무시한다.

/** 한 번에 올릴 수 있는 최대 건 수 (한글 파일 수) */
export const MAX_CASES = 30;
/** 파일 하나의 최대 크기 (6000KB) */
export const MAX_FILE_KB = 6000;
export const MAX_FILE_BYTES = MAX_FILE_KB * 1024;

/** 한글 파일로 받는 확장자 (.hwp = 한글 97~현재, .hwpx = 신버전, .hml = 한글 XML 문서) */
const HWP_EXTS = ["hwp", "hwpx", "hml"];

/** 검사에 필요한 파일 정보 (브라우저 File에서 뽑는다) */
export interface UploadEntry {
  /** 폴더를 포함한 경로. 예: "fixtures/2026-0001/신청서.hwp" (File.webkitRelativePath) */
  path: string;
  size: number;
}

export interface CaseCheck {
  /** 건을 구분하는 고유 값 (한글 파일 경로, 없으면 PDF 경로나 폴더 경로) */
  id: string;
  /** 화면에 보일 건 이름. 폴더에 1건이면 폴더 이름, 여러 건이면 「폴더 이름 / 한글 파일 이름」 */
  folder: string;
  /** 폴더 전체 경로 */
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

interface FileInfo {
  name: string;
  path: string;
  size: number;
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
const stem = (name: string) => (name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name);
const isHwp = (name: string) => HWP_EXTS.includes(ext(name));
const isPdf = (name: string) => ext(name) === "pdf";

/**
 * 파일 이름에서 짝 맞추기에 쓸 조각들.
 * 이름을 한글·영문·숫자 덩어리로 나눈 뒤, 덩어리 통째와 그 안의 2글자 이상 조각을 모두 모은다.
 * (맥은 한글 이름을 자모로 풀어 두므로 NFC로 맞춘다)
 */
function nameKeys(name: string): Set<string> {
  const runs = stem(name).normalize("NFC").toLowerCase().match(/[가-힣a-z0-9]+/g) ?? [];
  const keys = new Set<string>();
  for (const run of runs) {
    keys.add(run);
    for (let i = 0; i < run.length; i++) for (let j = i + 2; j <= run.length; j++) keys.add(run.slice(i, j));
  }
  return keys;
}

export interface NamePairing {
  /** 한글 파일 경로 → 짝 PDF 경로 */
  pairs: Map<string, string>;
  /** 짝을 못 정한 한글 파일 경로 → 이유 */
  unpaired: Map<string, string>;
  /** 어느 한글 파일과도 짝이 안 된 PDF 경로 */
  orphanPdfs: string[];
}

/**
 * 한 폴더 안의 한글 파일과 PDF를 파일 이름으로 짝짓는다. (2026-11-06 사용자 결정)
 * - 한글 파일과 PDF 이름에 함께 들어 있고, 다른 PDF 이름에는 없는 조각(예: 채무자 이름)이 있으면 짝이다.
 * - 폴더 안 모든 파일 이름에 들어 있는 조각(예: "근저당권")은 쓰지 않는다.
 * - 짝 PDF가 하나로 정해지지 않으면 추측하지 않고 이유를 남긴다.
 * - 한 PDF에 한글 파일 여러 개가 짝지어질 수 있다 (등기부 하나에 이전할 근저당권이 여러 건).
 * 잘못 짝지어지더라도 대조에서 접수번호가 등기부에 없으면 불일치로 나온다.
 */
export function pairByName(hwps: FileInfo[], pdfs: FileInfo[]): NamePairing {
  const keys = new Map([...hwps, ...pdfs].map((f) => [f.path, nameKeys(f.name)]));
  const all = [...keys.values()];
  const generic = (k: string) => all.every((s) => s.has(k));
  const pairs = new Map<string, string>();
  const unpaired = new Map<string, string>();

  for (const h of hwps) {
    const hk = keys.get(h.path)!;
    const shared = (p: FileInfo) => [...hk].filter((k) => keys.get(p.path)!.has(k) && !generic(k));
    // 이 PDF만 가진 조각이 함께 들어 있으면 짝
    const linked = pdfs.filter((p) => shared(p).some((k) => pdfs.every((o) => o === p || !keys.get(o.path)!.has(k))));
    if (linked.length === 1) {
      pairs.set(h.path, linked[0].path);
      continue;
    }
    const similar = linked.length > 1 ? linked : pdfs.filter((p) => shared(p).length > 0);
    unpaired.set(
      h.path,
      similar.length > 1
        ? `파일 이름이 비슷한 PDF가 여러 개라 짝을 정하지 못함 (${similar.map((p) => p.name).join(", ")})`
        : "파일 이름에 같은 값이 들어 있는 등기부등본 PDF 없음",
    );
  }
  const used = new Set(pairs.values());
  return { pairs, unpaired, orphanPdfs: pdfs.filter((p) => !used.has(p.path)).map((p) => p.path) };
}

/**
 * 파일 목록을 건별로 검사한다.
 * - 건이 들어 있는 곳 = 파일이 바로 들어 있는 폴더.
 *   한글 파일·PDF가 1개 이하씩이면 폴더 하나가 1건이고 폴더 이름이 건 이름이다.
 *   더 많으면 한글 파일 하나가 1건이고, 파일 이름으로 PDF와 짝짓는다.
 * - 다른 건 폴더를 품고 있는 상위 폴더는, 자기 안에 한글·PDF가 없으면 건으로 보지 않는다
 *   (예: 여러 건 폴더를 담은 상위 폴더에 정답표.md만 있는 경우).
 */
export function checkFolders(entries: UploadEntry[]): UploadCheckResult {
  const byDir = new Map<string, FileInfo[]>();
  for (const e of entries) {
    const { dir, name } = splitPath(e.path);
    if (isIgnored(name)) continue;
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir)!.push({ name, path: e.path, size: e.size });
  }

  const dirs = [...byDir.keys()];
  const isContainer = (dir: string) => dirs.some((d) => d !== dir && d.startsWith(dir === "" ? "" : dir + "/"));
  const hasDocs = (dir: string) => byDir.get(dir)!.some((f) => isHwp(f.name) || isPdf(f.name));
  const caseDirs = dirs.filter((d) => !(isContainer(d) && !hasDocs(d))).sort();

  const hwpCount = caseDirs.reduce((n, d) => n + byDir.get(d)!.filter((f) => isHwp(f.name)).length, 0);
  if (hwpCount > MAX_CASES) {
    return {
      cases: [],
      blockingError: `한 번에 ${MAX_CASES}건(한글 파일 ${MAX_CASES}개)까지 올릴 수 있습니다. (지금 ${hwpCount}건)`,
    };
  }

  const folderName = (dir: string) => (dir === "" ? "(최상위)" : dir.slice(dir.lastIndexOf("/") + 1));
  const tooBig = (fs: FileInfo[]) => fs.filter((f) => f.size > MAX_FILE_BYTES).map((f) => `${MAX_FILE_KB}KB 초과: ${f.name}`);
  const cases: CaseCheck[] = [];

  for (const dir of caseDirs) {
    const files = byDir.get(dir)!;
    // 한글 파일은 구버전·신버전 모두 받는다 (2026-11-05 사용자 결정)
    const hwps = files.filter((f) => isHwp(f.name)).sort((a, b) => a.name.localeCompare(b.name));
    const pdfs = files.filter((f) => isPdf(f.name)).sort((a, b) => a.name.localeCompare(b.name));
    const folder = folderName(dir);

    if (hwps.length <= 1 && pdfs.length <= 1) {
      // 폴더 하나 = 1건 (예전과 같음)
      const reasons: string[] = [];
      if (hwps.length === 0) reasons.push("한글 파일 없음");
      if (pdfs.length === 0) reasons.push("등기부등본 PDF 없음");
      reasons.push(...tooBig([...hwps, ...pdfs]));
      cases.push({ id: hwps[0]?.path ?? pdfs[0]?.path ?? `${dir}/`, folder, dir, ok: false, reasons, hwpPath: hwps[0]?.path, pdfPath: pdfs[0]?.path });
      continue;
    }

    // 폴더 하나에 여러 건: 파일 이름으로 짝짓기 (2026-11-06)
    const { pairs, unpaired, orphanPdfs } = pairByName(hwps, pdfs);
    const byPath = new Map(files.map((f) => [f.path, f]));
    for (const h of hwps) {
      const pdfPath = pairs.get(h.path);
      const reasons: string[] = [];
      if (pdfs.length === 0) reasons.push("등기부등본 PDF 없음");
      else if (!pdfPath) reasons.push(unpaired.get(h.path)!);
      reasons.push(...tooBig(pdfPath ? [h, byPath.get(pdfPath)!] : [h]));
      cases.push({ id: h.path, folder: `${folder} / ${stem(h.name)}`, dir, ok: false, reasons, hwpPath: h.path, pdfPath });
    }
    for (const p of orphanPdfs) {
      const name = byPath.get(p)!.name;
      cases.push({ id: p, folder: `${folder} / ${name}`, dir, ok: false, reasons: [`짝이 되는 한글 파일 없음: ${name}`], pdfPath: p });
    }
  }

  // 같은 이름의 건이 둘 이상이면 결과 보관(건 이름 기준)이 섞이므로 처리하지 않는다
  const nameCount = new Map<string, number>();
  for (const c of cases) nameCount.set(c.folder, (nameCount.get(c.folder) ?? 0) + 1);
  for (const c of cases) {
    if ((nameCount.get(c.folder) ?? 0) > 1) c.reasons.unshift("같은 이름 폴더가 있음");
    c.ok = c.reasons.length === 0;
  }
  return { cases };
}
