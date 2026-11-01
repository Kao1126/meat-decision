import { html, raw } from "hono/html";
import type { Candidate, Preference } from "../core/suggest";
import type { MealRecord } from "../db/meals";
import { calendarWeeks, type DishStats, shiftMonth } from "./stats";

const FILTERS = {
  all: { label: "All", matches: () => true },
  wishlist: { label: "Want to try", matches: (dish: Candidate) => dish.wishlist },
  takeout: { label: "Takeout", matches: (dish: Candidate) => dish.source !== "home" },
  weekend: { label: "Weekend only", matches: (dish: Candidate) => dish.weekendOnly },
  never: { label: "Not eaten yet", matches: (dish: Candidate) => dish.timesEaten === 0 },
} as const;

type FilterName = keyof typeof FILTERS;

const SOURCE_LABELS: Record<Candidate["source"], string> = { home: "Home-cooked", takeout: "Takeout", either: "Either" };
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SLOT_LABELS = { lunch: "Lunch", dinner: "Dinner" };
const RECENT_MEALS_SHOWN = 50;

// Layout: one column of summary, then the dishes, then the history, so a phone reads it top to bottom.
const STYLES = `
:root { --bg: #f4f6f3; --panel: #ffffff; --fg: #1d2b26; --muted: #5d6d66; --line: #dbe2dd; --accent: #1f6f5c; --accent-soft: #dcefe8; --warm: #8a5a12; --warm-soft: #f6ead3; }
@media (prefers-color-scheme: dark) { :root { --bg: #131b18; --panel: #1b2622; --fg: #e6eeea; --muted: #9aaba3; --line: #2e3d37; --accent: #6fcfb4; --accent-soft: #1f3b33; --warm: #e8bd74; --warm-soft: #3d2f18; color-scheme: dark; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif; }
main { max-width: 64rem; margin: 0 auto; padding-block: 2rem 3rem; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); display: grid; gap: 1.5rem; }
h1 { font-size: 1.75rem; line-height: 1.2; margin: 0; }
h2 { font-size: 1.05rem; margin: 0 0 .75rem; }
a { color: var(--accent); }
.lead { margin: .25rem 0 0; color: var(--muted); }
.back { font-size: .9rem; }
.tiles { display: grid; gap: .75rem; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); }
.tile, .card { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 1rem; min-width: 0; }
.tile span { display: block; color: var(--muted); font-size: .8rem; }
.tile strong { display: block; font-size: 1.75rem; font-weight: 500; font-variant-numeric: tabular-nums; }
.tile small { color: var(--muted); font-size: .8rem; }
.filters { display: flex; flex-wrap: wrap; gap: .4rem; margin-bottom: .75rem; }
.filters a { padding: .2rem .7rem; border: 1px solid var(--line); border-radius: 999px; color: var(--muted); text-decoration: none; font-size: .85rem; }
.filters a[aria-current] { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); }
.scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: .9rem; }
th, td { text-align: left; padding: .5rem .6rem; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-weight: 500; white-space: nowrap; }
td.name { font-weight: 500; white-space: nowrap; }
td.number { font-variant-numeric: tabular-nums; white-space: nowrap; }
.tag { display: inline-block; padding: 0 .5rem; border-radius: 4px; font-size: .8rem; white-space: nowrap; background: var(--accent-soft); color: var(--accent); }
.tag.weekend { background: var(--warm-soft); color: var(--warm); }
.missing { color: var(--muted); }
.empty { color: var(--muted); margin: 0; }
.prefs { display: flex; flex-wrap: wrap; gap: .4rem; margin: 0; padding: 0; list-style: none; }
ul.wish { display: grid; gap: .75rem; }
.button { display: inline-block; padding: .1rem .6rem; border: 1px solid var(--accent); border-radius: 6px; color: var(--accent); font-size: .8rem; text-decoration: none; white-space: nowrap; }
.button:hover, .button:focus-visible { background: var(--accent-soft); }
.insights { margin: 0 0 .75rem; color: var(--muted); }
.freq { display: grid; gap: .5rem; }
.freq-row { display: grid; grid-template-columns: minmax(0, 8rem) 1fr auto auto; gap: .6rem; align-items: center; font-size: .9rem; }
.freq-name { overflow-wrap: anywhere; font-weight: 500; }
.freq-track { height: .6rem; border-radius: 3px; background: var(--accent-soft); overflow: hidden; }
.freq-track i { display: block; height: 100%; background: var(--accent); }
.freq-count { font-variant-numeric: tabular-nums; white-space: nowrap; }
.wish { display: grid; gap: .75rem; }
.wish-item { display: grid; gap: .15rem; padding-bottom: .75rem; border-bottom: 1px solid var(--line); min-width: 0; }
.wish-item:last-child { padding-bottom: 0; border-bottom: 0; }
.wish-item strong { font-weight: 500; }
.wish-item p { margin: 0; color: var(--muted); font-size: .9rem; }
.wish-item a { font-size: .85rem; }
.month-nav { display: flex; align-items: center; justify-content: space-between; gap: .5rem; margin-bottom: .75rem; }
.month-nav h2 { margin: 0; font-variant-numeric: tabular-nums; }
.calendar { table-layout: fixed; }
.calendar th { text-align: center; padding: .25rem 0; }
.calendar td { height: 3.75rem; padding: .25rem; border: 1px solid var(--line); text-align: left; }
.calendar .date { display: block; font-size: .8rem; color: var(--muted); font-variant-numeric: tabular-nums; }
.calendar .today .date { color: var(--accent); font-weight: 700; }
.calendar .eaten { background: var(--accent-soft); }
.calendar .eaten .date { color: var(--fg); }
.calendar .slot { display: block; width: fit-content; margin-top: .1rem; padding: 0 .25rem; border-radius: 3px; background: var(--accent); color: var(--panel); font-size: .75rem; }
.calendar .blank { border-color: transparent; }
`;

