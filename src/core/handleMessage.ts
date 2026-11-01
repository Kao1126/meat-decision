import type { IncomingMessage } from "../channels/types";
import { loadCandidates, removeFromWishlist, saveDish } from "../db/dishes";
import { logMeal } from "../db/meals";
import { loadPreferences, savePreferences } from "../db/preferences";
import { clearSuggestionSet, loadSuggestionSet, saveSuggestionSet, type SuggestionSet } from "../db/suggestions";
import { findOrCreateUser } from "../db/users";
import { extractLink, fetchLinkPreview, type LinkFetcher } from "../links/preview";
import type { MessageParser, ParsedMessage, SuggestionText } from "../llm/types";
import { defaultSlot, isWeekend, type LocalTime, localTime, resolveEatenOn } from "./dates";
import { type Messages, messagesFor } from "./messages";
import { type Candidate, pickSuggestions } from "./suggest";

export interface Dependencies {
  db: D1Database;
  parser: MessageParser;
  timeZone: string;
  now?: Date;
  random?: () => number;
  fetchLink?: LinkFetcher;
}

export async function handleMessage(message: IncomingMessage, deps: Dependencies): Promise<string> {
  const userId = await findOrCreateUser(deps.db, message.channel, message.externalUserId);
  const texts = messagesFor(message.text);
  const now = deps.now ?? new Date();
  const time = localTime(now, deps.timeZone);
  const suggestionSet = await loadSuggestionSet(deps.db, userId, now);
  const link = extractLink(message.text);
  const linkPreview = link ? await (deps.fetchLink ?? fetchLinkPreview)(link) : null;

  const parsed = await deps.parser.parse(message.text, {
    today: time.date,
    weekday: time.weekday,
    suggestions: suggestionSet?.dishes ?? [],
    linkPreview,
  });
  console.log("Parsed message", parsed && { intent: parsed.intent, linkRead: Boolean(linkPreview), source: parsed.source, suggestionNumber: parsed.suggestionNumber, preferenceKind: parsed.preferenceKind, preferenceCount: parsed.preferenceValues.length });
  if (!parsed) return texts.notUnderstood;

  const dishName = parsed.dishName?.trim();
  if ((parsed.intent === "save_dish" || parsed.intent === "log_meal") && !dishName) return texts.notUnderstood;

  // A dish sent with a link is something to try, however the LLM labelled it.
  if (parsed.intent === "save_wishlist" || (parsed.intent === "save_dish" && link)) {
    if (!dishName) return link ? texts.linkUnclear : texts.notUnderstood;
    await saveDish(deps.db, userId, dishName, parsed.ingredients, { ...parsed, wishlist: true, sourceUrl: link });
    return parsed.reply;
  }

  if (parsed.intent === "save_dish") {
    const { ingredientCount, source } = await saveDish(deps.db, userId, dishName!, parsed.ingredients, parsed);
    return withIngredientsQuestion(parsed.reply, parsed, ingredientCount, source === "takeout");
  }

  if (parsed.intent === "log_meal") {
    return logParsedMeal(deps.db, userId, dishName!, parsed, time, texts);
  }

  if (parsed.intent === "save_preference") {
    const values = [...new Set(parsed.preferenceValues.map((value) => value.trim().toLowerCase()).filter(Boolean))];
    if (!parsed.preferenceKind || values.length === 0) return texts.notUnderstood;
    await savePreferences(deps.db, userId, parsed.preferenceKind, values);
    return parsed.reply;
  }

  if (parsed.intent === "accept_suggestion") {
    const listed = suggestionSet?.dishes ?? [];
    const byNumber = listed[(parsed.suggestionNumber ?? 0) - 1];
    const byName = listed.find((name) => name.toLowerCase() === dishName?.toLowerCase());
    if (byNumber && byName && byNumber !== byName) return texts.pickUnclear;

    const chosen = byName ?? byNumber;
    // Cleared first, so repeating the message can't log the meal twice.
    if (!suggestionSet || !chosen || !(await clearSuggestionSet(deps.db, userId))) return texts.noSuggestion;

    const meal = {
      ...parsed,
      ingredients: [],
      cuisine: null,
      source: null,
      weekendOnly: null,
      eatenOn: null,
      mealSlot: suggestionSet.slot,
    };
    return logParsedMeal(deps.db, userId, chosen, meal, time, texts, suggestionSet.source === "takeout");
  }

  if (parsed.intent === "suggest") {
    const slot = parsed.mealSlot ?? defaultSlot(time.hour);
    return suggest(message.text, userId, parsed, { slot, source: requestedSource(parsed), alreadyShown: [] }, time, now, deps);
  }

  if (parsed.intent === "more_suggestions") {
    return suggest(
      message.text,
      userId,
      parsed,
      {
        slot: parsed.mealSlot ?? suggestionSet?.slot ?? defaultSlot(time.hour),
        source: requestedSource(parsed) ?? suggestionSet?.source ?? null,
        alreadyShown: suggestionSet?.shown ?? [],
      },
      time,
      now,
      deps,
    );
  }

  return parsed.reply;
}

