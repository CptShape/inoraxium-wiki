import {
  CharacterGalleryRole,
  imageTags,
  galleryImageUrl,
  normalizeTag,
} from "../lib/gallery";
import { useGallery } from "../lib/useGallery";
import { useEffect, useState } from "react";
import { CharacterGalleryImage } from "../types/character";
import "./gallery.css";

export function GalleryCharacterBinding({
  values,
  onChange,
  disabled,
  onOpenImage,
  roleImages = [],
  onSelectRole,
  onLinkedUrlsChange,
}: {
  values: string[];
  onChange: (tags: string[]) => void;
  disabled?: boolean;
  onOpenImage?: (image: CharacterGalleryImage) => void;
  roleImages?: CharacterGalleryImage[];
  onSelectRole?: (
    image: CharacterGalleryImage,
    role: CharacterGalleryRole,
  ) => void;
  onLinkedUrlsChange?: (urls: string[]) => void;
}) {
  const [limit, setLimit] = useState(24);
  const [search, setSearch] = useState("");
  const signature = values.join("\u0000");
  useEffect(() => setLimit(24), [signature]);
  const { tags, images, loading, error } = useGallery(true);
  const choices = [
    ...new Set([
      ...values,
      ...tags
        .filter((tag) => tag.category === "character")
        .map((tag) => tag.name),
    ]),
  ];
  const linked = values.length
    ? images.filter((image) =>
        values.some((tag) => imageTags(image).includes(normalizeTag(tag))),
      )
    : [];
  const linkedUrlSignature = JSON.stringify(linked.map(galleryImageUrl));
  useEffect(() => {
    onLinkedUrlsChange?.(JSON.parse(linkedUrlSignature));
  }, [linkedUrlSignature, onLinkedUrlsChange]);
  const linkFor = (tag: string) =>
    `?gallery_q=${encodeURIComponent(tag)}#tools/gallery`;
  return (
    <div className="gallery-character-binding">
      <h4>Global gallery connection</h4>
      <p>
        Select one or more Character tags. Every global image with any selected
        tag appears in the Homebrew gallery alongside images uploaded here. Save
        the character to keep this selection.
      </p>
      <fieldset
        className="gallery-character-tag-options"
        disabled={disabled || loading}
      >
        <legend>Character gallery tags</legend>
        <input
          aria-label="Find character gallery tags"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Find a character tag…"
        />
        <div>
          {choices
            .filter((tag) => tag.includes(normalizeTag(search)))
            .map((tag) => (
              <label key={tag}>
                <input
                  type="checkbox"
                  aria-label={`Link character tag ${tag}`}
                  checked={values.includes(tag)}
                  onChange={(event) =>
                    onChange(
                      event.target.checked
                        ? [...values, tag]
                        : values.filter((value) => value !== tag),
                    )
                  }
                />
                {tag}
              </label>
            ))}
        </div>
        {!!values.length && (
          <button type="button" onClick={() => onChange([])}>
            Clear selected tags ({values.length})
          </button>
        )}
      </fieldset>
      {error && <p role="alert">{error}</p>}
      {!choices.length && !loading && (
        <p>
          Create a Character tag while adding or editing an image in Tools →
          Gallery.
        </p>
      )}
      {values.length > 0 && (
        <>
          <p>
            {linked.length} linked global image{linked.length === 1 ? "" : "s"}.
            Manage their tags in the global gallery.
          </p>
          <div className="gallery-character-previews">
            {linked.slice(0, limit).map((image) => (
              <article className="gallery-linked-role-card" key={image.id}>
                <button
                  type="button"
                  key={image.id}
                  aria-label={`Open linked image ${image.label || image.id}`}
                  onClick={() =>
                    onOpenImage
                      ? onOpenImage(image)
                      : window.location.assign(
                          linkFor(
                            values.find((tag) =>
                              imageTags(image).includes(tag),
                            ) || values[0],
                          ),
                        )
                  }
                >
                  <img
                    src={image.thumbUrl || galleryImageUrl(image)}
                    alt={image.label || "Linked global image"}
                    loading="lazy"
                  />
                  <span>{image.label || "Untitled"}</span>
                </button>
                <div className="gallery-linked-role-controls">
                  {!disabled && onOpenImage && (
                    <button type="button" onClick={() => onOpenImage(image)}>
                      Edit tags
                    </button>
                  )}
                  {(
                    ["main", "splash-art", "token"] as CharacterGalleryRole[]
                  ).map((role) => {
                    const active = (
                      roleImages.find(
                        (item) =>
                          galleryImageUrl(item) === galleryImageUrl(image),
                      )?.tags || []
                    ).includes(role);
                    return (
                      <button
                        key={role}
                        type="button"
                        aria-pressed={active}
                        disabled={disabled || !onSelectRole}
                        onClick={() => onSelectRole?.(image, role)}
                      >
                        {role === "main"
                          ? "Main"
                          : role === "splash-art"
                            ? "Splash Art"
                            : "Token"}
                      </button>
                    );
                  })}
                </div>
              </article>
            ))}
          </div>
          {linked.length > limit && (
            <button
              type="button"
              onClick={() => setLimit((current) => current + 24)}
            >
              Load more linked images ({linked.length - limit} remaining)
            </button>
          )}
          <div className="gallery-character-browse-links">
            {values.map((tag) => (
              <a key={tag} href={linkFor(tag)}>
                Browse {tag} ↗
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
