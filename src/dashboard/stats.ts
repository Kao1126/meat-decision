import type { MealRecord } from "../db/meals";

const MS_PER_DAY = 86_400_000;
const RECENT_WINDOW_DAYS = 30;
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface DishStats {
  total: number;
  lastThirtyDays: number;
  lunches: number;
  dinners: number;
  firstEatenOn: string | null;
  lastEatenOn: string | null;
  daysSinceLast: number | null;
  // Days between different eating days, so two meals on one day don't shorten it.
  averageGapDays: number | null;
  averageRating: number | null;
  shops: { shop: string; count: number }[];
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / MS_PER_DAY);
const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

export function dishStats(meals: MealRecord[], today: string): DishStats {
  const days = [...new Set(meals.map((meal) => meal.eatenOn))].sort();
  const firstEatenOn = days[0] ?? null;
  const lastEatenOn = days.at(-1) ?? null;
  const ratings = meals.flatMap((meal) => (meal.rating === null ? [] : [meal.rating]));

  const shopCounts = new Map<string, number>();
  for (const { shop } of meals) {
    if (shop) shopCounts.set(shop, (shopCounts.get(shop) ?? 0) + 1);
  }

  return {
    total: meals.length,
    lastThirtyDays: meals.filter((meal) => daysBetween(meal.eatenOn, today) < RECENT_WINDOW_DAYS).length,
    lunches: meals.filter((meal) => meal.slot === "lunch").length,
    dinners: meals.filter((meal) => meal.slot === "dinner").length,
    firstEatenOn,
    lastEatenOn,
    daysSinceLast: lastEatenOn === null ? null : daysBetween(lastEatenOn, today),
    averageGapDays: firstEatenOn && lastEatenOn && days.length > 1 ? daysBetween(firstEatenOn, lastEatenOn) / (days.length - 1) : null,
    averageRating: ratings.length === 0 ? null : average(ratings),
    shops: [...shopCounts].map(([shop, count]) => ({ shop, count })).sort((a, b) => b.count - a.count),
  };
}

export function statsByDish(meals: MealRecord[], today: string): Map<number, DishStats> {
  const groups = Map.groupBy(meals, (meal) => meal.dishId);
  return new Map([...groups].map(([dishId, dishMeals]) => [dishId, dishStats(dishMeals, today)]));
}

export function resolveMonth(month: string | undefined, fallback: string): string {
  return month && MONTH_PATTERN.test(month) ? month : fallback;
}

export function shiftMonth(month: string, delta: number): string {
  const [year = 0, monthNumber = 1] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber - 1 + delta, 1)).toISOString().slice(0, 7);
}

// Weeks start on Sunday. Null cells pad the first and last weeks.
export function calendarWeeks(month: string): (string | null)[][] {
  const [year = 0, monthNumber = 1] = month.split("-").map(Number);
  const leadingBlanks = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay();
  const dayCount = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();

  const cells: (string | null)[] = Array(leadingBlanks).fill(null);
  for (let day = 1; day <= dayCount; day++) cells.push(`${month}-${String(day).padStart(2, "0")}`);
  while (cells.length % 7 !== 0) cells.push(null);

  return Array.from({ length: cells.length / 7 }, (_, week) => cells.slice(week * 7, week * 7 + 7));
}
