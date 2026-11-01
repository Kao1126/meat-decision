import type { IncomingMessage } from "./types";

const REPLY_ENDPOINT = "https://api.line.me/v2/bot/message/reply";
const MAX_TEXT_LENGTH = 5000;

interface LineEvent {
  type: string;
  replyToken?: string;
  source?: { type: string; userId?: string };
  message?: { type: string; text?: string };
}

export async function verifySignature(
  rawBody: string,
  signature: string | undefined,
  channelSecret: string,
): Promise<boolean> {
  if (!signature) return false;

  let expected: Uint8Array<ArrayBuffer>;
  try {
    expected = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
  } catch {
    return false;
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(channelSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("HMAC", key, expected, encoder.encode(rawBody));
}

export function parseMessages(rawBody: string): IncomingMessage[] {
  const { events = [] } = JSON.parse(rawBody) as { events?: LineEvent[] };

  return events.flatMap((event) => {
    const userId = event.source?.userId;
    const text = event.message?.text;
    if (event.type !== "message" || event.message?.type !== "text") return [];
    if (!userId || !text || !event.replyToken) return [];

    return [{ channel: "line" as const, externalUserId: userId, text, replyContext: event.replyToken }];
  });
}

export async function sendReply(replyToken: string, text: string, accessToken: string): Promise<void> {
  const response = await fetch(REPLY_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: "text", text: text.slice(0, MAX_TEXT_LENGTH) }],
    }),
  });

  if (!response.ok) {
    throw new Error(`LINE reply failed: ${response.status} ${await response.text()}`);
  }
}
