import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Channel } from "../channels/types";
import { channelIdentities, users } from "./schema";

export async function userExists(d1: D1Database, channel: Channel, externalId: string): Promise<boolean> {
  const identity = await drizzle(d1)
    .select({ id: channelIdentities.id })
    .from(channelIdentities)
    .where(and(eq(channelIdentities.channel, channel), eq(channelIdentities.externalId, externalId)))
    .get();
  return Boolean(identity);
}

export async function findOrCreateUser(d1: D1Database, channel: Channel, externalId: string): Promise<number> {
  const db = drizzle(d1);
  const matchesIdentity = and(eq(channelIdentities.channel, channel), eq(channelIdentities.externalId, externalId));

  const existing = await db.select({ userId: channelIdentities.userId }).from(channelIdentities).where(matchesIdentity).get();
  if (existing) return existing.userId;

  const user = await db.insert(users).values({}).returning({ id: users.id }).get();
  await db.insert(channelIdentities).values({ userId: user.id, channel, externalId }).onConflictDoNothing();

  // A concurrent first message may have won the insert, so read back the owner.
  const identity = await db.select({ userId: channelIdentities.userId }).from(channelIdentities).where(matchesIdentity).get();
  if (!identity) throw new Error(`Could not create identity for ${channel} user`);
  if (identity.userId !== user.id) await db.delete(users).where(eq(users.id, user.id));
  return identity.userId;
}
