import { describe, expect, it } from "vitest";
import { parseMessages, verifySignature } from "../src/channels/line";

const secret = "test-secret";

async function sign(body: string, key = secret): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(body));
  return btoa(String.fromCharCode(...new Uint8Array(mac)));
}

describe("verifySignature", () => {
  it("accepts a correct signature, including non-ASCII bodies", async () => {
    const body = JSON.stringify({ events: [{ message: { text: "麻婆豆腐" } }] });
    expect(await verifySignature(body, await sign(body), secret)).toBe(true);
  });

  it("rejects a signature from another secret", async () => {
    expect(await verifySignature("{}", await sign("{}", "wrong"), secret)).toBe(false);
  });

  it("rejects a tampered body", async () => {
    expect(await verifySignature('{"a":2}', await sign('{"a":1}'), secret)).toBe(false);
  });

  it("rejects missing and malformed signatures", async () => {
    expect(await verifySignature("{}", undefined, secret)).toBe(false);
    expect(await verifySignature("{}", "not base64!", secret)).toBe(false);
  });
});

describe("parseMessages", () => {
  const textEvent = {
    type: "message",
    replyToken: "token",
    webhookEventId: "E1",
    source: { type: "user", userId: "U1" },
    message: { type: "text", text: "hello" },
  };

  it("converts text messages to the shared format", () => {
    expect(parseMessages(JSON.stringify({ events: [textEvent] }))).toEqual([
      { channel: "line", externalUserId: "U1", eventId: "E1", text: "hello", replyContext: "token" },
    ]);
  });

  it("ignores events the bot cannot answer", () => {
    const events = [
      { ...textEvent, type: "follow" },
      { ...textEvent, message: { type: "sticker" } },
      { ...textEvent, source: { type: "user" } },
      { ...textEvent, source: { type: "group", userId: "U1" } },
      { ...textEvent, source: { type: "room", userId: "U1" } },
    ];
    expect(parseMessages(JSON.stringify({ events }))).toEqual([]);
  });

  it("caps very long messages", () => {
    const events = [{ ...textEvent, message: { type: "text", text: "x".repeat(5000) } }];
    expect(parseMessages(JSON.stringify({ events }))[0]?.text).toHaveLength(1000);
  });

  it("accepts LINE's empty verification request", () => {
    expect(parseMessages(JSON.stringify({ events: [] }))).toEqual([]);
  });
});
