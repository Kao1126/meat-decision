import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const timestamp = (name: string) =>
  text(name)
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`);

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  createdAt: timestamp("created_at"),
});

// One person can be reached on several channels, so their data follows them.
export const channelIdentities = sqliteTable(
  "channel_identities",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channel: text("channel", { enum: ["line", "whatsapp"] }).notNull(),
    externalId: text("external_id").notNull(),
    createdAt: timestamp("created_at"),
  },
  (t) => [uniqueIndex("channel_identities_channel_external").on(t.channel, t.externalId)],
);

export const dishes = sqliteTable(
  "dishes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    cuisine: text("cuisine"),
    tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default([]),
    slot: text("slot", { enum: ["lunch", "dinner", "both"] }).notNull().default("both"),
    // How the user gets this dish: cooked at home, bought, or sometimes each.
    source: text("source", { enum: ["home", "takeout", "either"] }).notNull().default("home"),
    // Takes too long to cook on a weekday. Doesn't stop it being bought.
    weekendOnly: integer("weekend_only", { mode: "boolean" }).notNull().default(false),
    // The takeout shop last used for this dish.
    shop: text("shop"),
    // On the try list until the first time it's eaten.
    wishlist: integer("wishlist", { mode: "boolean" }).notNull().default(false),
    sourceUrl: text("source_url"),
    note: text("note"),
    createdAt: timestamp("created_at"),
  },
  (t) => [uniqueIndex("dishes_user_name").on(t.userId, sql`lower(${t.name})`)],
);

export const ingredients = sqliteTable(
  "ingredients",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
  },
  (t) => [uniqueIndex("ingredients_user_name").on(t.userId, t.name)],
);

export const dishIngredients = sqliteTable(
  "dish_ingredients",
  {
    dishId: integer("dish_id")
      .notNull()
      .references(() => dishes.id, { onDelete: "cascade" }),
    ingredientId: integer("ingredient_id")
      .notNull()
      .references(() => ingredients.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.dishId, t.ingredientId] }),
    index("dish_ingredients_ingredient").on(t.ingredientId),
  ],
);

export const meals = sqliteTable(
  "meals",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    dishId: integer("dish_id")
      .notNull()
      .references(() => dishes.id, { onDelete: "cascade" }),
    // The day it was eaten (YYYY-MM-DD), which can differ from when it was reported.
    eatenOn: text("eaten_on").notNull(),
    slot: text("slot", { enum: ["lunch", "dinner"] }).notNull(),
    rating: integer("rating"),
    // Where this meal was bought. Null if it was cooked or the shop isn't known.
    shop: text("shop"),
    loggedAt: timestamp("logged_at"),
  },
  (t) => [
    index("meals_user_eaten_on").on(t.userId, t.eatenOn),
    check("meals_rating_range", sql`${t.rating} IS NULL OR ${t.rating} BETWEEN 1 AND 5`),
  ],
);

// The numbered list the user last saw, so a later "the second one" can be resolved.
export const suggestionSets = sqliteTable("suggestion_sets", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  dishes: text("dishes", { mode: "json" }).$type<string[]>().notNull(),
  // Everything offered since the first ask, so "something else" keeps moving on.
  shown: text("shown", { mode: "json" }).$type<string[]>().notNull(),
  slot: text("slot", { enum: ["lunch", "dinner"] }).notNull(),
  // What they asked for, so "something else" stays with takeout or home cooking.
  source: text("source", { enum: ["home", "takeout"] }),
  suggestedAt: text("suggested_at").notNull(),
});

export const preferences = sqliteTable(
  "preferences",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["allergy", "dislike", "rule"] }).notNull(),
    value: text("value").notNull(),
    createdAt: timestamp("created_at"),
  },
  (t) => [uniqueIndex("preferences_user_kind_value").on(t.userId, t.kind, t.value)],
);
