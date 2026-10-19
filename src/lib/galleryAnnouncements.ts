import { apiUrl } from "./api";
export class GalleryAnnouncementError extends Error {
  constructor(
    message: string,
    public announcedImages = 0,
  ) {
    super(message);
  }
}
export async function announceGlobalGalleryImages(
  userName: string,
  imageUrls: string[],
): Promise<void> {
  if (!imageUrls.length) return;
  const galleryUrl = new URL(import.meta.env.BASE_URL, window.location.origin);
  galleryUrl.hash = "tools/gallery";
  let response: Response;
  try {
    response = await fetch(apiUrl("/api/announce-gallery-images"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope: "global",
        userName,
        galleryUrl: galleryUrl.toString(),
        imageUrls,
      }),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new GalleryAnnouncementError(
      "Discord announcement could not be reached. Your images are already published.",
    );
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new GalleryAnnouncementError(
      data.error || "Discord announcement failed.",
      Math.max(
        0,
        Math.min(imageUrls.length, Number(data.announcedImages) || 0),
      ),
    );
}
