// 비용 청구 검증: 브라우저에서 pdf.js로 PDF를 연다 (2026-11-20).
// - 글자 PDF 페이지는 글자를 바로 꺼내 줄로 묶는다(서버로 보내지 않음).
// - 스캔 페이지는 200dpi 사진으로 그려 서버에 보낸다(배포본 요청 한도 안으로 JPEG 화질을 낮춰 가며).
// - 미리보기·원본 확인용 작은 그림도 여기서 그린다. 모두 이 브라우저 메모리에서만 쓴다.
import { linesFromPieces, type TextPiece } from "@/lib/readers/pdfText";
import type { ParseLine } from "@/lib/readers/registryParse";

type PdfPage = {
  getTextContent(): Promise<{ items: unknown[] }>;
  getViewport(o: { scale: number }): { width: number; height: number };
  render(o: { canvas: HTMLCanvasElement; viewport: unknown }): { promise: Promise<void> };
  cleanup(): void;
};
export type PdfDoc = { numPages: number; getPage(n: number): Promise<PdfPage>; destroy(): Promise<void> };

type PdfJs = {
  getDocument(src: { data: Uint8Array; isEvalSupported?: boolean }): {
    promise: Promise<{ numPages: number; getPage(n: number): Promise<PdfPage> }>;
    destroy(): Promise<void>;
  };
};
let loaded: Promise<PdfJs> | null = null;

async function loadPdfJs(): Promise<PdfJs> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  return pdfjs as unknown as PdfJs;
}

export async function openPdf(file: File): Promise<PdfDoc> {
  loaded ??= loadPdfJs();
  const pdfjs = await loaded;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false });
  const doc = await task.promise;
  // 이 pdf.js 판은 문서 쪽에 destroy가 없어 불러오기 작업(task)으로 닫는다
  return { numPages: doc.numPages, getPage: (n) => doc.getPage(n), destroy: () => task.destroy() };
}

/** 페이지의 글자 줄 (스캔 페이지면 거의 비어 있다) */
export async function pageTextLines(doc: PdfDoc, n: number): Promise<ParseLine[]> {
  const page = await doc.getPage(n);
  const { items } = await page.getTextContent();
  const pieces: TextPiece[] = items.flatMap((it) => {
    const t = it as { str?: unknown; transform?: number[]; width?: number; height?: number };
    if (typeof t.str !== "string" || !t.transform) return [];
    return [{ str: t.str, x: t.transform[4], y: t.transform[5], width: t.width ?? 0, height: t.height || Math.abs(t.transform[3]) }];
  });
  return linesFromPieces(pieces);
}

/** 글자 PDF 페이지로 볼 만큼 글자가 있는지 (금액 숫자가 있어야 한다) */
export const isTextPage = (lines: ParseLine[]) => {
  const all = lines.map((l) => l.text).join("");
  return all.replace(/\s/g, "").length >= 30 && /\d/.test(all) && /[가-힣]/.test(all);
};

async function renderCanvas(doc: PdfDoc, n: number, scale: number): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(n);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  await page.render({ canvas, viewport }).promise;
  page.cleanup();
  return canvas;
}

const toBlob = (c: HTMLCanvasElement, q: number) => new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", q));

/** 글자 읽기용 페이지 사진: 200dpi, 요청 한도(3.8MB) 안 JPEG */
export async function renderForOcr(doc: PdfDoc, n: number): Promise<Blob> {
  const canvas = await renderCanvas(doc, n, 200 / 72);
  for (const q of [0.92, 0.85, 0.75, 0.6]) {
    const blob = await toBlob(canvas, q);
    if (blob && blob.size <= 3_800_000) return blob;
  }
  throw new Error("페이지 사진이 너무 큽니다.");
}

/** 화면에 보여 줄 페이지 그림 (object URL). 폭 px 기준 */
export async function renderPreview(doc: PdfDoc, n: number, widthPx: number): Promise<string> {
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const canvas = await renderCanvas(doc, n, widthPx / base.width);
  const blob = await toBlob(canvas, 0.85);
  if (!blob) throw new Error("그림을 만들지 못했습니다.");
  return URL.createObjectURL(blob);
}