const formatted = (value: string | null | undefined, fallback = "Not set") =>
  value ? html`${value}` : html`<span class="missing">${fallback}</span>`;

const cuisineLabel = (cuisine: string | null) => (cuisine ? cuisine.charAt(0).toUpperCase() + cuisine.slice(1) : null);
const dishLink = (dish: Candidate) => `/dashboard/dishes/${dish.id}`;
const oneDecimal = (value: number) => String(Math.round(value * 10) / 10);
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
const sinceLabel = (days: number) => (days === 0 ? "today" : `${plural(days, "day")} ago`);
const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

function layout(title: string, content: unknown) {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="robots" content="noindex" />
        <title>${title}</title>
        <style>
          ${raw(STYLES)}
        </style>
      </head>
      <body>
        <main>${content}</main>
      </body>
    </html>`;
}

function dishRow(dish: Candidate, stats: DishStats | undefined) {
  return html`<tr>
    <td class="name">${dish.name}</td>
    <td><a class="button" href="${dishLink(dish)}">View history</a></td>
    <td><span class="tag">${SOURCE_LABELS[dish.source]}</span></td>
    <td>${dish.weekendOnly ? html`<span class="tag weekend">Weekend only</span>` : "Any day"}</td>
    <td>${formatted(dish.shop)}</td>
    <td>${formatted(cuisineLabel(dish.cuisine))}</td>
    <td>${formatted(dish.ingredients.join("、"))}</td>
    <td class="number">${dish.timesEaten}</td>
    <td class="number">${stats?.lastThirtyDays ?? 0}</td>
    <td class="number">${formatted(dish.lastEatenOn, "Not eaten yet")}</td>
  </tr>`;
}

function mealRow(meal: MealRecord) {
  return html`<tr>
    <td class="number">${meal.eatenOn}</td>
    <td>${SLOT_LABELS[meal.slot]}</td>
    <td class="name">${meal.name}</td>
    <td>${formatted(meal.shop)}</td>
    <td class="number">${formatted(meal.rating === null ? null : `${meal.rating} / 5`, "Not rated")}</td>
  </tr>`;
}

function wishItem(dish: Candidate) {
  return html`<li class="wish-item">
    <strong>${dish.name}</strong>
    ${dish.note ? html`<p>${dish.note}</p>` : ""}
    ${dish.shop ? html`<p>${dish.shop}</p>` : ""}
    ${dish.sourceUrl ? html`<a href="${dish.sourceUrl}" target="_blank" rel="noopener noreferrer">Open link</a>` : ""}
  </li>`;
}

function wishlistCard(dishes: Candidate[]) {
  const items = dishes.filter(FILTERS.wishlist.matches);
  return html`<section class="card">
    <h2>Want to try</h2>
    ${items.length === 0
      ? html`<p class="empty">Nothing here yet. Send the LINE bot a dish you want to try, or an Instagram or YouTube link.</p>`
      : html`<ul class="wish prefs">${items.map(wishItem)}</ul>`}
  </section>`;
}

function frequencyCard(dishes: Candidate[], stats: Map<number, DishStats>) {
  const eaten = dishes
    .filter((dish) => dish.timesEaten > 0)
    .sort((a, b) => b.timesEaten - a.timesEaten || (b.lastEatenOn ?? "").localeCompare(a.lastEatenOn ?? ""));
  const top = eaten[0];
  if (!top) {
    return html`<section class="card">
      <h2>How often</h2>
      <p class="empty">No meals logged yet. Log a few and the analysis will appear here.</p>
    </section>`;
  }

  const longestAgo = eaten.reduce((oldest, dish) => ((dish.lastEatenOn ?? "") < (oldest.lastEatenOn ?? "") ? dish : oldest));
  const longestDays = stats.get(longestAgo.id)?.daysSinceLast ?? 0;
  const thirtyDayTotal = [...stats.values()].reduce((total, dish) => total + dish.lastThirtyDays, 0);

  return html`<section class="card">
    <h2>How often</h2>
    <p class="insights">
      Most eaten: ${top.name} (${plural(top.timesEaten, "time")}). ${plural(thirtyDayTotal, "meal")} in the last 30 days. Longest since last eaten: ${longestAgo.name} (${sinceLabel(longestDays)}).
    </p>
    <div class="freq">
      ${eaten.map(
        (dish) => html`<div class="freq-row">
          <span class="freq-name">${dish.name}</span>
          <span class="freq-track"><i style="width: ${(dish.timesEaten / top.timesEaten) * 100}%"></i></span>
          <span class="freq-count">${plural(dish.timesEaten, "time")}</span>
          <a class="button" href="${dishLink(dish)}">View history</a>
        </div>`,
      )}
    </div>
  </section>`;
}

export function renderDashboard(page: {
  dishes: Candidate[];
  meals: MealRecord[];
  stats: Map<number, DishStats>;
  preferences: Preference[];
  filter: string | undefined;
  today: string;
}) {
  const { dishes, meals, stats, preferences, today } = page;
  const active: FilterName = page.filter && Object.hasOwn(FILTERS, page.filter) ? (page.filter as FilterName) : "all";
  const shown = dishes.filter(FILTERS[active].matches);
  const neverEaten = dishes.filter(FILTERS.never.matches).length;

  return layout(
    "Meal Dashboard",
    html`<header>
        <h1>Meal Dashboard</h1>
        <p class="lead">${dishes.length} ${dishes.length === 1 ? "dish" : "dishes"} saved, ${neverEaten} not eaten yet. Live data as of ${today}.</p>
      </header>

      <section class="tiles" aria-label="Summary">
        <div class="tile"><span>All dishes</span><strong>${dishes.length}</strong></div>
        <div class="tile"><span>Takeout</span><strong>${dishes.filter(FILTERS.takeout.matches).length}</strong></div>
        <div class="tile"><span>Weekend only</span><strong>${dishes.filter(FILTERS.weekend.matches).length}</strong></div>
        <div class="tile"><span>Meals logged</span><strong>${meals.length}</strong></div>
      </section>

      ${wishlistCard(dishes)}

      ${frequencyCard(dishes, stats)}

      <section class="card">
        <h2>All dishes</h2>
        <nav class="filters" aria-label="Filter dishes">
          ${(Object.keys(FILTERS) as FilterName[]).map(
            (name) =>
              html`<a href="?filter=${name}" ${raw(name === active ? 'aria-current="true"' : "")}>${FILTERS[name].label}</a>`,
          )}
        </nav>
        ${shown.length === 0
          ? html`<p class="empty">No dishes in this group yet.</p>`
          : html`<div class="scroll">
              <table>
                <thead>
                  <tr>
                    <th>Dish</th><th>Calendar</th><th>Source</th><th>When</th><th>Shop</th><th>Cuisine</th><th>Ingredients</th><th>Times eaten</th><th>Last 30 days</th><th>Last eaten</th>
                  </tr>
                </thead>
                <tbody>
                  ${shown.map((dish) => dishRow(dish, stats.get(dish.id)))}
                </tbody>
              </table>
            </div>`}
      </section>

      <section class="card">
        <h2>Recent meals</h2>
        ${meals.length === 0
          ? html`<p class="empty">No meals logged yet. Tell the LINE bot "I had ramen for lunch" and it will appear here.</p>`
          : html`<div class="scroll">
              <table>
                <thead>
                  <tr><th>Date</th><th>Meal</th><th>Dish</th><th>Shop</th><th>Rating</th></tr>
                </thead>
                <tbody>
                  ${meals.slice(0, RECENT_MEALS_SHOWN).map(mealRow)}
                </tbody>
              </table>
            </div>`}
      </section>

      <section class="card">
        <h2>Allergies and dislikes</h2>
        ${preferences.length === 0
          ? html`<p class="empty">None set. Tell the LINE bot "I'm allergic to peanuts" and it will appear here.</p>`
          : html`<ul class="prefs">
              ${preferences.map(
                (preference) =>
                  html`<li><span class="tag ${preference.kind === "allergy" ? "weekend" : ""}">${preference.kind === "allergy" ? "Allergy" : "Dislike"}: ${preference.value}</span></li>`,
              )}
            </ul>`}
      </section>`,
  );
}

function calendar(month: string, meals: MealRecord[], today: string) {
  const slotsByDay = Map.groupBy(meals, (meal) => meal.eatenOn);

  return html`<table class="calendar">
    <thead>
      <tr>
        ${WEEKDAYS.map((day) => html`<th scope="col">${day}</th>`)}
      </tr>
    </thead>
    <tbody>
      ${calendarWeeks(month).map(
        (week) => html`<tr>
          ${week.map((date) => {
            if (!date) return html`<td class="blank"></td>`;
            const eaten = slotsByDay.get(date) ?? [];
            const classes = [eaten.length > 0 ? "eaten" : "", date === today ? "today" : ""].join(" ").trim();
            return html`<td class="${classes}">
              <span class="date">${Number(date.slice(8))}</span>
              ${eaten.map((meal) => html`<span class="slot">${SLOT_LABELS[meal.slot]}</span>`)}
            </td>`;
          })}
        </tr>`,
      )}
    </tbody>
  </table>`;
}

export function renderDishPage(page: {
  dish: Candidate;
  meals: MealRecord[];
  stats: DishStats;
  month: string;
  today: string;
}) {
  const { dish, meals, stats, month, today } = page;
  const monthMeals = meals.filter((meal) => meal.eatenOn.startsWith(month));

  return layout(
    `${dish.name} history`,
    html`<a class="back" href="/dashboard">Back to dashboard</a>
      <header>
        <h1>${dish.name}</h1>
        <p class="lead">
          ${stats.total === 0
            ? "No meals logged for this dish yet."
            : html`Eaten ${plural(stats.total, "time")}. First on ${stats.firstEatenOn}, last ${sinceLabel(stats.daysSinceLast ?? 0)}.`}
        </p>
        ${dish.note ? html`<p class="lead">${dish.note}</p>` : ""}
        ${dish.sourceUrl ? html`<a href="${dish.sourceUrl}" target="_blank" rel="noopener noreferrer">Open link</a>` : ""}
      </header>

      <section class="tiles" aria-label="Statistics">
        <div class="tile"><span>Total times</span><strong>${stats.total}</strong></div>
        <div class="tile"><span>Last 30 days</span><strong>${stats.lastThirtyDays}</strong></div>
        <div class="tile"><span>Lunch / dinner</span><strong>${stats.lunches} / ${stats.dinners}</strong></div>
        <div class="tile">
          <span>Average gap</span>
          <strong>${stats.averageGapDays === null ? "—" : oneDecimal(stats.averageGapDays)}</strong>
          <small>${stats.averageGapDays === null ? "Needs meals on two or more days" : "days between meals"}</small>
        </div>
        <div class="tile">
          <span>Average rating</span>
          <strong>${stats.averageRating === null ? "—" : oneDecimal(stats.averageRating)}</strong>
          <small>${stats.averageRating === null ? "No ratings yet" : "out of 5"}</small>
        </div>
      </section>

      <section class="card">
        <div class="month-nav">
          <a class="button" href="?month=${shiftMonth(month, -1)}">Previous</a>
          <h2>${monthLabel(month)}</h2>
          <a class="button" href="?month=${shiftMonth(month, 1)}">Next</a>
        </div>
        <div class="scroll">${calendar(month, monthMeals, today)}</div>
        <p class="lead">${plural(monthMeals.length, "time")} this month.</p>
      </section>

      ${stats.shops.length === 0
        ? ""
        : html`<section class="card">
            <h2>Shops</h2>
            <ul class="prefs">
              ${stats.shops.map(({ shop, count }) => html`<li><span class="tag">${shop}: ${plural(count, "time")}</span></li>`)}
            </ul>
          </section>`}

      ${meals.length === 0
        ? ""
        : html`<section class="card">
            <h2>Every meal</h2>
            <div class="scroll">
              <table>
                <thead>
                  <tr><th>Date</th><th>Meal</th><th>Dish</th><th>Shop</th><th>Rating</th></tr>
                </thead>
                <tbody>
                  ${meals.map(mealRow)}
                </tbody>
              </table>
            </div>
          </section>`}`,
  );
}
