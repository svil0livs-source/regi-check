// 브라우저에서 pdf.js로 글자 PDF의 글자 조각을 꺼낸다 (2026-11-09 사용자 결정: 인터넷등기소 글자 PDF는 글자를 바로 읽는다).
// pdf.js는 무거우므로 글자 PDF를 만났을 때만 불러온다. 꺼낸 글자는 이 브라우저 메모리에서만 쓰고 버린다.
import { readTextPieces, type PdfJsLike, type TextPiece } from "@/lib/readers/pdfText";

let loaded: Promise<PdfJsLike> | null = null;

async function loadPdfJs(): Promise<PdfJsLike> {
  const pdfjs = await import("pdfjs-dist");
  // pdf.js 작업 스크립트는 앱과 같은 곳에서 받는다 (외부로 나가지 않음)
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  return pdfjs as unknown as PdfJsLike;
}

/** 글자 PDF의 페이지별 글자 조각 */
export async function browserTextPieces(pdf: Uint8Array): Promise<TextPiece[][]> {
  loaded ??= loadPdfJs();
  return readTextPieces(await loaded, pdf);
}
