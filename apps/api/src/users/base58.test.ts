import { describe, expect, it } from "vitest";
import { base58Encode, isReferralCode, referralCodeCandidate } from "./base58";

describe("base58", () => {
  it("кодирует известные значения", () => {
    expect(base58Encode(Buffer.from([0]))).toBe("1");
    expect(base58Encode(Buffer.from([0, 0, 1]))).toBe("112");
    expect(base58Encode(Buffer.from("Hello World!"))).toBe("2NEpo7TZRRrLZSi2U");
    expect(base58Encode(new Uint8Array())).toBe("1");
  });

  it("реферальный код детерминирован, 8 символов, разные окна при коллизии", () => {
    const a = referralCodeCandidate("clx123");
    expect(a).toHaveLength(8);
    expect(a).toBe(referralCodeCandidate("clx123"));
    expect(isReferralCode(a)).toBe(true);
    const variants = new Set([0, 1, 2, 3, 4, 5].map((n) => referralCodeCandidate("clx123", n)));
    expect(variants.size).toBe(6);
    expect(referralCodeCandidate("other")).not.toBe(a);
  });

  it("isReferralCode отклоняет неверную длину и символы вне алфавита", () => {
    expect(isReferralCode("ABCDEFG")).toBe(false);
    expect(isReferralCode("ABCDEFG0")).toBe(false); // 0 нет в base58
    expect(isReferralCode("ABCDEFGl")).toBe(false); // l нет в base58
    expect(isReferralCode("AbCd1234")).toBe(true);
  });
});
