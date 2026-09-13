import { describe, expect, it } from "vitest";
import { nextUtcMidnight, shiftDate, utcDateString } from "./clock";
import { dailyBonusFor } from "./daily-claim.service";
import { streakDto } from "./users.service";

describe("dailyBonusFor", () => {
  it("дни 1–6 → 5, день 7+ → 15", () => {
    expect([1, 2, 3, 4, 5, 6].map(dailyBonusFor)).toEqual([5n, 5n, 5n, 5n, 5n, 5n]);
    expect([7, 8, 30].map(dailyBonusFor)).toEqual([15n, 15n, 15n]);
  });
});

describe("clock helpers", () => {
  it("UTC-дата и сдвиг через границы месяца/года", () => {
    expect(utcDateString(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12-31");
    expect(shiftDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28");
    expect(nextUtcMidnight(new Date("2026-03-01T15:00:00Z")).toISOString()).toBe(
      "2026-03-02T00:00:00.000Z",
    );
  });
});

describe("streakDto", () => {
  const base = { userId: "u", best: 9, updatedAt: new Date() };
  it("сегодня отмечено → days=current, todayClaimed", () => {
    expect(streakDto({ ...base, current: 3, lastClaimDate: "2026-03-05" }, "2026-03-05")).toEqual({
      days: 3,
      todayClaimed: true,
    });
  });
  it("вчера отмечено → серия жива, сегодня не отмечено", () => {
    expect(streakDto({ ...base, current: 3, lastClaimDate: "2026-03-04" }, "2026-03-05")).toEqual({
      days: 3,
      todayClaimed: false,
    });
  });
  it("пропуск дня или нет стрика → 0", () => {
    expect(streakDto({ ...base, current: 3, lastClaimDate: "2026-03-03" }, "2026-03-05")).toEqual({
      days: 0,
      todayClaimed: false,
    });
    expect(streakDto(null, "2026-03-05")).toEqual({ days: 0, todayClaimed: false });
  });
});
