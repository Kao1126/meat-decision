import { readdirSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { app } from "../src/index";

const PASSWORD = "test-password";
const login = { Authorization: `Basic ${btoa(`meal:${PASSWORD}`)}` };

let dispose: () => Promise<void>;
let db: D1Database;

const env = (overrides: object = {}) => ({
  DB: db,
  DASHBOARD_PASSWORD: PASSWORD,
  DASHBOARD_USER_ID: 1,
  TIMEZONE: "Australia/Brisbane",
  ...overrides,
});

const page = async (path = "/dashboard") => (await app.request(path, { headers: login }, env())).text();

beforeAll(async () => {
  const proxy = await getPlatformProxy<{ DB: D1Database }>({ persist: false });
  dispose = proxy.dispose;
  db = proxy.env.DB;

  const files = readdirSync("migrations").filter((name) => name.endsWith(".sql")).sort();
  for (const file of files) {
    const statements = readFileSync(`migrations/${file}`, "utf8").split("--> statement-breakpoint");
    for (const statement of statements) await db.prepare(statement).run();
  }

  await db.batch(
    [
      "INSERT INTO users (id) VALUES (1), (2)",
      "INSERT INTO dishes (id, user_id, name, source, weekend_only, shop, cuisine) VALUES (1, 1, '紅燒牛肉', 'home', 1, NULL, 'chinese')",
      "INSERT INTO dishes (id, user_id, name, source, shop) VALUES (2, 1, '打拋豬', 'takeout', '巷口泰式')",
      "INSERT INTO dishes (id, user_id, name) VALUES (3, 1, '<script>alert(1)</script>')",
      "INSERT INTO dishes (id, user_id, name) VALUES (4, 2, '別人的菜')",
      "INSERT INTO dishes (id, user_id, name, wishlist, source_url, note) VALUES (5, 1, '牛肉麵', 1, 'https://www.instagram.com/reel/abc?a=1&b=2', '湯很濃')",
      "INSERT INTO ingredients (id, user_id, name) VALUES (1, 1, '牛肉')",
      "INSERT INTO dish_ingredients (dish_id, ingredient_id) VALUES (1, 1)",
      "INSERT INTO meals (user_id, dish_id, eaten_on, slot, rating, shop) VALUES (1, 2, '2026-10-30', 'dinner', 4, '巷口泰式')",
      "INSERT INTO meals (user_id, dish_id, eaten_on, slot) VALUES (2, 4, '2026-10-30', 'lunch')",
      "INSERT INTO preferences (user_id, kind, value) VALUES (1, 'allergy', '花生')",
      "INSERT INTO preferences (user_id, kind, value) VALUES (2, 'allergy', '別人的過敏')",
    ].map((statement) => db.prepare(statement)),
  );
});

afterAll(() => dispose());

describe("access", () => {
  it("asks for a password", async () => {
    const response = await app.request("/dashboard", {}, env());
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("打拋豬");
  });

  it("refuses a wrong password", async () => {
    const headers = { Authorization: `Basic ${btoa("meal:wrong")}` };
    expect((await app.request("/dashboard", { headers }, env())).status).toBe(401);
  });

  it("stays locked when no password is set, even with a blank one offered", async () => {
    const headers = { Authorization: `Basic ${btoa("meal:")}` };
    expect((await app.request("/dashboard", { headers }, env({ DASHBOARD_PASSWORD: undefined }))).status).toBe(503);
    expect((await app.request("/dashboard", { headers }, env({ DASHBOARD_PASSWORD: "" }))).status).toBe(503);
  });

  it("isn't stored by browsers or proxies", async () => {
    const response = await app.request("/dashboard", { headers: login }, env());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("dish page", () => {
  it("needs the password too", async () => {
    const response = await app.request("/dashboard/dishes/2", {}, env());
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("打拋豬");
    expect((await app.request("/dashboard/dishes/2", {}, env({ DASHBOARD_PASSWORD: undefined }))).status).toBe(503);
  });

  it("opens on the month last eaten, with totals and the meal marked", async () => {
    const text = await page("/dashboard/dishes/2");
    expect(text).toContain("October 2026");
    expect(text).toContain("Eaten 1 time.");
    expect(text).toContain('class="slot">Dinner<');
    expect(text).toContain("巷口泰式: 1 time");
  });

  it("moves between months", async () => {
    const text = await page("/dashboard/dishes/2?month=2026-09");
    expect(text).toContain("September 2026");
    expect(text).toContain("0 times this month");
    expect(text).toContain("?month=2026-08");
    expect(text).toContain("?month=2026-10");
  });

  it("ignores an invalid month", async () => {
    expect(await page("/dashboard/dishes/2?month=<script>")).toContain("October 2026");
  });

  it("works for a dish never eaten", async () => {
    const response = await app.request("/dashboard/dishes/1", { headers: login }, env());
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("No meals logged for this dish yet");
  });

  it("hides another user's dish and unknown ids", async () => {
    for (const id of ["4", "999", "abc", "2abc"]) {
      const response = await app.request(`/dashboard/dishes/${id}`, { headers: login }, env());
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain("別人的菜");
    }
  });

  it("escapes the dish name", async () => {
    const text = await page("/dashboard/dishes/3");
    expect(text).not.toContain("<script>alert");
    expect(text).toContain("&lt;script&gt;");
  });
});

describe("try list", () => {
  it("shows notes and escaped links", async () => {
    const text = await page();
    expect(text).toContain("Want to try");
    expect(text).toContain("湯很濃");
    expect(text).toContain("https://www.instagram.com/reel/abc?a=1&amp;b=2");
  });
});

describe("frequency", () => {
  it("summarises what was eaten and links to each dish", async () => {
    const text = await page();
    expect(text).toContain("Most eaten: 打拋豬 (1 time)");
    expect(text).toContain('href="/dashboard/dishes/2"');
  });
});

describe("content", () => {
  it("shows dishes, shops, ingredients, meals and allergies", async () => {
    const text = await page();
    for (const value of ["紅燒牛肉", "打拋豬", "巷口泰式", "牛肉", "2026-10-30", "4 / 5", "Allergy: 花生"]) {
      expect(text).toContain(value);
    }
  });

  it("only shows the chosen user's data", async () => {
    const text = await page();
    expect(text).not.toContain("別人的菜");
    expect(text).not.toContain("別人的過敏");
  });

  it("escapes what people typed", async () => {
    const text = await page();
    expect(text).not.toContain("<script>");
    expect(text).toContain("&lt;script&gt;");
  });

  it("filters dishes", async () => {
    const dishTable = (text: string) => text.slice(text.indexOf("<tbody>"), text.indexOf("</tbody>"));
    expect(dishTable(await page("/dashboard?filter=takeout"))).not.toContain("紅燒牛肉");
    expect(dishTable(await page("/dashboard?filter=weekend"))).not.toContain("打拋豬");
    expect(dishTable(await page("/dashboard?filter=never"))).not.toContain("打拋豬");
  });

  it("treats an unknown filter as all, including inherited object keys", async () => {
    for (const filter of ["nonsense", "toString", "constructor"]) {
      const response = await app.request(`/dashboard?filter=${filter}`, { headers: login }, env());
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("紅燒牛肉");
    }
  });
});
