import { describe, expect, it } from "vitest";
import { calendarWeeks, dishStats, resolveMonth, shiftMonth, statsByDish } from "../src/dashboard/stats";
import type { MealRecord } from "../src/db/meals";

const meal = (eatenOn: string, overrides: Partial<MealRecord> = {}): MealRecord => ({
  dishId: 1,
  name: "Ramen",
  eatenOn,
  slot: "dinner",
  rating: null,
  shop: null,
  ...overrides,
});

describe("dishStats", () => {
  it("handles a dish that was never eaten", () => {
    expect(dishStats([], "2026-11-01")).toMatchObject({
      total: 0,
      lastThirtyDays: 0,
      firstEatenOn: null,
      lastEatenOn: null,
      daysSinceLast: null,
      averageGapDays: null,
      averageRating: null,
      shops: [],
    });
  });

  it("counts meals, slots and first and last days whatever the order", () => {
    const stats = dishStats([meal("2026-10-30"), meal("2026-10-20", { slot: "lunch" }), meal("2026-11-01")], "2026-11-01");
    expect(stats).toMatchObject({
      total: 3,
      lunches: 1,
      dinners: 2,
      firstEatenOn: "2026-10-20",
      lastEatenOn: "2026-11-01",
      daysSinceLast: 0,
    });
  });

  it("keeps the 30-day window to 30 days including today", () => {
    expect(dishStats([meal("2026-10-03"), meal("2026-10-02")], "2026-11-01").lastThirtyDays).toBe(1);
  });

  it("averages the gap between different days", () => {
    expect(dishStats([meal("2026-10-01"), meal("2026-10-05"), meal("2026-10-05", { slot: "lunch" }), meal("2026-10-11")], "2026-11-01").averageGapDays).toBe(5);
  });

  it("has no gap for meals all on one day", () => {
    expect(dishStats([meal("2026-10-01"), meal("2026-10-01", { slot: "lunch" })], "2026-11-01").averageGapDays).toBeNull();
  });

  it("averages only the meals that have a rating", () => {
    expect(dishStats([meal("2026-10-01", { rating: 5 }), meal("2026-10-02", { rating: 2 }), meal("2026-10-03")], "2026-11-01").averageRating).toBe(3.5);
  });

  it("counts shops, most used first", () => {
    const stats = dishStats([meal("2026-10-01", { shop: "A" }), meal("2026-10-02", { shop: "B" }), meal("2026-10-03", { shop: "B" }), meal("2026-10-04")], "2026-11-01");
    expect(stats.shops).toEqual([{ shop: "B", count: 2 }, { shop: "A", count: 1 }]);
  });
});

describe("statsByDish", () => {
  it("keeps dishes apart", () => {
    const stats = statsByDish([meal("2026-10-01"), meal("2026-10-02", { dishId: 2 }), meal("2026-10-03", { dishId: 2 })], "2026-11-01");
    expect(stats.get(1)?.total).toBe(1);
    expect(stats.get(2)?.total).toBe(2);
  });
});

describe("months", () => {
  it("lays out a month starting on Sunday with full weeks", () => {
    // 1 November 2026 is a Sunday.
    const weeks = calendarWeeks("2026-11");
    expect(weeks[0]?.[0]).toBe("2026-11-01");
    expect(weeks.at(-1)?.filter(Boolean).at(-1)).toBe("2026-11-30");
    expect(weeks.every((week) => week.length === 7)).toBe(true);
  });

  it("pads the start of a month that begins mid-week", () => {
    // 1 October 2026 is a Thursday.
    expect(calendarWeeks("2026-10")[0]?.slice(0, 5)).toEqual([null, null, null, null, "2026-10-01"]);
  });

  it("handles leap years", () => {
    expect(calendarWeeks("2028-02").flat()).toContain("2028-02-29");
    expect(calendarWeeks("2027-02").flat()).not.toContain("2027-02-29");
  });

  it("moves across year ends", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });

  it.each(["2026-13", "2026-00", "2026", "abc", "2026-11-01", undefined])("falls back for month %s", (month) => {
    expect(resolveMonth(month, "2026-05")).toBe("2026-05");
  });

  it("accepts a valid month", () => {
    expect(resolveMonth("2026-11", "2026-05")).toBe("2026-11");
  });
});
