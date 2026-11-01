import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
import { parseMessages, sendReply, verifySignature } from "./channels/line";
import { localTime } from "./core/dates";
import { handleMessage } from "./core/handleMessage";
import { messagesFor } from "./core/messages";
import { renderDashboard, renderDishPage } from "./dashboard/page";
import { dishStats, resolveMonth, statsByDish } from "./dashboard/stats";
import { loadCandidates } from "./db/dishes";
import { loadMeals } from "./db/meals";
import { loadPreferences } from "./db/preferences";
import { AnthropicParser } from "./llm/anthropic";

const DASHBOARD_USERNAME = "meal";

export interface Bindings {
  DB: D1Database;
  LINE_CHANNEL_SECRET: string;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  ANTHROPIC_API_KEY: string;
  TIMEZONE: string;
  DASHBOARD_PASSWORD?: string;
  // The bot is open to anyone, so the dashboard shows one chosen person's data.
  DASHBOARD_USER_ID: number;
}

export const app = new Hono<{ Bindings: Bindings }>();

app.get("/health", (c) => c.json({ status: "ok" }));

// Stays locked until a password is set, rather than falling back to open.
app.use("/dashboard/*", async (c, next) => {
  const password = c.env.DASHBOARD_PASSWORD;
  if (!password) return c.text("Dashboard password is not set.", 503);
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
  return basicAuth({ username: DASHBOARD_USERNAME, password })(c, next);
});

app.get("/dashboard", async (c) => {
  const userId = c.env.DASHBOARD_USER_ID;
  const [dishes, meals, preferences] = await Promise.all([
    loadCandidates(c.env.DB, userId),
    loadMeals(c.env.DB, userId),
    loadPreferences(c.env.DB, userId),
  ]);
  const today = localTime(new Date(), c.env.TIMEZONE).date;
  const stats = statsByDish(meals, today);

  return c.html(renderDashboard({ dishes, meals, stats, preferences, filter: c.req.query("filter"), today }));
});

app.get("/dashboard/dishes/:id", async (c) => {
  const userId = c.env.DASHBOARD_USER_ID;
  const [dishes, allMeals] = await Promise.all([loadCandidates(c.env.DB, userId), loadMeals(c.env.DB, userId)]);
  const dish = dishes.find((candidate) => String(candidate.id) === c.req.param("id"));
  if (!dish) return c.text("Dish not found.", 404);

  const meals = allMeals.filter((meal) => meal.dishId === dish.id);
  const today = localTime(new Date(), c.env.TIMEZONE).date;
  const stats = dishStats(meals, today);
  // Opens on the month it was last eaten, so an older dish doesn't open on an empty calendar.
  const month = resolveMonth(c.req.query("month"), (stats.lastEatenOn ?? today).slice(0, 7));

  return c.html(renderDishPage({ dish, meals, stats, month, today }));
});

app.post("/webhook/line", async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header("x-line-signature");
  if (!(await verifySignature(rawBody, signature, c.env.LINE_CHANNEL_SECRET))) {
    return c.json({ error: "invalid signature" }, 401);
  }

  const messages = parseMessages(rawBody);
  const parser = new AnthropicParser(c.env.ANTHROPIC_API_KEY);

  // Acknowledge LINE straight away and finish the work after responding.
  c.executionCtx.waitUntil(
    Promise.all(
      messages.map(async (message) => {
        try {
          const reply = await handleMessage(message, {
            db: c.env.DB,
            parser,
            timeZone: c.env.TIMEZONE,
          }).catch((error) => {
            console.error("Failed to handle LINE message", error);
            return messagesFor(message.text).failure;
          });
          await sendReply(message.replyContext, reply, c.env.LINE_CHANNEL_ACCESS_TOKEN);
        } catch (error) {
          console.error("Failed to send LINE reply", error);
        }
      }),
    ),
  );

  return c.json({ status: "ok" });
});

export default app;
