import { createHash } from "node:crypto";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Base58 (алфавит Bitcoin) без внешних зависимостей. */
export function base58Encode(bytes: Uint8Array): string {
  let value = 0n;
  for (const b of bytes) value = (value << 8n) | BigInt(b);
  let out = "";
  while (value > 0n) {
    out = ALPHABET[Number(value % 58n)] + out;
    value /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out || "1";
}

export const REFERRAL_CODE_LENGTH = 8;

/**
 * Детерминированные кандидаты реферального кода из id: base58(sha256(id)),
 * нарезанный окнами по 8 символов (attempt сдвигает окно при коллизии).
 */
export function referralCodeCandidate(id: string, attempt = 0): string {
  const digest = createHash("sha256")
    .update(`${id}:${Math.floor(attempt / 4)}`)
    .digest();
  const encoded = base58Encode(digest);
  const offset = (attempt % 4) * REFERRAL_CODE_LENGTH;
  return encoded.slice(offset, offset + REFERRAL_CODE_LENGTH).padEnd(REFERRAL_CODE_LENGTH, "1");
}

export function isReferralCode(value: string): boolean {
  return value.length === REFERRAL_CODE_LENGTH && [...value].every((c) => ALPHABET.includes(c));
}
