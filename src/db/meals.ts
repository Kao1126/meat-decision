import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { dishes, meals } from "./schema";

export interface MealRecord {
  dishId: number;
  name: string;
  eatenOn: string;
  slot: "lunch" | "dinner";
  rating: number | null;
  shop: string | null;
}

// Newest first.
export async function loadMeals(d1: D1Database, userId: number): Promise<MealRecord[]> {
  return drizzle(d1)
    .select({
      dishId: meals.dishId,
      name: dishes.name,
      eatenOn: meals.eatenOn,
      slot: meals.slot,
      rating: meals.rating,
      shop: meals.shop,
    })
    .from(meals)
    .innerJoin(dishes, eq(dishes.id, meals.dishId))
    .where(eq(meals.userId, userId))
    .orderBy(desc(meals.eatenOn), desc(meals.id));
}

export async function logMeal(
  d1: D1Database,
  meal: {
    userId: number;
    dishId: number;
    eatenOn: string;
    slot: "lunch" | "dinner";
    rating: number | null;
    shop: string | null;
  },
): Promise<void> {
  await drizzle(d1).insert(meals).values(meal);
}
