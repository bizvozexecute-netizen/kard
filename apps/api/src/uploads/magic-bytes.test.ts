import { describe, expect, it } from "vitest";
import { detectImage } from "./magic-bytes";

const pad = (b: number[]) => Buffer.concat([Buffer.from(b), Buffer.alloc(16)]);

describe("detectImage", () => {
  it("распознаёт jpg, png, webp по magic bytes", () => {
    expect(detectImage(pad([0xff, 0xd8, 0xff, 0xe0]))).toEqual({ ext: "jpg", mime: "image/jpeg" });
    expect(detectImage(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toEqual({
      ext: "png",
      mime: "image/png",
    });
    const webp = Buffer.concat([
      Buffer.from("RIFF"),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from("WEBP"),
      Buffer.alloc(8),
    ]);
    expect(detectImage(webp)).toEqual({ ext: "webp", mime: "image/webp" });
  });

  it("отклоняет gif, pdf, произвольные и короткие буферы", () => {
    expect(detectImage(pad([0x47, 0x49, 0x46, 0x38]))).toBeNull(); // GIF
    expect(detectImage(pad([0x25, 0x50, 0x44, 0x46]))).toBeNull(); // %PDF
    expect(detectImage(Buffer.from("just text data here"))).toBeNull();
    expect(detectImage(Buffer.from([0xff, 0xd8]))).toBeNull(); // слишком коротко
  });
});
