import { CharacterGalleryImage } from "../types/character";
import { galleryImageUrl } from "./gallery";

export interface GalleryReaction {
  liked: boolean;
  favorite: boolean;
  rockets: number;
  updatedAt?: number;
}
export interface GalleryLikeCount {
  likes: number;
}
export type GalleryReactionAction = "like" | "favorite" | "rocket";
export const EMPTY_GALLERY_REACTION: GalleryReaction = {
  liked: false,
  favorite: false,
  rockets: 0,
};
/** URL identity keeps reactions when a legacy character image is published centrally. */
export async function galleryReactionKey(
  image: CharacterGalleryImage,
): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(galleryImageUrl(image)),
  );
  return Array.from(new Uint8Array(bytes), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}
export function nextGalleryReaction(
  current: GalleryReaction,
  action: GalleryReactionAction,
): GalleryReaction {
  if (!["like", "favorite", "rocket"].includes(action))
    throw new Error("Invalid gallery reaction.");
  if (action === "rocket" && current.rockets >= Number.MAX_SAFE_INTEGER)
    throw new Error("Rocket counter limit reached.");
  return {
    ...current,
    ...(action === "like"
      ? { liked: !current.liked }
      : action === "favorite"
        ? { favorite: !current.favorite }
        : { rockets: current.rockets + 1 }),
    updatedAt: Date.now(),
  };
}
