import { afterEach, describe, expect, it, vi } from "vitest";
import { extractLink, fetchLinkPreview } from "../src/links/preview";

const respondWith = (handler: (url: string) => Response) => {
  const mock = vi.fn(async (url: string | URL | Request) => handler(String(url)));
  vi.stubGlobal("fetch", mock);
  return mock;
};

afterEach(() => vi.unstubAllGlobals());

describe("extractLink", () => {
  it("finds a link among words, without trailing Chinese punctuation", () => {
    expect(extractLink("看這個 https://youtu.be/abc123，好吃")).toBe("https://youtu.be/abc123");
  });

  it("returns null with no link", () => {
    expect(extractLink("beef noodles")).toBeNull();
  });
});

describe("fetchLinkPreview", () => {
  it("reads a YouTube title and page description", async () => {
    respondWith((url) =>
      url.includes("oembed")
        ? Response.json({ title: "Beef noodles", author_name: "Chef" })
        : new Response('<meta property="og:description" content="Slow &amp; rich">'),
    );
    expect(await fetchLinkPreview("https://www.youtube.com/watch?v=abc")).toBe("Beef noodles (Chef)\nSlow & rich");
  });

  it("reads Instagram page tags in either attribute order", async () => {
    respondWith(() => new Response(`<meta content='Hot pot' property='og:title'>`));
    expect(await fetchLinkPreview("https://www.instagram.com/reel/abc/")).toBe("Hot pot");
  });

  it("reads the caption from the Instagram embed page when the post page is blocked", async () => {
    const mock = respondWith((url) =>
      url.includes("/embed/captioned/")
        ? new Response('<div class="Caption"><a>chef</a><br/>Hot pot &amp; rice<div class="CaptionComments"></div></div>')
        : new Response("login", { status: 403 }),
    );
    expect(await fetchLinkPreview("https://www.instagram.com/reel/abc-1/?igsh=x")).toBe("chef\nHot pot & rice");
    expect(mock).toHaveBeenCalledWith("https://www.instagram.com/p/abc-1/embed/captioned/", expect.anything());
  });

  it("never fetches other sites", async () => {
    const mock = respondWith(() => new Response("secret"));
    expect(await fetchLinkPreview("http://169.254.169.254/latest")).toBeNull();
    expect(await fetchLinkPreview("https://example.com/")).toBeNull();
    expect(await fetchLinkPreview("https://www.instagram.com.evil.test/")).toBeNull();
    expect(mock).not.toHaveBeenCalled();
  });

  it("returns null when the site blocks or fails", async () => {
    respondWith(() => new Response("no", { status: 403 }));
    expect(await fetchLinkPreview("https://www.instagram.com/reel/abc/")).toBeNull();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    expect(await fetchLinkPreview("https://youtu.be/abc")).toBeNull();
  });

  it("limits how much text goes to the LLM", async () => {
    respondWith(() => new Response(`<meta property="og:title" content="${"x".repeat(5000)}">`));
    expect((await fetchLinkPreview("https://www.instagram.com/p/abc/"))?.length).toBe(1500);
  });
});
