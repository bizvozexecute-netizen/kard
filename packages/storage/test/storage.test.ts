import type { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import { S3Storage, SIGNED_URL_TTL_SEC, UPLOADS_EXPIRE_DAYS } from "../src";

function fakeClient() {
  return {
    send: vi.fn().mockResolvedValue({}),
    config: {
      // минимально достаточно для s3-request-presigner
      credentials: () => Promise.resolve({ accessKeyId: "ak", secretAccessKey: "sk" }),
      endpoint: () =>
        Promise.resolve({ protocol: "http:", hostname: "localhost", port: 9000, path: "/" }),
      region: () => Promise.resolve("us-east-1"),
      forcePathStyle: true,
      endpointProvider: undefined,
    },
  } as unknown as S3Client & { send: ReturnType<typeof vi.fn> };
}

describe("S3Storage", () => {
  it("put отправляет PutObject с бакетом, ключом и mime", async () => {
    const client = fakeClient();
    const storage = new S3Storage({
      endpoint: "e",
      accessKey: "a",
      secretKey: "s",
      bucket: "kadr",
      client,
    });
    await storage.put("results/u/g/0.png", Buffer.from("x"), "image/png");
    const cmd = client.send.mock.calls[0]![0];
    expect(cmd.constructor.name).toBe("PutObjectCommand");
    expect(cmd.input).toMatchObject({
      Bucket: "kadr",
      Key: "results/u/g/0.png",
      ContentType: "image/png",
    });
  });

  it("applyLifecycleRules ставит правило на uploads/ и не бросает при ошибке", async () => {
    const client = fakeClient();
    const onWarn = vi.fn();
    const storage = new S3Storage({
      endpoint: "e",
      accessKey: "a",
      secretKey: "s",
      bucket: "kadr",
      client,
      onWarn,
    });
    await storage.applyLifecycleRules();
    const cmd = client.send.mock.calls[0]![0];
    expect(cmd.constructor.name).toBe("PutBucketLifecycleConfigurationCommand");
    expect(cmd.input.LifecycleConfiguration.Rules[0]).toMatchObject({
      Filter: { Prefix: "uploads/" },
      Expiration: { Days: UPLOADS_EXPIRE_DAYS },
    });

    client.send.mockRejectedValueOnce(new Error("NotImplemented"));
    await expect(storage.applyLifecycleRules()).resolves.toBeUndefined();
    expect(onWarn).toHaveBeenCalled();
  });

  it("константа TTL подписанных URL — 24 часа", () => {
    expect(SIGNED_URL_TTL_SEC).toBe(86_400);
  });
});
