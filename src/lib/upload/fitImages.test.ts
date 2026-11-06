// 등기부 사진을 요청 한도에 맞추는 규칙 시험 (2026-11-06)
import { describe, expect, it, vi } from "vitest";
import { fitImages, grayJpegDict, JPEG_QUALITIES } from "./fitImages";
import type { PageImageObject } from "@/lib/readers/pdfPages";

const jpeg = (page: number, size: number): PageImageObject => ({
  page,
  dict: "/Subtype /Image /Width 1000 /Height 1400 /Filter /DCTDecode",
  data: new Uint8Array(size),
});
const flate = (page: number, size: number): PageImageObject => ({
  page,
  dict: "/Subtype /Image /Width 1000 /Height 1400 /Filter /FlateDecode",
  data: new Uint8Array(size),
});

describe("fitImages", () => {
  it("한도 안이면 사진을 고치지 않는다", async () => {
    const reencode = vi.fn();
    const images = [jpeg(0, 100), jpeg(1, 100)];
    const r = await fitImages(images, 200, reencode);
    expect(r).toEqual({ ok: true, images, reencoded: false });
    expect(reencode).not.toHaveBeenCalled();
  });

  it("넘으면 높은 화질부터 다시 저장해 보고, 맞는 첫 화질에서 멈춘다", async () => {
    const used: number[] = [];
    const reencode = async (o: PageImageObject, q: number) => {
      used.push(q);
      return { ...o, dict: grayJpegDict(1000, 1400), data: new Uint8Array(Math.round(o.data.byteLength * q * 0.6)) };
    };
    const r = await fitImages([jpeg(0, 1000), jpeg(1, 1000)], 1200, reencode);
    expect(r.ok && r.reencoded).toBe(true);
    expect(new Set(used)).toEqual(new Set([JPEG_QUALITIES[0]]));
    if (r.ok) expect(r.images[0].dict).toContain("/DeviceGray");
  });

  it("JPEG가 아닌 사진은 그대로 두고, 가장 낮은 화질로도 넘으면 실패와 크기를 알린다", async () => {
    const reencode = vi.fn(async (o: PageImageObject) => ({ ...o, data: new Uint8Array(o.data.byteLength - 10) }));
    const r = await fitImages([flate(0, 1000), jpeg(1, 1000)], 1500, reencode);
    expect(r).toEqual({ ok: false, bytes: 1990 });
    expect(reencode).toHaveBeenCalledTimes(JPEG_QUALITIES.length);
  });

  it("다시 저장한 것이 더 크면 원래 사진을 쓴다", async () => {
    const reencode = async (o: PageImageObject) => ({ ...o, data: new Uint8Array(o.data.byteLength * 2) });
    const r = await fitImages([jpeg(0, 1000)], 500, reencode);
    expect(r).toEqual({ ok: false, bytes: 1000 });
  });
});
