// 스캔 PDF 사진 꺼내기 시험 (작은 가짜 PDF를 직접 만들어 확인, 외부 서비스 없음)
import { deflateSync } from "node:zlib";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { extractPageImages, PdfImageError } from "./pdfImages";

type Obj = { id: number; dict: string; data?: Buffer };
function makePdf(objs: Obj[]): Buffer {
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n", "latin1")];
  for (const o of objs) {
    if (o.data) {
      parts.push(Buffer.from(`${o.id} 0 obj\n<< ${o.dict} /Length ${o.data.length} >>\nstream\n`, "latin1"), o.data, Buffer.from("\nendstream\nendobj\n", "latin1"));
    } else {
      parts.push(Buffer.from(`${o.id} 0 obj\n<< ${o.dict} >>\nendobj\n`, "latin1"));
    }
  }
  parts.push(Buffer.from("trailer\n<< /Root 1 0 R >>\n%%EOF\n", "latin1"));
  return Buffer.concat(parts);
}
const jpeg = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: "#ffffff" } }).jpeg().toBuffer();
const page = (id: number, im: number) => ({ id, dict: `/Type /Page /Parent 2 0 R /Resources << /XObject << /Im0 ${im} 0 R >> >>` });
const meta = (b: Buffer) => sharp(b).metadata();

describe("extractPageImages", () => {
  it("페이지 목록(/Kids) 순서대로 꺼내고, Flate 회색조 사진도 읽는다", async () => {
    const gray = deflateSync(Buffer.alloc(400 * 300, 200));
    const pdf = makePdf([
      { id: 1, dict: "/Type /Catalog /Pages 2 0 R" },
      { id: 2, dict: "/Type /Pages /Kids [4 0 R 3 0 R] /Count 2" },
      page(3, 5),
      page(4, 6),
      { id: 5, dict: "/Type /XObject /Subtype /Image /Width 400 /Height 500 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode", data: await jpeg(400, 500) },
      { id: 6, dict: "/Type /XObject /Subtype /Image /Width 400 /Height 300 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode", data: gray },
    ]);
    const pages = await extractPageImages(pdf);
    expect(pages).toHaveLength(2);
    const [a, b] = await Promise.all(pages.map(meta));
    expect([a.format, a.width, a.height]).toEqual(["png", 400, 300]); // 첫 페이지 = 4번 객체의 사진
    expect([b.format, b.width, b.height]).toEqual(["jpeg", 400, 500]);
  });

  it("1비트 흑백 사진(Flate)도 회색조로 바꿔 읽는다", async () => {
    const w = 320, h = 320;
    const raw = Buffer.alloc((w / 8) * h, 0xff); // 모두 흰색
    const pdf = makePdf([
      { id: 1, dict: "/Type /Catalog /Pages 2 0 R" },
      { id: 2, dict: "/Type /Pages /Kids [3 0 R] /Count 1" },
      page(3, 4),
      { id: 4, dict: `/Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /FlateDecode`, data: deflateSync(raw) },
    ]);
    const [img] = await extractPageImages(pdf);
    const { data } = await sharp(img).greyscale().raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBe(255);
  });

  it("로고 같은 작은 사진은 페이지로 보지 않는다", async () => {
    const pdf = makePdf([
      { id: 1, dict: "/Type /Catalog /Pages 2 0 R" },
      { id: 2, dict: "/Type /Pages /Kids [3 0 R] /Count 1" },
      page(3, 4),
      { id: 4, dict: "/Type /XObject /Subtype /Image /Width 100 /Height 80 /Filter /DCTDecode", data: await jpeg(100, 80) },
    ]);
    expect(await extractPageImages(pdf)).toHaveLength(0);
  });

  it("CCITT 흑백 팩스 방식은 읽을 수 없다고 이유를 알린다", async () => {
    const pdf = makePdf([
      { id: 1, dict: "/Type /Catalog /Pages 2 0 R" },
      { id: 2, dict: "/Type /Pages /Kids [3 0 R] /Count 1" },
      page(3, 4),
      { id: 4, dict: "/Type /XObject /Subtype /Image /Width 1654 /Height 2339 /BitsPerComponent 1 /Filter /CCITTFaxDecode", data: Buffer.from([0, 1, 2]) },
    ]);
    await expect(extractPageImages(pdf)).rejects.toBeInstanceOf(PdfImageError);
    await expect(extractPageImages(pdf)).rejects.toThrow(/CCITT/);
  });

  it("페이지 목록이 없으면 파일 안 순서로 사진마다 한 페이지", async () => {
    const pdf = makePdf([
      { id: 7, dict: "/Type /XObject /Subtype /Image /Width 400 /Height 400 /Filter /DCTDecode", data: await jpeg(400, 400) },
      { id: 8, dict: "/Type /XObject /Subtype /Image /Width 500 /Height 400 /Filter /DCTDecode", data: await jpeg(500, 400) },
    ]);
    const pages = await extractPageImages(pdf);
    expect((await Promise.all(pages.map(meta))).map((m) => m.width)).toEqual([400, 500]);
  });
});
