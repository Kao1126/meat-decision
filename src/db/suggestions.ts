import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { suggestionSets } from "./schema";

// Long enough to ask at lunchtime and decide on dinner, short enough to forget by tomorrow.
const SUGGESTION_LIFETIME_MS = 12 * 60 * 60 * 1000;

export interface SuggestionSet {
  dishes: string[];
  shown: string[];
  slot: "lunch" | "dinner";
  source: "home" | "takeout" | null;
}

export async function loadSuggestionSet(d1: D1Database, userId: number, now: Date): Promise<SuggestionSet | null> {
  const row = await drizzle(d1).select().from(suggestionSets).where(eq(suggestionSets.userId, userId)).get();
  if (!row || now.getTime() - Date.parse(row.suggestedAt) > SUGGESTION_LIFETIME_MS) return null;
  return { dishes: row.dishes, shown: row.shown, slot: row.slot, source: row.source };
}

export async function saveSuggestionSet(d1: D1Database, userId: number, set: SuggestionSet, now: Date): Promise<void> {
  const values = { ...set, suggestedAt: now.toISOString() };
  await drizzle(d1)
    .insert(suggestionSets)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: suggestionSets.userId, set: values });
}

export async function clearSuggestionSet(d1: D1Database, userId: number): Promise<void> {
  await drizzle(d1).delete(suggestionSets).where(eq(suggestionSets.userId, userId));
}