async function logParsedMeal(
  db: D1Database,
  userId: number,
  dishName: string,
  parsed: ParsedMessage,
  time: LocalTime,
  texts: Messages,
  boughtFromList = false,
): Promise<string> {
  const { dishId, ingredientCount, name, source, shop } = await saveDish(db, userId, dishName, parsed.ingredients, {
    ...parsed,
    addSource: true,
  });
  const bought = boughtFromList || parsed.source === "takeout" || source === "takeout";
  const eatenOn = resolveEatenOn(parsed.eatenOn, time.date);
  const slot = parsed.mealSlot ?? defaultSlot(time.hour);
  await logMeal(db, {
    userId,
    dishId,
    eatenOn,
    slot,
    rating: resolveRating(parsed.rating),
    shop: bought ? shop : null,
  });
  await removeFromWishlist(db, dishId);
  // Written by code from what was stored, so the reply can't name a different dish or day.
  return withIngredientsQuestion(texts.logged(slot, eatenOn, name), parsed, ingredientCount, bought);
}

function resolveRating(rating: number | null): number | null {
  if (rating === null) return null;
  const rounded = Math.round(rating);
  return rounded >= 1 && rounded <= 5 ? rounded : null;
}

function requestedSource(parsed: ParsedMessage): SuggestionSet["source"] {
  return parsed.source === "either" ? null : parsed.source;
}

async function suggest(
  text: string,
  userId: number,
  parsed: ParsedMessage,
  { slot, source, alreadyShown }: Pick<SuggestionSet, "slot" | "source"> & { alreadyShown: string[] },
  time: LocalTime,
  now: Date,
  deps: Dependencies,
): Promise<string> {
  const [candidates, preferences] = await Promise.all([
    loadCandidates(deps.db, userId),
    loadPreferences(deps.db, userId),
  ]);
  const picks = pickSuggestions(
    candidates.filter((dish) => !alreadyShown.includes(dish.name)),
    {
      today: time.date,
      slot,
      weekend: isWeekend(time.weekday),
      source,
      preferences,
      random: deps.random ?? Math.random,
    },
  );
  const dishes = picks.map((dish) => dish.name);
  console.log("Suggested", { slot, source, alreadyShown, dishes });
  if (picks.length === 0) {
    // A fresh ask replaces any older list, so "the first one" can't pick from it.
    if (alreadyShown.length === 0) await clearSuggestionSet(deps.db, userId);
    return parsed.reply;
  }

  // The picks are already right, so a failed explanation only costs the wording.
  const explanation = await deps.parser
    .explain(text, picks, { today: time.date, weekday: time.weekday })
    .catch((error) => {
      console.error("Failed to explain suggestions", error);
      return null;
    });

  // Saved last, so numbers always refer to a list that was actually about to be sent.
  await saveSuggestionSet(deps.db, userId, { dishes, shown: [...alreadyShown, ...dishes], slot, source }, now);

  const hasAllergies = preferences.some((preference) => preference.kind === "allergy");
  return renderSuggestions(picks, explanation, hasAllergies, messagesFor(text));
}

function renderSuggestions(
  picks: Candidate[],
  explanation: SuggestionText | null,
  hasAllergies: boolean,
  texts: Messages,
): string {
  const lines = picks.map((dish, index) => {
    const reason = explanation?.reasons[index]?.trim();
    const details = [dish.shop, dish.wishlist ? texts.tryList : null].filter(Boolean).join(", ");
    const label = `${index + 1}. ${dish.name}${details ? ` (${details})` : ""}${reason ? `: ${reason}` : ""}`;
    return dish.sourceUrl ? `${label}\n${dish.sourceUrl}` : label;
  });
  const unchecked = picks.filter((dish) => dish.ingredients.length === 0).map((dish) => dish.name);
  const warning = !hasAllergies ? [] : [unchecked.length > 0 ? texts.unknownIngredients(unchecked) : texts.allergyCheck];

  return [explanation?.intro.trim() || texts.defaultIntro, ...lines, ...warning].join("\n");
}

// People don't know what's in food they bought, so only cooked dishes get the question.
function withIngredientsQuestion(reply: string, parsed: ParsedMessage, ingredientCount: number, bought: boolean): string {
  return ingredientCount === 0 && !bought && parsed.ingredientsQuestion ? `${reply}\n${parsed.ingredientsQuestion}` : reply;
}
