import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Candidate } from "../core/suggest";
import { dishes, dishIngredients, ingredients, meals } from "./schema";

function cleanNames(names: string[]): string[] {
  return [...new Set(names.map((name) => name.trim()).filter(Boolean))];
}

const savedColumns = { id: dishes.id, cuisine: dishes.cuisine, source: dishes.source, shop: dishes.shop };

export interface DishDetails {
  cuisine?: string | null;
  // The user said this themselves, so it replaces a cuisine the LLM guessed earlier.
  cuisineStated?: boolean;
  source?: Candidate["source"] | null;
  weekendOnly?: boolean | null;
  shop?: string | null;
  wishlist?: boolean;
  sourceUrl?: string | null;
  note?: string | null;
  // A logged meal shows one way of getting a dish, so it adds to the others.
  addSource?: boolean;
}

// Adds to a dish's ingredients and never removes any, so a partial list is safe.
export async function saveDish(
  d1: D1Database,
  userId: number,
  name: string,
  ingredientNames: string[],
  details: DishDetails = {},
): Promise<{
  dishId: number;
  ingredientCount: number;
  created: boolean;
  source: Candidate["source"];
  shop: string | null;
}> {
  const { cuisine = null, cuisineStated = false, weekendOnly = null, addSource = false } = details;
  const { wishlist = false, sourceUrl = null } = details;
  const shop = details.shop?.trim() || null;
  const note = details.note?.trim() || null;
  // Naming a shop means it was bought, even if the message doesn't say takeout.
  const source = details.source ?? (shop ? "takeout" : null);
  const db = drizzle(d1);
  const dishName = name.trim();
  const matchesName = and(eq(dishes.userId, userId), sql`lower(${dishes.name}) = lower(${dishName})`);

  const inserted = await db
    .insert(dishes)
    .values({
      userId,
      name: dishName,
      cuisine,
      source: source ?? "home",
      weekendOnly: weekendOnly ?? false,
      shop,
      wishlist,
      sourceUrl,
      note,
    })
    .onConflictDoNothing()
    .returning(savedColumns)
    .get();
  const dish = inserted ?? (await db.select(savedColumns).from(dishes).where(matchesName).get());
  if (!dish) throw new Error(`Could not save dish for user ${userId}`);

  const changes: Partial<typeof dishes.$inferInsert> = {};
  if (!inserted) {
    if (cuisine && (cuisineStated || !dish.cuisine)) changes.cuisine = cuisine;
    if (source && source !== dish.source) changes.source = addSource ? "either" : source;
    if (weekendOnly !== null) changes.weekendOnly = weekendOnly;
    if (shop) changes.shop = shop;
    if (wishlist) changes.wishlist = true;
    if (sourceUrl) changes.sourceUrl = sourceUrl;
    if (note) changes.note = note;
    if (Object.keys(changes).length > 0) await db.update(dishes).set(changes).where(eq(dishes.id, dish.id));
  }

  const cleaned = cleanNames(ingredientNames);
  if (cleaned.length > 0) {
    await db
      .insert(ingredients)
      .values(cleaned.map((ingredient) => ({ userId, name: ingredient })))
      .onConflictDoNothing();
    const rows = await db
      .select({ id: ingredients.id })
      .from(ingredients)
      .where(and(eq(ingredients.userId, userId), inArray(ingredients.name, cleaned)));
    await db
      .insert(dishIngredients)
      .values(rows.map((row) => ({ dishId: dish.id, ingredientId: row.id })))
      .onConflictDoNothing();
  }

  const count = await db
    .select({ value: sql<number>`count(*)` })
    .from(dishIngredients)
    .where(eq(dishIngredients.dishId, dish.id))
    .get();

  return {
    dishId: dish.id,
    ingredientCount: count?.value ?? 0,
    created: Boolean(inserted),
    source: changes.source ?? dish.source,
    shop: changes.shop ?? dish.shop,
  };
}

export async function removeFromWishlist(d1: D1Database, dishId: number): Promise<void> {
  await drizzle(d1).update(dishes).set({ wishlist: false }).where(eq(dishes.id, dishId));
}

export async function loadCandidates(d1: D1Database, userId: number): Promise<Candidate[]> {
  const db = drizzle(d1);
  const [dishRows, ingredientRows, mealStats] = await Promise.all([
    db
      .select({
        id: dishes.id,
        name: dishes.name,
        cuisine: dishes.cuisine,
        slot: dishes.slot,
        source: dishes.source,
        weekendOnly: dishes.weekendOnly,
        shop: dishes.shop,
        wishlist: dishes.wishlist,
        sourceUrl: dishes.sourceUrl,
        note: dishes.note,
      })
      .from(dishes)
      .where(eq(dishes.userId, userId)),
    db
      .select({ dishId: dishIngredients.dishId, name: ingredients.name })
      .from(dishIngredients)
      .innerJoin(ingredients, eq(ingredients.id, dishIngredients.ingredientId))
      .where(eq(ingredients.userId, userId)),
    db
      .select({
        dishId: meals.dishId,
        timesEaten: sql<number>`count(*)`,
        lastEatenOn: sql<string>`max(${meals.eatenOn})`,
        averageRating: sql<number | null>`avg(${meals.rating})`,
      })
      .from(meals)
      .where(eq(meals.userId, userId))
      .groupBy(meals.dishId),
  ]);

  return dishRows.map((dish) => {
    const stats = mealStats.find((row) => row.dishId === dish.id);
    return {
      ...dish,
      ingredients: ingredientRows.filter((row) => row.dishId === dish.id).map((row) => row.name),
      timesEaten: stats?.timesEaten ?? 0,
      lastEatenOn: stats?.lastEatenOn ?? null,
      averageRating: stats?.averageRating ?? null,
    };
  });
}
