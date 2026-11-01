import { lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Channel } from "../channels/types";
import { messageUsage, webhookEvents } from "./schema";

const EVENT_RETENTION_DAYS = 7;

// False when this event was already handled, as when LINE redelivers it.
export async function claimEvent(d1: D1Database, eventId: string): Promise<boolean> {
  const db = drizzle(d1);
  const claimed = await db
    .insert(webhookEvents)
    .values({ eventId })
    .onConflictDoNothing()
    .returning({ eventId: webhookEvents.eventId })
    .get();
  await db.delete(webhookEvents).where(lt(webhookEvents.receivedAt, sql`datetime('now', ${`-${EVENT_RETENTION_DAYS} days`})`));
  return Boolean(claimed);
}

export async function countMessage(d1: D1Database, channel: Channel, externalId: string, day: string): Promise<number> {
  const row = await drizzle(d1)
    .insert(messageUsage)
    .values({ channel, externalId, day, count: 1 })
    .onConflictDoUpdate({
      target: [messageUsage.channel, messageUsage.externalId, messageUsage.day],
      set: { count: sql`${messageUsage.count} + 1` },
    })
    .returning({ count: messageUsage.count })
    .get();
  return row.count;
}
