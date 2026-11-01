import { readdirSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import type { IncomingMessage } from "../src/channels/types";
import { handleMessage } from "../src/core/handleMessage";
import type { MessageParser, ParsedMessage } from "../src/llm/types";

const message: IncomingMessage = { channel: "line", externalUserId: "U1", text: "ignored", replyContext: "token" };
// 12:00 on Saturday 31 October in Brisbane.
const now = new Date("2026-10-31T02:00:00Z");

const parsed = (overrides: Partial<ParsedMessage>): ParsedMessage => ({
  intent: "unknown",
  dishName: null,
  ingredients: [],
  cuisine: null,
  cuisineStated: false,
  shop: null,
  note: null,
  source: null,
  weekendOnly: null,
  mealSlot: null,
  eatenOn: null,
  rating: null,
  suggestionNumber: null,
  preferenceKind: null,
  preferenceValues: [],
  reply: "ok",
  ingredientsQuestion: "What's in it?",
  ...overrides,
});

let dispose: () => Promise<void>;
let db: D1Database;

const rows = async <T>(query: string) => (await db.prepare(query).all<T>()).results;

async function send(result: ParsedMessage | null, at = now, explain: MessageParser["explain"] = async () => null) {
  return handleMessage(message, {
    db,
    parser: { parse: async () => result, explain },
    timeZone: "Australia/Brisbane",
    now: at,
    random: () => 0.999,
  });
}

beforeAll(async () => {
  const proxy = await getPlatformProxy<{ DB: D1Database }>({ persist: false });
  dispose = proxy.dispose;
  db = proxy.env.DB;

  const files = readdirSync("migrations").filter((name) => name.endsWith(".sql")).sort();
  for (const file of files) {
    const statements = readFileSync(`migrations/${file}`, "utf8").split("--> statement-breakpoint");
    for (const statement of statements) await db.prepare(statement).run();
  }
});

beforeEach(async () => {
  await db.batch(["dish_ingredients", "meals", "ingredients", "dishes", "preferences", "suggestion_sets", "channel_identities", "users"].map((t) => db.prepare(`DELETE FROM ${t}`)));
});

afterAll(() => dispose());

describe("save_dish", () => {
  it("saves a dish with its ingredients", async () => {
    const reply = await send(parsed({ intent: "save_dish", dishName: "Mapo tofu", ingredients: ["tofu", " pork ", "tofu"] }));

    expect(reply).toBe("ok");
    expect(await rows("SELECT name FROM dishes")).toEqual([{ name: "Mapo tofu" }]);
    expect(await rows("SELECT name FROM ingredients ORDER BY name")).toEqual([{ name: "pork" }, { name: "tofu" }]);
    expect(await rows("SELECT * FROM dish_ingredients")).toHaveLength(2);
  });

  it("adds to an existing dish without duplicating it, ignoring case", async () => {
    await send(parsed({ intent: "save_dish", dishName: "Mapo tofu", ingredients: ["tofu"] }));
    await send(parsed({ intent: "save_dish", dishName: "mapo TOFU", ingredients: ["tofu", "pork"] }));

    expect(await rows("SELECT id FROM dishes")).toHaveLength(1);
    expect(await rows("SELECT * FROM dish_ingredients")).toHaveLength(2);
  });

  it("asks for ingredients when the dish has none", async () => {
    expect(await send(parsed({ intent: "save_dish", dishName: "Pho" }))).toBe("ok\nWhat's in it?");
  });

  it("stores non-Latin dish names", async () => {
    await send(parsed({ intent: "save_dish", dishName: "麻婆豆腐", ingredients: ["豆腐"] }));
    expect(await rows("SELECT name FROM dishes")).toEqual([{ name: "麻婆豆腐" }]);
  });
});

describe("log_meal", () => {
  it("logs a meal for a dish that isn't saved yet and asks for ingredients", async () => {
    const reply = await send(parsed({ intent: "log_meal", dishName: "Ramen", mealSlot: "lunch" }));

    expect(reply).toBe("ok\nWhat's in it?");
    expect(await rows("SELECT name FROM dishes")).toEqual([{ name: "Ramen" }]);
    expect(await rows("SELECT eaten_on, slot FROM meals")).toEqual([{ eaten_on: "2026-10-31", slot: "lunch" }]);
  });

  it("doesn't ask for ingredients the dish already has", async () => {
    await send(parsed({ intent: "save_dish", dishName: "Ramen", ingredients: ["noodles"] }));
    expect(await send(parsed({ intent: "log_meal", dishName: "ramen" }))).toBe("ok");
    expect(await rows("SELECT id FROM dishes")).toHaveLength(1);
  });

  it("keeps a past date the user gave", async () => {
    await send(parsed({ intent: "log_meal", dishName: "Ramen", eatenOn: "2026-10-30" }));
    expect(await rows("SELECT eaten_on FROM meals")).toEqual([{ eaten_on: "2026-10-30" }]);
  });

  it.each(["2026-11-01", "2026-02-30", "yesterday"])("falls back to today for %s", async (eatenOn) => {
    await send(parsed({ intent: "log_meal", dishName: "Ramen", eatenOn }));
    expect(await rows("SELECT eaten_on FROM meals")).toEqual([{ eaten_on: "2026-10-31" }]);
  });

  it("uses the local date, not the UTC date", async () => {
    // 22:00 UTC on the 31st is already 8am on 1 November in Brisbane.
    await send(parsed({ intent: "log_meal", dishName: "Ramen" }), new Date("2026-10-31T22:00:00Z"));
    expect(await rows("SELECT eaten_on, slot FROM meals")).toEqual([{ eaten_on: "2026-11-01", slot: "lunch" }]);
  });

  it("guesses dinner in the evening when no meal is named", async () => {
    await send(parsed({ intent: "log_meal", dishName: "Ramen" }), new Date("2026-10-31T09:00:00Z"));
    expect(await rows("SELECT slot FROM meals")).toEqual([{ slot: "dinner" }]);
  });
});

describe("cuisine and rating", () => {
  it("stores a rating and cuisine with the meal", async () => {
    await send(parsed({ intent: "log_meal", dishName: "Ramen", rating: 4, cuisine: "japanese" }));
    expect(await rows("SELECT rating FROM meals")).toEqual([{ rating: 4 }]);
    expect(await rows("SELECT cuisine FROM dishes")).toEqual([{ cuisine: "japanese" }]);
  });

  it.each([0, 6, 40])("drops an impossible rating of %s and still logs the meal", async (rating) => {
    await send(parsed({ intent: "log_meal", dishName: "Ramen", rating }));
    expect(await rows("SELECT rating FROM meals")).toEqual([{ rating: null }]);
  });

  it("fills a missing cuisine but keeps an existing one", async () => {
    await send(parsed({ intent: "save_dish", dishName: "Ramen" }));
    await send(parsed({ intent: "save_dish", dishName: "Ramen", cuisine: "japanese" }));
    await send(parsed({ intent: "save_dish", dishName: "Ramen", cuisine: "chinese" }));
    expect(await rows("SELECT cuisine FROM dishes")).toEqual([{ cuisine: "japanese" }]);
  });
});

describe("save_preference", () => {
  it("saves cleaned values once", async () => {
    await send(parsed({ intent: "save_preference", preferenceKind: "allergy", preferenceValues: [" Peanuts ", "peanuts", "shrimp"] }));
    await send(parsed({ intent: "save_preference", preferenceKind: "allergy", preferenceValues: ["shrimp"] }));
    expect(await rows("SELECT kind, value FROM preferences ORDER BY value")).toEqual([
      { kind: "allergy", value: "peanuts" },
      { kind: "allergy", value: "shrimp" },
    ]);
  });

  it("saves nothing without a kind or a food", async () => {
    expect(await send(parsed({ intent: "save_preference", preferenceValues: ["peanuts"] }))).toContain("Add mapo tofu");
    expect(await send(parsed({ intent: "save_preference", preferenceKind: "dislike" }))).toContain("Add mapo tofu");
    expect(await rows("SELECT id FROM preferences")).toEqual([]);
  });
});

describe("suggest", () => {
  const ask = parsed({ intent: "suggest", reply: "Add some dishes first" });
  const saveDish = (dishName: string, ingredients: string[] = []) => send(parsed({ intent: "save_dish", dishName, ingredients }));

  it("gives the LLM reply when no dishes are saved, without calling explain", async () => {
    const explain = async () => {
      throw new Error("should not be called");
    };
    expect(await send(ask, now, explain)).toBe("Add some dishes first");
  });

  it("numbers the dishes and adds the LLM's wording", async () => {
    await saveDish("Ramen", ["noodles"]);
    const reply = await send(ask, now, async () => ({ intro: "Try this:", reasons: ["Warm and filling"] }));
    expect(reply).toBe("Try this:\n1. Ramen: Warm and filling");
  });

  it("passes the LLM only the chosen dishes, with their history", async () => {
    await saveDish("Ramen", ["noodles"]);
    await send(parsed({ intent: "log_meal", dishName: "Ramen", rating: 5, eatenOn: "2026-10-20" }));
    let seen: Parameters<MessageParser["explain"]>[1] = [];
    await send(ask, now, async (_text, dishes) => {
      seen = dishes;
      return null;
    });
    expect(seen).toMatchObject([{ name: "Ramen", ingredients: ["noodles"], lastEatenOn: "2026-10-20", averageRating: 5 }]);
  });

  it("still lists the dishes when the explanation fails", async () => {
    await saveDish("Ramen", ["noodles"]);
    const reply = await send(ask, now, async () => {
      throw new Error("API down");
    });
    expect(reply).toBe("Here are some ideas:\n1. Ramen");
  });

  it("ignores extra reasons, so the LLM can't add a dish", async () => {
    await saveDish("Ramen", ["noodles"]);
    const reply = await send(ask, now, async () => ({ intro: "Try:", reasons: ["Good", "Also try pizza"] }));
    expect(reply).not.toContain("pizza");
  });

  it("never suggests a saved allergy", async () => {
    await saveDish("Satay", ["peanut sauce"]);
    await send(parsed({ intent: "save_preference", preferenceKind: "allergy", preferenceValues: ["peanut"] }));
    expect(await send(ask)).toBe("Add some dishes first");
  });

  it("warns when a dish can't be checked against allergies", async () => {
    await saveDish("Pho");
    await send(parsed({ intent: "save_preference", preferenceKind: "allergy", preferenceValues: ["peanut"] }));
    expect(await send(ask)).toContain("I don't know what's in Pho");
  });

  it("gives no allergy warning to someone with only dislikes", async () => {
    await saveDish("Pho");
    await send(parsed({ intent: "save_preference", preferenceKind: "dislike", preferenceValues: ["liver"] }));
    expect(await send(ask)).toBe("Here are some ideas:\n1. Pho");
  });

  it("keeps each user's dishes separate", async () => {
    await saveDish("Ramen");
    const other = await handleMessage(
      { ...message, externalUserId: "U2" },
      {
        db,
        parser: { parse: async () => ask, explain: async () => null },
        timeZone: "Australia/Brisbane",
        now,
      },
    );
    expect(other).toBe("Add some dishes first");
  });
});

describe("follow-ups", () => {
  const ask = parsed({ intent: "suggest", mealSlot: "dinner", reply: "Add some dishes first" });
  const more = parsed({ intent: "more_suggestions", reply: "No other dishes" });
  const accept = (suggestionNumber: number | null) => parsed({ intent: "accept_suggestion", suggestionNumber, reply: "Logged" });
  const saveDishes = async (...names: string[]) => {
    for (const dishName of names) await send(parsed({ intent: "save_dish", dishName, ingredients: ["salt"] }));
  };
  const listed = (reply: string) => reply.split("\n").slice(1).map((line) => line.replace(/^\d+\. /, ""));

  it("logs the chosen dish today, for the meal that was asked about", async () => {
    await saveDishes("Ramen", "Pho");
    const shown = listed(await send(ask));

    expect(await send(accept(2))).toBe("Logged");
    expect(await rows("SELECT d.name, m.eaten_on, m.slot FROM meals m JOIN dishes d ON d.id = m.dish_id")).toEqual([
      { name: shown[1], eaten_on: "2026-10-31", slot: "dinner" },
    ]);
  });

  it("gives the parser the numbered list for later messages", async () => {
    await saveDishes("Ramen", "Pho");
    const shown = listed(await send(ask));

    let suggestions: string[] = [];
    await handleMessage(message, {
      db,
      parser: {
        parse: async (_text, context) => {
          suggestions = context.suggestions;
          return parsed({});
        },
        explain: async () => null,
      },
      timeZone: "Australia/Brisbane",
      now,
    });
    expect(suggestions).toEqual(shown);
  });

  it("can't log the same pick twice", async () => {
    await saveDishes("Ramen");
    await send(ask);
    await send(accept(1));

    expect(await send(accept(1))).toContain("recent suggestion");
    expect(await rows("SELECT id FROM meals")).toHaveLength(1);
  });

  it.each([null, 0, 2, 1.5])("logs nothing for suggestion number %s", async (number) => {
    await saveDishes("Ramen");
    await send(ask);

    expect(await send(accept(number))).toContain("recent suggestion");
    expect(await rows("SELECT id FROM meals")).toEqual([]);
  });

  it("logs nothing when there is no list", async () => {
    await saveDishes("Ramen");
    expect(await send(accept(1))).toContain("recent suggestion");
  });

  it("forgets the list after 12 hours", async () => {
    await saveDishes("Ramen");
    await send(ask);

    expect(await send(accept(1), new Date("2026-10-31T14:01:00Z"))).toContain("recent suggestion");
    expect(await rows("SELECT id FROM meals")).toEqual([]);
  });

  it("still accepts a pick within 12 hours", async () => {
    await saveDishes("Ramen");
    await send(ask);

    await send(accept(1), new Date("2026-10-31T13:59:00Z"));
    expect(await rows("SELECT id FROM meals")).toHaveLength(1);
  });

  it("replaces the list with a newer one", async () => {
    await saveDishes("A", "B", "C", "D");
    const first = listed(await send(ask));
    const second = listed(await send(more));

    expect(first).not.toContain(second[0]);
    await send(accept(1));
    expect(await rows("SELECT d.name FROM meals m JOIN dishes d ON d.id = m.dish_id")).toEqual([{ name: second[0] }]);
  });

  it("offers different dishes until none are left, then says so", async () => {
    await saveDishes("A", "B", "C", "D");
    const first = listed(await send(ask));
    const second = listed(await send(more));

    expect(first).toHaveLength(3);
    expect(second).toHaveLength(1);
    expect(first).not.toContain(second[0]);
    expect(await send(more)).toBe("No other dishes");
  });

  it("keeps the same meal when asking for something else", async () => {
    await send(parsed({ intent: "save_dish", dishName: "Sandwich", ingredients: ["bread"] }));
    await send(parsed({ intent: "save_dish", dishName: "Stew", ingredients: ["beef"] }));
    await db.prepare("UPDATE dishes SET slot = 'dinner' WHERE name = 'Stew'").run();
    await db.prepare("UPDATE dishes SET slot = 'lunch' WHERE name = 'Sandwich'").run();

    await send(ask);
    expect(await send(more)).toBe("No other dishes");
  });

  it("treats something else with no list as a fresh ask", async () => {
    await saveDishes("Ramen");
    expect(listed(await send(more))).toEqual(["Ramen"]);
  });

  it("asks for ingredients of a picked dish that has none", async () => {
    await send(parsed({ intent: "save_dish", dishName: "Pho" }));
    await send(ask);
    expect(await send({ ...accept(1), ingredientsQuestion: "What's in pho?" })).toBe("Logged\nWhat's in pho?");
  });
});

describe("weekend-only and takeout", () => {
  const monday = new Date("2026-11-02T02:00:00Z");
  const ask = parsed({ intent: "suggest", reply: "Nothing suitable" });
  const dishRow = async () => (await rows("SELECT source, weekend_only FROM dishes"))[0];
  const listed = (reply: string) => reply.split("\n").slice(1).map((line) => line.replace(/^\d+\. /, ""));

  it("defaults a new dish to home cooking on any day", async () => {
    await send(parsed({ intent: "save_dish", dishName: "Pasta" }));
    expect(await dishRow()).toEqual({ source: "home", weekend_only: 0 });
  });

  it("saves both on a new dish", async () => {
    await send(parsed({ intent: "save_dish", dishName: "Stew", source: "either", weekendOnly: true }));
    expect(await dishRow()).toEqual({ source: "either", weekend_only: 1 });
  });

  it("changes an existing dish, and a later message can undo it", async () => {
    await send(parsed({ intent: "save_dish", dishName: "Stew" }));
    await send(parsed({ intent: "save_dish", dishName: "stew", weekendOnly: true, source: "takeout" }));
    expect(await dishRow()).toEqual({ source: "takeout", weekend_only: 1 });

    await send(parsed({ intent: "save_dish", dishName: "stew", weekendOnly: false }));
    expect(await dishRow()).toEqual({ source: "takeout", weekend_only: 0 });
  });

  it("leaves a dish alone when the message doesn't mention either", async () => {
    await send(parsed({ intent: "save_dish", dishName: "Stew", weekendOnly: true, source: "takeout" }));
    await send(parsed({ intent: "log_meal", dishName: "Stew" }));
    expect(await dishRow()).toEqual({ source: "takeout", weekend_only: 1 });
  });

  it("treats a dish as either once it has been both cooked and bought", async () => {
    await send(parsed({ intent: "save_dish", dishName: "Ramen" }));
    await send(parsed({ intent: "log_meal", dishName: "Ramen", source: "takeout" }));
    expect(await dishRow()).toEqual({ source: "either", weekend_only: 0 });
  });

  it("uses the local day of the week", async () => {
    await send(parsed({ intent: "save_dish", dishName: "Stew", weekendOnly: true }));
    expect(await send(ask, monday)).toBe("Nothing suitable");
    // 15:00 UTC on Friday is already Saturday in Brisbane.
    expect(await send(ask, new Date("2026-11-06T15:00:00Z"))).toContain("Stew");
  });

  it("keeps to takeout when asking for something else", async () => {
    for (const name of ["A", "B", "C", "D"]) await send(parsed({ intent: "save_dish", dishName: name, source: "takeout" }));
    await send(parsed({ intent: "save_dish", dishName: "Pasta" }));

    await send({ ...ask, source: "takeout" });
    const next = listed(await send(parsed({ intent: "more_suggestions", reply: "No more" })));
    expect(next).not.toContain("Pasta");
    expect(next).toHaveLength(1);
  });

  it("lets them switch to takeout on something else", async () => {
    await send(parsed({ intent: "save_dish", dishName: "Pasta" }));
    await send(parsed({ intent: "save_dish", dishName: "Curry", source: "takeout" }));

    await send({ ...ask, source: "home" });
    expect(listed(await send(parsed({ intent: "more_suggestions", source: "takeout" })))).toEqual(["Curry"]);
  });

  it("doesn't change a dish when picking it from a list", async () => {
    await send(parsed({ intent: "save_dish", dishName: "Curry", source: "takeout" }));
    await send({ ...ask, source: "takeout" });
    await send(parsed({ intent: "accept_suggestion", suggestionNumber: 1, source: "home" }));
    expect(await dishRow()).toEqual({ source: "takeout", weekend_only: 0 });
  });
});

describe("try list", () => {
  const link = "https://www.instagram.com/reel/abc123/";
  const wish = (overrides: Partial<ParsedMessage> = {}) =>
    parsed({ intent: "save_wishlist", dishName: "Beef noodles", note: "Rich broth", reply: "Added", ...overrides });
  const sendLink = (result: ParsedMessage, text = `look ${link}`, fetchLink = async () => null as string | null) =>
    handleMessage({ ...message, text }, { db, parser: { parse: async () => result, explain: async () => null }, timeZone: "Australia/Brisbane", now, fetchLink });
  const wishRow = async () => (await rows("SELECT name, wishlist, source_url, note FROM dishes"))[0];

  it("saves a description without a link", async () => {
    expect(await send(wish())).toBe("Added");
    expect(await wishRow()).toEqual({ name: "Beef noodles", wishlist: 1, source_url: null, note: "Rich broth" });
  });

  it("stores the link from the message itself", async () => {
    await sendLink(wish());
    expect(await wishRow()).toMatchObject({ wishlist: 1, source_url: link });
  });

  it("treats a dish saved with a link as a try-list dish", async () => {
    const reply = await sendLink(parsed({ intent: "save_dish", dishName: "Beef noodles", reply: "Saved" }));
    expect(reply).toBe("Saved");
    expect(await wishRow()).toMatchObject({ wishlist: 1, source_url: link });
  });

  it("doesn't ask for ingredients", async () => {
    expect(await send(wish())).toBe("Added");
  });

  it("gives the parser what the link shows", async () => {
    let seen: string | null = null;
    await handleMessage({ ...message, text: link }, {
      db,
      parser: {
        parse: async (_text, context) => {
          seen = context.linkPreview;
          return wish();
        },
        explain: async () => null,
      },
      timeZone: "Australia/Brisbane",
      now,
      fetchLink: async () => "Best beef noodles",
    });
    expect(seen).toBe("Best beef noodles");
  });

  it("asks for a name when a link shows no dish", async () => {
    expect(await sendLink(wish({ dishName: null }))).toContain("couldn't tell which dish");
    expect(await rows("SELECT id FROM dishes")).toEqual([]);
  });

  it("is suggested with its label and link", async () => {
    await sendLink(wish());
    expect(await send(parsed({ intent: "suggest" }))).toBe(`Here are some ideas:\n1. Beef noodles (try list)\n${link}`);
  });

  it("leaves the list once it's eaten", async () => {
    await send(wish());
    await send(parsed({ intent: "log_meal", dishName: "beef noodles" }));
    expect(await wishRow()).toMatchObject({ wishlist: 0, note: "Rich broth" });
  });

  it("leaves the list when picked from suggestions", async () => {
    await send(wish());
    await send(parsed({ intent: "suggest" }));
    await send(parsed({ intent: "accept_suggestion", suggestionNumber: 1 }));
    expect(await wishRow()).toMatchObject({ wishlist: 0 });
  });

  it("adds an existing dish to the list without duplicating it", async () => {
    await send(parsed({ intent: "save_dish", dishName: "Beef Noodles" }));
    await send(wish());
    expect(await rows("SELECT wishlist FROM dishes")).toEqual([{ wishlist: 1 }]);
  });
});

describe("takeout shops", () => {
  const dishShop = async () => (await rows("SELECT source, shop FROM dishes"))[0];
  const mealShops = async () => (await rows<{ shop: string | null }>("SELECT shop FROM meals ORDER BY id")).map((m) => m.shop);
  const ask = parsed({ intent: "suggest", reply: "Nothing suitable" });

  it("saves the shop and treats the dish as takeout", async () => {
    await send(parsed({ intent: "save_dish", dishName: "Curry", shop: " Thai Corner " }));
    expect(await dishShop()).toEqual({ source: "takeout", shop: "Thai Corner" });
  });

  it("records the shop on the meal and the dish", async () => {
    await send(parsed({ intent: "log_meal", dishName: "Curry", source: "takeout", shop: "Thai Corner" }));
    expect(await mealShops()).toEqual(["Thai Corner"]);
    expect(await dishShop()).toEqual({ source: "takeout", shop: "Thai Corner" });
  });

  it("marks a cooked dish as either when it's bought from a shop", async () => {
    await send(parsed({ intent: "save_dish", dishName: "Ramen" }));
    await send(parsed({ intent: "log_meal", dishName: "Ramen", shop: "Ippudo" }));
    expect(await dishShop()).toEqual({ source: "either", shop: "Ippudo" });
  });

  it("keeps each meal's shop when the dish moves to a new one", async () => {
    await send(parsed({ intent: "log_meal", dishName: "Curry", shop: "Old Shop" }));
    await send(parsed({ intent: "log_meal", dishName: "Curry", shop: "New Shop" }));
    expect(await mealShops()).toEqual(["Old Shop", "New Shop"]);
    expect(await dishShop()).toEqual({ source: "takeout", shop: "New Shop" });
  });

  it("reuses the dish's shop when a takeout dish is logged without one", async () => {
    await send(parsed({ intent: "save_dish", dishName: "Curry", shop: "Thai Corner" }));
    await send(parsed({ intent: "log_meal", dishName: "Curry" }));
    expect(await mealShops()).toEqual(["Thai Corner"]);
  });

  it("gives no shop to a home-cooked meal of a dish that can also be bought", async () => {
    await send(parsed({ intent: "save_dish", dishName: "Ramen", source: "either", shop: "Ippudo" }));
    await send(parsed({ intent: "log_meal", dishName: "Ramen", source: "home" }));
    expect(await mealShops()).toEqual([null]);
  });

  it("shows the shop in suggestions and logs it when picked from a takeout list", async () => {
    await send(parsed({ intent: "save_dish", dishName: "Ramen", source: "either", shop: "Ippudo" }));
    expect(await send({ ...ask, source: "takeout" })).toBe("Here are some ideas:\n1. Ramen (Ippudo)");

    await send(parsed({ intent: "accept_suggestion", suggestionNumber: 1 }));
    expect(await mealShops()).toEqual(["Ippudo"]);
  });

  it("logs no shop when a dish that can be either is picked from a home list", async () => {
    await send(parsed({ intent: "save_dish", dishName: "Ramen", source: "either", shop: "Ippudo" }));
    await send({ ...ask, source: "home" });
    await send(parsed({ intent: "accept_suggestion", suggestionNumber: 1 }));
    expect(await mealShops()).toEqual([null]);
  });
});

describe("ingredients question for bought food", () => {
  it("isn't asked when saving a takeout dish", async () => {
    expect(await send(parsed({ intent: "save_dish", dishName: "Curry", source: "takeout" }))).toBe("ok");
    expect(await send(parsed({ intent: "save_dish", dishName: "Pad thai", shop: "Thai Corner" }))).toBe("ok");
  });

  it("isn't asked when logging a bought meal, even of a dish that's also cooked", async () => {
    await send(parsed({ intent: "save_dish", dishName: "Ramen" }));
    expect(await send(parsed({ intent: "log_meal", dishName: "Ramen", source: "takeout" }))).toBe("ok");
  });

  it("isn't asked when picking from a takeout list", async () => {
    await send(parsed({ intent: "save_dish", dishName: "Curry", source: "takeout" }));
    await send(parsed({ intent: "suggest", source: "takeout" }));
    expect(await send(parsed({ intent: "accept_suggestion", suggestionNumber: 1 }))).toBe("ok");
  });

  it("is still asked for a dish that can be cooked or bought, when saving it", async () => {
    expect(await send(parsed({ intent: "save_dish", dishName: "Ramen", source: "either" }))).toBe("ok\nWhat's in it?");
  });
});

describe("cuisine corrections", () => {
  it("replaces a saved cuisine when the user states one", async () => {
    await send(parsed({ intent: "save_dish", dishName: "Pad kra pao", cuisine: "chinese" }));
    await send(parsed({ intent: "save_dish", dishName: "Pad kra pao", cuisine: "thai", cuisineStated: true }));
    expect(await rows("SELECT cuisine FROM dishes")).toEqual([{ cuisine: "thai" }]);
  });
});

describe("fixed replies", () => {
  const sendChinese = (result: ParsedMessage | null, explain: MessageParser["explain"] = async () => null) =>
    handleMessage(
      { ...message, text: "第一個" },
      { db, parser: { parse: async () => result, explain }, timeZone: "Australia/Brisbane", now },
    );

  it("answers in Chinese when there's nothing to pick from", async () => {
    expect(await sendChinese(parsed({ intent: "accept_suggestion", suggestionNumber: 1 }))).toContain("目前沒有可以選的推薦");
  });

  it("answers in Chinese when parsing fails", async () => {
    expect(await sendChinese(null)).toContain("抱歉，我沒聽懂");
  });

  it("uses Chinese for the list intro and allergy warning", async () => {
    await send(parsed({ intent: "save_dish", dishName: "河粉" }));
    await send(parsed({ intent: "save_preference", preferenceKind: "allergy", preferenceValues: ["花生"] }));
    expect(await sendChinese(parsed({ intent: "suggest" }))).toBe(
      "這裡有幾個選擇：\n1. 河粉\n我不知道河粉的食材，所以無法確認是否含有你的過敏原。",
    );
  });
});

describe("other messages", () => {
  it("returns the LLM reply without saving anything", async () => {
    expect(await send(parsed({ intent: "unknown", reply: "I can save dishes" }))).toBe("I can save dishes");
    expect(await rows("SELECT id FROM dishes")).toEqual([]);
  });

  it("gives a help message when parsing fails", async () => {
    expect(await send(null)).toContain("Add mapo tofu");
  });

  it("saves nothing when a dish name is missing", async () => {
    expect(await send(parsed({ intent: "log_meal", dishName: "  " }))).toContain("Add mapo tofu");
    expect(await rows("SELECT id FROM meals")).toEqual([]);
  });
});
