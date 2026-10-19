import { Heart, Rocket, Star } from "lucide-react";
import { GalleryPost } from "../lib/gallery";
import { useGalleryReactions } from "../lib/useGalleryReactions";

export function GalleryReactions({
  image,
  reactions,
}: {
  image: GalleryPost;
  reactions: ReturnType<typeof useGalleryReactions>;
}) {
  const own = reactions.reaction(image);
  return (
    <div
      role="group"
      className="gallery-reactions"
      aria-label={`Reactions for ${image.label || image.id}`}
    >
      <button
        type="button"
        aria-label="Favorite image"
        aria-pressed={own.favorite}
        disabled={!reactions.ready(image)}
        onClick={() => void reactions.react(image, "favorite")}
        title="Save to your favorites"
      >
        <Star size={16} fill={own.favorite ? "currentColor" : "none"} />
        <span>Favorite</span>
      </button>
      <button
        type="button"
        aria-label="Like image"
        aria-pressed={own.liked}
        disabled={!reactions.ready(image)}
        onClick={() => void reactions.react(image, "like")}
        title="Like or unlike this image"
      >
        <Heart size={16} fill={own.liked ? "currentColor" : "none"} />
        <output aria-label="Total likes" aria-live="polite">
          {reactions.likes(image)}
        </output>
      </button>
      <button
        type="button"
        aria-label="Rocket image"
        disabled={!reactions.ready(image)}
        onClick={() => void reactions.react(image, "rocket")}
        title="Every click adds to your personal rocket counter"
      >
        <Rocket size={16} />
        <output aria-label="Your rocket count" aria-live="polite">
          {own.rockets}
        </output>
      </button>
    </div>
  );
}
