const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LAST_LUNCH_HOUR = 15;

export interface LocalTime {
  date: string;
  weekday: string;
  hour: number;
}

export function localTime(now: Date, timeZone: string): LocalTime {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";

  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    weekday: part("weekday"),
    hour: Number(part("hour")),
  };
}

// Falls back to today when the LLM gives an impossible date or one in the future.
export function resolveEatenOn(eatenOn: string | null, today: string): string {
  if (!eatenOn || !DATE_PATTERN.test(eatenOn) || eatenOn > today) return today;

  const parsed = new Date(`${eatenOn}T00:00:00Z`);
  const isRealDate = !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(eatenOn);
  return isRealDate ? eatenOn : today;
}

export function isWeekend(weekday: string): boolean {
  return weekday === "Saturday" || weekday === "Sunday";
}

export function defaultSlot(hour: number): "lunch" | "dinner" {
  return hour <= LAST_LUNCH_HOUR ? "lunch" : "dinner";
}
