# Meal Decider

A LINE chatbot that helps decide lunch and dinner. It runs on Cloudflare Workers with a D1 database.

The bot verifies LINE webhooks, creates a user on first contact, saves dishes with their ingredients, logs meals, remembers allergies and dislikes, and suggests what to eat. Claude Haiku 5.5 reads each message and writes the wording, and code performs every action.

Code chooses suggestions in `src/core/suggest.ts`. It removes dishes that don't fit the meal, match an allergy or dislike, can't be cooked today because they're weekend-only, or don't match a request for takeout or home cooking, scores the rest on time since last eaten, ingredient and cuisine overlap with the last 3 days, and rating, then picks 3 at random from the top 6.

`/dashboard` shows dishes, recent meals and preferences for the user in `DASHBOARD_USER_ID`, read live from the database, and `/dashboard/dishes/:id` shows one dish's frequency and a month calendar. Both use browser login with the username `meal` and the `DASHBOARD_PASSWORD` secret, and stay locked until that secret is set.

Takeout shops are stored per meal in `meals.shop`, and `dishes.shop` holds the latest one, which suggestions show.

The last list is kept for 12 hours in `suggestion_sets`, so a reply like "the second one" logs that dish and "something else" moves on to dishes not yet shown.

Only people already in the database get a reply. To add someone, set `ALLOW_NEW_USERS` to `true` in `wrangler.jsonc`, deploy, have them message the bot, then set it back. Each person has a daily message limit, and group chats are ignored.

Allergy matching is broad but only sees saved ingredients and the table in `src/core/allergens.ts`, so it can't guarantee a dish is safe.

Run `npm run backup` to export the production database to `backups/`, which isn't committed.

Dates use the `TIMEZONE` variable in `wrangler.jsonc`.

## Project layout

```
src/index.ts              Routes and webhook entry point
src/channels/             One adapter per chat app, plus the shared message format
src/core/handleMessage.ts Channel-independent message handling
src/core/dates.ts         Local dates and meal slot defaults
src/core/suggest.ts       Filtering, scoring and picking suggestions
src/llm/                  Message understanding, behind a provider interface
src/db/                   Schema and database helpers
migrations/               Generated SQL migrations
```

## Node version

The tools need Node 22, which is installed inside the project as a dev dependency. Always use `npm run ...` or `npx ...`, which pick it up automatically.

If you reinstall dependencies from scratch, run the install with Node 22 on your `PATH`. Under Node 20, npm skips a native package that the tests need.

## Local development

```bash
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

Other commands:

```bash
npm test
npm run typecheck
```

After changing `src/db/schema.ts`, run `npm run db:generate` and then apply the migration.

## First deployment

1. Create a LINE Official Account, enable the Messaging API, and note the channel secret and channel access token.
2. Log in to Cloudflare:

   ```bash
   npx wrangler login
   ```

3. Create the database, then copy the printed `database_id` into `wrangler.jsonc`:

   ```bash
   npx wrangler d1 create meal-decider
   ```

4. Apply the migration:

   ```bash
   npm run db:migrate:remote
   ```

5. Add the secrets. Each command prompts for the value:

   ```bash
   npx wrangler secret put LINE_CHANNEL_SECRET
   npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
   npx wrangler secret put ANTHROPIC_API_KEY
   ```

6. Deploy:

   ```bash
   npm run deploy
   ```

7. In the LINE Developers Console, set the webhook URL to `https://<your-worker-url>/webhook/line`, turn on **Use webhook**, and press **Verify**.
8. In LINE Official Account Manager, turn off auto-reply messages so they don't appear alongside the bot's replies.
9. Add the bot as a friend and send it a message. It should repeat the message back.
