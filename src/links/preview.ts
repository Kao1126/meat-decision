const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);
const INSTAGRAM_HOSTS = new Set(["instagram.com", "www.instagram.com"]);
const TIMEOUT_MS = 5000;
const MAX_PAGE_CHARS = 300_000;
const MAX_PREVIEW_CHARS = 1500;

export type LinkFetcher = (url: string) => Promise<string | null>;

// Taken from the message by code, so the LLM can't choose what gets stored or fetched.
export function extractLink(text: string): string | null {
  for (const [candidate] of text.matchAll(/https?:\/\/[^\s<>"'，。）)]+/g)) {
    if (URL.canParse(candidate)) return candidate;
  }
  return null;
}

const decodeEntities = (text: string) =>
  text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");

function metaContent(page: string, property: string): string | null {
  const tag = page.match(new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]*>`, "i"))?.[0];
  const content = tag?.match(/content=["']([^"']*)["']/i)?.[1];
  return content ? decodeEntities(content) : null;
}

async function pageDescription(url: string): Promise<string | null> {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) return null;
  const page = (await response.text()).slice(0, MAX_PAGE_CHARS);
  const parts = [metaContent(page, "og:title"), metaContent(page, "og:description")];
  return parts.filter(Boolean).join("\n") || null;
}

async function youtubeTitle(url: string): Promise<string | null> {
  const endpoint = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`;
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) return null;
  const { title, author_name: author } = (await response.json()) as { title?: string; author_name?: string };
  return title ? `${title}${author ? ` (${author})` : ""}` : null;
}

// The public embed page often still shows a caption when the post page asks visitors to log in.
async function instagramCaption(url: string): Promise<string | null> {
  const postId = new URL(url).pathname.match(/\/(?:p|reels?|tv)\/([\w-]+)/)?.[1];
  if (!postId) return null;

  const response = await fetch(`https://www.instagram.com/p/${postId}/embed/captioned/`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) return null;

  const page = (await response.text()).slice(0, MAX_PAGE_CHARS);
  const caption = page.match(/class="Caption"[^>]*>([\s\S]*?)<div class="CaptionComments"/)?.[1];
  if (!caption) return null;
  return decodeEntities(caption.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).trim() || null;
}

// Only these two sites are fetched, so a message can't point the Worker at anything else.
// A failure here isn't an error: the message is still handled, just with less to go on.
export const fetchLinkPreview: LinkFetcher = async (url) => {
  const host = new URL(url).hostname.toLowerCase();
  const isYoutube = YOUTUBE_HOSTS.has(host);
  if (!isYoutube && !INSTAGRAM_HOSTS.has(host)) return null;

  const lookups = await Promise.allSettled([isYoutube ? youtubeTitle(url) : instagramCaption(url), pageDescription(url)]);
  const found = lookups.flatMap((lookup) => (lookup.status === "fulfilled" && lookup.value ? [lookup.value] : []));
  return found.join("\n").slice(0, MAX_PREVIEW_CHARS) || null;
};
