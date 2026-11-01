import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Preference } from "../core/suggest";
import { preferences } from "./schema";

export async function savePreferences(
  d1: D1Database,
  userId: number,
  kind: Preference["kind"],
  values: string[],
): Promise<void> {
  await drizzle(d1)
    .insert(preferences)
    .values(values.map((value) => ({ userId, kind, value })))
    .onConflictDoNothing();
}

export async function loadPreferences(d1: D1Database, userId: number): Promise<Preference[]> {
  const rows = await drizzle(d1)
    .select({ kind: preferences.kind, value: preferences.value })
    .from(preferences)
    .where(and(eq(preferences.userId, userId), inArray(preferences.kind, ["allergy", "dislike"])));
  return rows as Preference[];
}
