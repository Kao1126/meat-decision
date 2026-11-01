import { z } from "zod";
import type { Candidate } from "../core/suggest";

export const ParsedMessageSchema = z.object({
  intent: z.enum(["save_dish", "log_meal", "suggest", "accept_suggestion", "more_suggestions", "save_preference", "save_wishlist", "unknown"]),
  dishName: z.string().nullable(),
  ingredients: z.array(z.string()),
  cuisine: z.string().nullable(),
  cuisineStated: z.boolean(),
  shop: z.string().nullable(),
  note: z.string().nullable(),
  source: z.enum(["home", "takeout", "either"]).nullable(),
  weekendOnly: z.boolean().nullable(),
  mealSlot: z.enum(["lunch", "dinner"]).nullable(),
  eatenOn: z.string().nullable(),
  rating: z.number().nullable(),
  suggestionNumber: z.number().nullable(),
  preferenceKind: z.enum(["allergy", "dislike"]).nullable(),
  preferenceValues: z.array(z.string()),
  reply: z.string(),
  ingredientsQuestion: z.string(),
});

export type ParsedMessage = z.infer<typeof ParsedMessageSchema>;

export const SuggestionTextSchema = z.object({
  intro: z.string(),
  reasons: z.array(z.string()),
});

export type SuggestionText = z.infer<typeof SuggestionTextSchema>;

export interface DateContext {
  today: string;
  weekday: string;
}

export interface ParseContext extends DateContext {
  // The numbered list the user last saw, in order. Empty if there isn't one.
  suggestions: string[];
  // What could be read from a link in the message, if anything. Written by strangers.
  linkPreview: string | null;
}

// The only LLM surface the core depends on, so a provider can be swapped here.
export interface MessageParser {
  parse(text: string, context: ParseContext): Promise<ParsedMessage | null>;
  // Describes dishes the core already chose. It never chooses them.
  explain(text: string, dishes: Candidate[], context: DateContext): Promise<SuggestionText | null>;
}
