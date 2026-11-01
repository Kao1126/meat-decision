import { describe, expect, it } from "vitest";
import { type Candidate, pickSuggestions, type SuggestionRequest } from "../src/core/suggest";

const dish = (name: string, overrides: Partial<Candidate> = {}): Candidate => ({
  id: 1,
  name,
  cuisine: null,
  slot: "both",
  source: "home",
  weekendOnly: false,
  shop: null,
  wishlist: false,
  sourceUrl: null,
  note: null,
  ingredients: [],
  timesEaten: 0,
  lastEatenOn: null,
  averageRating: null,
  ...overrides,
});

const request: SuggestionRequest = {
  today: "2026-10-31",
  slot: "dinner",
  weekend: true,
  source: null,
  preferences: [],
  random: () => 0.999,
};
const names = (dishes: Candidate[]) => dishes.map((d) => d.name);
// With this random value the shuffle keeps the ranked order.
const ranked = (candidates: Candidate[], overrides: Partial<SuggestionRequest> = {}) =>
  names(pickSuggestions(candidates, { ...request, ...overrides }));

describe("pickSuggestions", () => {
  it("returns nothing when no dishes are saved", () => {
    expect(ranked([])).toEqual([]);
  });

  it("returns at most three dishes", () => {
    expect(ranked(["a", "b", "c", "d"].map((name) => dish(name)))).toHaveLength(3);
  });

  it("puts rested dishes ahead of recent ones", () => {
    const candidates = [dish("today", { lastEatenOn: "2026-10-31" }), dish("older", { lastEatenOn: "2026-10-20" }), dish("never")];
    expect(ranked(candidates)).toEqual(["never", "older", "today"]);
  });

  it("still suggests a dish eaten today when it is the only one", () => {
    expect(ranked([dish("ramen", { lastEatenOn: "2026-10-31" })])).toEqual(["ramen"]);
  });

  it("marks down dishes sharing ingredients with recent meals", () => {
    const candidates = [
      dish("recent", { ingredients: ["tofu"], lastEatenOn: "2026-10-30" }),
      dish("shares", { ingredients: ["tofu"] }),
      dish("fresh", { ingredients: ["beef"] }),
    ];
    expect(ranked(candidates).slice(0, 2)).toEqual(["fresh", "shares"]);
  });

  it("ignores ingredients from meals outside the recent window", () => {
    const candidates = [
      dish("first", { ingredients: ["tofu"] }),
      dish("second", { ingredients: ["beef"] }),
      dish("old", { ingredients: ["tofu"], lastEatenOn: "2026-10-20" }),
    ];
    expect(ranked(candidates).slice(0, 2)).toEqual(["first", "second"]);
  });

  it("marks down a cuisine eaten recently", () => {
    const candidates = [
      dish("recent", { cuisine: "chinese", lastEatenOn: "2026-10-30" }),
      dish("repeat", { cuisine: "Chinese" }),
      dish("different", { cuisine: "italian" }),
    ];
    expect(ranked(candidates).slice(0, 2)).toEqual(["different", "repeat"]);
  });

  it("does not treat two unknown cuisines as a repeat", () => {
    const candidates = [dish("recent", { lastEatenOn: "2026-10-30" }), dish("first"), dish("second", { cuisine: "italian" })];
    expect(ranked(candidates).slice(0, 2)).toEqual(["first", "second"]);
  });

  it("prefers higher rated dishes", () => {
    const candidates = [dish("low", { averageRating: 1 }), dish("unrated"), dish("high", { averageRating: 5 })];
    expect(ranked(candidates)).toEqual(["high", "unrated", "low"]);
  });

  it("only offers dishes that fit the meal", () => {
    expect(ranked([dish("sandwich", { slot: "lunch" }), dish("stew", { slot: "dinner" }), dish("rice")])).toEqual(["stew", "rice"]);
  });

  it("removes dishes matching an allergy or dislike, including partial matches", () => {
    const candidates = [
      dish("satay", { ingredients: ["peanut butter"] }),
      dish("Liver pate"),
      dish("Mapo tofu", { ingredients: ["tofu"] }),
    ];
    const preferences = [
      { kind: "allergy", value: "peanuts" },
      { kind: "dislike", value: "liver" },
    ] as const;
    expect(ranked(candidates, { preferences: [...preferences] })).toEqual(["Mapo tofu"]);
  });

  describe("weekend-only and takeout", () => {
    const stew = dish("stew", { weekendOnly: true });
    const stewOrBuy = dish("stew or buy", { weekendOnly: true, source: "either" });
    const curry = dish("curry", { source: "takeout" });
    const pasta = dish("pasta");

    it("holds weekend-only dishes back on weekdays", () => {
      expect(ranked([stew, pasta], { weekend: false })).toEqual(["pasta"]);
    });

    it("offers weekend-only dishes at the weekend", () => {
      expect(ranked([stew, pasta], { weekend: true })).toEqual(["stew", "pasta"]);
    });

    it("offers a weekend-only dish on a weekday if it can be bought", () => {
      expect(ranked([stewOrBuy], { weekend: false })).toEqual(["stew or buy"]);
      expect(ranked([stewOrBuy], { weekend: false, source: "takeout" })).toEqual(["stew or buy"]);
    });

    it("holds it back on a weekday when they want to cook", () => {
      expect(ranked([stewOrBuy], { weekend: false, source: "home" })).toEqual([]);
    });

    it("mixes cooking and takeout when they don't say", () => {
      expect(ranked([curry, pasta])).toEqual(["curry", "pasta"]);
    });

    it("only offers takeout when asked for it", () => {
      expect(ranked([curry, pasta, dish("both", { source: "either" })], { source: "takeout" })).toEqual(["curry", "both"]);
    });

    it("only offers cooking when asked for it", () => {
      expect(ranked([curry, pasta, dish("both", { source: "either" })], { source: "home" })).toEqual(["pasta", "both"]);
    });
  });

  it("prefers a try-list dish over another untried dish", () => {
    expect(ranked([dish("plain"), dish("wanted", { wishlist: true })])).toEqual(["wanted", "plain"]);
  });

  it("still filters try-list dishes by allergy", () => {
    const candidate = dish("satay", { wishlist: true, ingredients: ["peanut"] });
    expect(ranked([candidate], { preferences: [{ kind: "allergy", value: "peanut" }] })).toEqual([]);
  });

  it("never picks from below the shortlist, however the shuffle falls", () => {
    const top = ["a", "b", "c", "d", "e", "f"].map((name) => dish(name));
    const bottom = dish("eaten today", { lastEatenOn: "2026-10-31" });
    for (const value of [0, 0.25, 0.5, 0.75, 0.999]) {
      expect(ranked([bottom, ...top], { random: () => value })).not.toContain("eaten today");
    }
  });

  it("varies the picks with the random source", () => {
    const candidates = ["a", "b", "c", "d", "e", "f"].map((name) => dish(name));
    expect(ranked(candidates, { random: () => 0 })).not.toEqual(ranked(candidates));
  });
});
