/**
 * E2E smoke (DoD сессии 6, ТЗ §8): пользователь → кредиты → РЕАЛЬНАЯ генерация
 * image_draft через fal → файл в minio/S3, баланс списан ровно на цену операции.
 *
 * Требует запущенных api и worker с настоящими ключами и БД:
 *   docker compose up -d && pnpm migrate && pnpm dev
 *   SMOKE_REAL_FAL=1 API_URL=http://localhost:3000 BOT_TOKEN=$BOT_TOKEN \
 *   DATABASE_URL=postgresql://kadr:kadr@localhost:5432/kadr \
 *     pnpm exec tsx scripts/smoke.ts
 */
import { createHmac } from "node:crypto";
import { PrismaClient } from "@kadr/db";
import { LedgerService } from "@kadr/ledger";

const API_URL = process.env.API_URL ?? "http://localhost:3000";
const BOT_TOKEN = process.env.BOT_TOKEN;
const OPERATION = "image_draft";
const PRICE = 5n;

async function main(): Promise<void> {
  if (process.env.SMOKE_REAL_FAL !== "1") {
    console.log("SMOKE_REAL_FAL != 1 — скрипт делает реальный вызов fal, выходим.");
    return;
  }
  if (!BOT_TOKEN || !process.env.DATABASE_URL) throw new Error("нужны BOT_TOKEN и DATABASE_URL");

  // 1. Вход тестовым Telegram-пользователем
  const tgId = 900_000_000 + Math.floor(Math.random() * 1_000_000);
  const login = await api("/v1/auth/telegram-mini-app", {
    method: "POST",
    body: { initData: signInitData(BOT_TOKEN, tgId) },
  });
  const access: string = login.tokens.accessToken;
  const userId: string = login.user.id;
  console.log(`user ${userId} (tg ${tgId}), balance ${login.user.balance}`);

  // 2. Кредиты через LedgerService (правило 1: только через ledger)
  const prisma = new PrismaClient();
  const ledger = new LedgerService(prisma);
  await ledger.grant(
    userId,
    100n,
    "MANUAL",
    { refType: "smoke", refId: userId },
    `smoke:${userId}`,
  );
  const before = await ledger.getBalance(userId);
  console.log(`granted, balance=${before.balance}`);

  // 3. Генерация
  const created = await api("/v1/generations", {
    method: "POST",
    token: access,
    idemKey: `smoke-${Date.now()}`,
    body: { operationKey: OPERATION, prompt: "рыжий кот в очках читает книгу, тёплый свет" },
  });
  console.log(`generation ${created.id}, reserved ${created.costCredits}`);

  // 4. Поллинг до терминального статуса (до 3 мин)
  const deadline = Date.now() + 180_000;
  let gen = created;
  while (!["SUCCEEDED", "FAILED", "CANCELED"].includes(gen.status)) {
    if (Date.now() > deadline) throw new Error("smoke timeout");
    await new Promise((r) => setTimeout(r, 3000));
    gen = await api(`/v1/generations/${created.id}`, { token: access });
    console.log(`  status=${gen.status}`);
  }
  if (gen.status !== "SUCCEEDED") throw new Error(`generation ${gen.status}: ${gen.errorCode}`);

  // 5. Файл доступен по подписанному URL
  const url: string = gen.resultUrls[0];
  const head = await fetch(url);
  if (!head.ok) throw new Error(`result not downloadable: HTTP ${head.status}`);
  console.log(`result ok: ${url.slice(0, 80)}… (${head.headers.get("content-type")})`);

  // 6. Баланс списан ровно на цену
  const after = await ledger.getBalance(userId);
  const spent = before.balance - after.balance;
  if (spent !== PRICE || after.reserved !== 0n) {
    throw new Error(`balance mismatch: spent=${spent}, reserved=${after.reserved}`);
  }
  console.log(`balance ok: spent ${spent}, reserved 0. SMOKE PASSED`);
  await prisma.$disconnect();
}

async function api(
  path: string,
  opts: { method?: string; body?: unknown; token?: string; idemKey?: string } = {},
): Promise<Record<string, unknown> & Record<string, never> extends never ? never : any> {
  const res = await fetch(`${API_URL}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.idemKey ? { "idempotency-key": opts.idemKey } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json();
  if (!res.ok && res.status !== 200 && res.status !== 201) {
    throw new Error(`${path} → HTTP ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

function signInitData(botToken: string, tgId: number): string {
  const params = new URLSearchParams();
  params.set("query_id", "AAHsmoke");
  params.set("user", JSON.stringify({ id: tgId, first_name: "Smoke", username: "smoke" }));
  params.set("auth_date", String(Math.floor(Date.now() / 1000)));
  const dcs = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  params.set("hash", createHmac("sha256", secret).update(dcs).digest("hex"));
  return params.toString();
}

main().catch((err) => {
  console.error("SMOKE FAILED:", err);
  process.exit(1);
});
