import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  announceGlobalGalleryImages,
  GalleryAnnouncementError,
} from "./galleryAnnouncements";
import handler from "../../api/announce-gallery-images";
const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("window", {
    location: { origin: "https://cptshape.github.io" },
  });
  vi.stubEnv(
    "DISCORD_ANNOUNCEMENT_WEBHOOK_URL",
    "https://discord.com/api/webhooks/123/test",
  );
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllEnvs());
function response() {
  const res: any = {
    code: 0,
    body: null,
    setHeader: vi.fn(),
    status: (code: number) => {
      res.code = code;
      return res;
    },
    json: (body: unknown) => {
      res.body = body;
      return res;
    },
    end: () => res,
  };
  return res;
}
describe("global gallery Discord announcements", () => {
  it("posts the uploader and direct image URLs with a global gallery link", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    await announceGlobalGalleryImages("Gallery User", [
      "https://i.imgur.com/a.png",
    ]);
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload).toMatchObject({
      userName: "Gallery User",
      scope: "global",
      imageUrls: ["https://i.imgur.com/a.png"],
    });
    expect(payload.galleryUrl).toContain("#tools/gallery");
  });
  it("builds global announcements with the user and image previews without mentions", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const res = response();
    await handler(
      {
        method: "POST",
        headers: {},
        body: {
          scope: "global",
          userName: "Test @everyone",
          galleryUrl: "https://example.com/#tools/gallery",
          imageUrls: ["https://i.imgur.com/a.png"],
        },
      } as any,
      res,
    );
    expect(res.code).toBe(200);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.allowed_mentions).toEqual({ parse: [] });
    expect(sent.embeds[0].description).toContain(
      "global galeriye **1 görsel** yükledi",
    );
    expect(sent.embeds[0].description).not.toContain("İsimsiz karakter");
    expect(sent.embeds[0].image.url).toBe("https://i.imgur.com/a.png");
  });
  it("reports successfully announced chunks so retries can skip them", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response("Rate limited", { status: 429 }));
    const res = response();
    await handler(
      {
        method: "POST",
        headers: {},
        body: {
          scope: "global",
          userName: "User",
          galleryUrl: "https://example.com/#tools/gallery",
          imageUrls: Array.from(
            { length: 11 },
            (_, index) => `https://i.imgur.com/${index}.png`,
          ),
        },
      } as any,
      res,
    );
    expect(res.code).toBe(502);
    expect(res.body.announcedImages).toBe(10);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).embeds).toHaveLength(10);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(res.body), { status: 502 }),
    );
    await expect(
      announceGlobalGalleryImages(
        "User",
        Array.from(
          { length: 11 },
          (_, index) => `https://i.imgur.com/${index}.png`,
        ),
      ),
    ).rejects.toMatchObject({ announcedImages: 10 });
  });
  it("reports network failures without treating publication as failed", async () => {
    fetchMock.mockRejectedValue(new Error("Offline"));
    await expect(
      announceGlobalGalleryImages("User", ["https://i.imgur.com/a.png"]),
    ).rejects.toBeInstanceOf(GalleryAnnouncementError);
  });
});
