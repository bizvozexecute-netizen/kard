import request from "supertest";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, type TestContext } from "./app";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestApp();
});

beforeEach(async () => {
  await ctx.reset();
});

afterAll(async () => {
  await ctx.close();
});

const http = () => request(ctx.app.getHttpServer());

async function login(id: number): Promise<{ access: string; userId: string }> {
  const res = await http()
    .post("/v1/auth/telegram-mini-app")
    .send({ initData: ctx.initData({ id }) })
    .expect(200);
  return { access: res.body.tokens.accessToken, userId: res.body.user.id };
}

describe("POST /v1/uploads", () => {
  it("принимает png, кладёт в storage, пишет Upload и возвращает подписанный url", async () => {
    const { access, userId } = await login(9301);
    const png = await sharp({
      create: { width: 32, height: 20, channels: 3, background: { r: 200, g: 10, b: 10 } },
    })
      .png()
      .toBuffer();

    const res = await http()
      .post("/v1/uploads")
      .set("authorization", `Bearer ${access}`)
      .attach("file", png, "cat.png")
      .expect(201);

    expect(res.body).toMatchObject({ width: 32, height: 20 });
    expect(res.body.url).toContain("https://signed.local/uploads/");
    const upload = await ctx.prisma.upload.findUniqueOrThrow({ where: { id: res.body.imageId } });
    expect(upload).toMatchObject({ userId, mime: "image/png" });
    expect(ctx.storage.files.has(upload.key)).toBe(true);
  });

  it("большое изображение ужимается до 2048 по длинной стороне", async () => {
    const { access } = await login(9302);
    const big = await sharp({
      create: { width: 4096, height: 1024, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .jpeg()
      .toBuffer();

    const res = await http()
      .post("/v1/uploads")
      .set("authorization", `Bearer ${access}`)
      .attach("file", big, "wide.jpg")
      .expect(201);
    expect(res.body).toMatchObject({ width: 2048, height: 512 });
  });

  it("не-изображение и не-multipart → 400; без токена → 401", async () => {
    const { access } = await login(9303);
    const bad = await http()
      .post("/v1/uploads")
      .set("authorization", `Bearer ${access}`)
      .attach("file", Buffer.from("%PDF-1.7 not an image"), "doc.pdf")
      .expect(400);
    expect(bad.body.error.details.reason).toBe("unsupported_image_type");

    const empty = await http()
      .post("/v1/uploads")
      .set("authorization", `Bearer ${access}`)
      .expect(400);
    expect(empty.body.error.details.reason).toBe("file_field_required");

    await http().post("/v1/uploads").expect(401);
  });
});
