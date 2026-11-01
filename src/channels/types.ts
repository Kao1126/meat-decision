export type Channel = "line" | "whatsapp";

// The shared format every channel adapter converts to, so the core never sees
// LINE or WhatsApp payloads.
export interface IncomingMessage {
  channel: Channel;
  externalUserId: string;
  text: string;
  // Opaque value the adapter needs to answer this message.
  replyContext: string;
}
