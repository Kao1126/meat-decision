import type { IncomingMessage } from "../channels/types";
import { claimEvent, countMessage } from "../db/usage";
import { userExists } from "../db/users";

// Each message can cost several paid LLM calls, so this is well above normal use.
const DAILY_MESSAGE_LIMIT = 100;

export type Admission = "process" | "ignore" | "limit-reached";

// Runs before any paid call. Limit replies stop after the first, so a flood can't run up LINE quota.
export async function admitMessage(
  db: D1Database,
  message: IncomingMessage,
  options: { allowNewUsers: boolean; today: string },
): Promise<Admission> {
  if (!(await claimEvent(db, message.eventId))) return "ignore";
  if (!options.allowNewUsers && !(await userExists(db, message.channel, message.externalUserId))) return "ignore";

  const count = await countMessage(db, message.channel, message.externalUserId, options.today);
  if (count <= DAILY_MESSAGE_LIMIT) return "process";
  return count === DAILY_MESSAGE_LIMIT + 1 ? "limit-reached" : "ignore";
}
