const SUGGESTION_COUNT = 3;
// Picks come at random from this many top dishes, so answers vary between asks.
const SHORTLIST_SIZE = 6;
const RECENT_DAYS = 3;
const FULLY_RESTED_DAYS = 14;
const MS_PER_DAY = 86_400_000;

const RECENCY_WEIGHT = 3;
const INGREDIENT_OVERLAP_WEIGHT = 1;
const CUISINE_REPEAT_WEIGHT = 0.5;
const RATING_WEIGHT = 1;
const WISHLIST_BONUS = 0.5;

export interface Candidate {
  id: number;
  name: string;
  cuisine: string | null;
  slot: "lunch" | "dinner" | "both";
  source: "home" | "takeout" | "either";
  weekendOnly: boolean;
  shop: string | null;
  wishlist: boolean;
  sourceUrl: string | null;
  note: string | null;
  ingredients: string[];
  timesEaten: number;
  lastEatenOn: string | null;
  averageRating: number | null;
}

export interface Preference {
  kind: "allergy" | "dislike";
  value: string;
}

export interface SuggestionRequest {
  today: string;
  slot: "lunch" | "dinner";
  weekend: boolean;
  // Null means they didn't say, so both cooking and takeout are fine.
  source: "home" | "takeout" | null;
  preferences: Preference[];
  random: () => number;
}

const daysBetween = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / MS_PER_DAY;
const normalize = (value: string) => value.trim().toLowerCase();

// Matches both ways, on substrings and without a plural ending, so "peanuts" rules out
// "peanut butter" and "peanut". Over-matching only hides a dish, while under-matching
// could serve an allergen.
function matchesPreference(dish: Candidate, value: string): boolean {
  const target = normalize(value);
  const stem = target.replace(/e?s$/, "") || target;
  return [dish.name, ...dish.ingredients].map(normalize).some((term) => term.includes(stem) || target.includes(term));
}

function fitsOccasion(dish: Candidate, { source, weekend }: SuggestionRequest): boolean {
  if (source === "takeout") return dish.source !== "home";
  if (source === "home" && dish.source === "takeout") return false;

  const wouldBeCooked = source === "home" || dish.source === "home";
  return weekend || !dish.weekendOnly || !wouldBeCooked;
}

function score(dish: Candidate, today: string, recentDishes: Candidate[]): number {
  const recency = dish.lastEatenOn === null ? 1 : Math.min(daysBetween(dish.lastEatenOn, today), FULLY_RESTED_DAYS) / FULLY_RESTED_DAYS;

  const recentIngredients = new Set(recentDishes.flatMap((recent) => recent.ingredients.map(normalize)));
  const shared = dish.ingredients.filter((ingredient) => recentIngredients.has(normalize(ingredient))).length;
  const overlap = dish.ingredients.length === 0 ? 0 : shared / dish.ingredients.length;

  const cuisine = dish.cuisine && normalize(dish.cuisine);
  const cuisineRepeated = recentDishes.some((recent) => recent.cuisine && normalize(recent.cuisine) === cuisine);

  // 3 out of 5 is neutral, so an unrated dish neither gains nor loses.
  const rating = dish.averageRating === null ? 0 : (dish.averageRating - 3) / 2;

  return (
    recency * RECENCY_WEIGHT -
    overlap * INGREDIENT_OVERLAP_WEIGHT -
    (cuisineRepeated ? CUISINE_REPEAT_WEIGHT : 0) +
    rating * RATING_WEIGHT +
    (dish.wishlist ? WISHLIST_BONUS : 0)
  );
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  return shuffled;
}

export function pickSuggestions(candidates: Candidate[], request: SuggestionRequest): Candidate[] {
  const { today, slot, preferences, random } = request;
  const recentDishes = candidates.filter(
    (dish) => dish.lastEatenOn !== null && daysBetween(dish.lastEatenOn, today) <= RECENT_DAYS,
  );

  const shortlist = candidates
    .filter((dish) => dish.slot === "both" || dish.slot === slot)
    .filter((dish) => fitsOccasion(dish, request))
    .filter((dish) => !preferences.some((preference) => matchesPreference(dish, preference.value)))
    .map((dish) => ({ dish, score: score(dish, today, recentDishes) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, SHORTLIST_SIZE)
    .map(({ dish }) => dish);

  return shuffle(shortlist, random).slice(0, SUGGESTION_COUNT);
}
