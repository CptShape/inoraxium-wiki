import { useState } from "react";
import {
  CharacterGalleryImage,
  CharacterGalleryTagCategory,
} from "../types/character";
import {
  characterImageTagScopes,
  GalleryTag,
  galleryImageUrl,
  normalizeTag,
} from "../lib/gallery";
import { saveCharacterGalleryImageTags } from "../lib/firestore";
import { useGallery } from "../lib/useGallery";
import { GalleryDialog, GalleryTagPicker } from "./GalleryControls";
import "./gallery.css";

export function CharacterGalleryTagEditor({
  image,
  images,
  categories,
  characterId,
  uid,
  isAdmin,
  onSaved,
  onClose,
  onPreview,
}: {
  image: CharacterGalleryImage;
  images: CharacterGalleryImage[];
  categories: Record<string, CharacterGalleryTagCategory>;
  characterId: string;
  uid: string | null;
  isAdmin: boolean;
  onSaved: (
    image: CharacterGalleryImage,
    categories: Record<string, CharacterGalleryTagCategory>,
  ) => void;
  onClose: () => void;
  onPreview: () => void;
}) {
  const gallery = useGallery(true);
  if (!gallery.ready && !gallery.error)
    return (
      <GalleryDialog title="Image tags" onClose={onClose}>
        <p role="status">Loading global tags…</p>
      </GalleryDialog>
    );
  if (gallery.error)
    return (
      <GalleryDialog title="Image tags" onClose={onClose}>
        <p role="alert">{gallery.error}</p>
      </GalleryDialog>
    );
  return (
    <LoadedEditor
      key={image.id}
      {...{
        image,
        images,
        categories,
        characterId,
        uid,
        isAdmin,
        onSaved,
        onClose,
        onPreview,
      }}
      gallery={gallery}
    />
  );
}
function LoadedEditor({
  image,
  images,
  categories,
  characterId,
  uid,
  isAdmin,
  onSaved,
  onClose,
  onPreview,
  gallery,
}: Parameters<typeof CharacterGalleryTagEditor>[0] & {
  gallery: ReturnType<typeof useGallery>;
}) {
  const central = gallery.centralImages.find(
    (post) =>
      post.id === image.globalGalleryImageId ||
      galleryImageUrl(post) === galleryImageUrl(image),
  );
  const scopes = characterImageTagScopes(image, categories);
  const canEditShared = !central || central.userId === uid || isAdmin;
  const [shared, setShared] = useState<string[]>(
    central ? central.tags || [] : scopes.shared,
  );
  const [specific, setSpecific] = useState(scopes.specific);
  const [created, setCreated] = useState<GalleryTag[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const choices = [
    ...new Map(
      [
        ...scopes.shared.map(
          (name) =>
            ({ name, category: categories[name] || "general" }) as GalleryTag,
        ),
        ...gallery.tags.filter((tag) => tag.category !== "character-specific"),
        ...created,
      ].map((tag) => [tag.name, tag]),
    ).values(),
  ];
  const localChoices: GalleryTag[] = [
    ...new Set(
      images.flatMap(
        (item) => characterImageTagScopes(item, categories).specific,
      ),
    ),
  ].map((name) => ({ name, category: "character-specific" }));
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const next = await saveCharacterGalleryImageTags(
        uid,
        characterId,
        image,
        shared,
        specific,
        choices,
        categories,
        central,
        canEditShared,
      );
      const nextCategories = { ...categories };
      choices
        .filter((tag) => shared.includes(tag.name))
        .forEach((tag) => {
          nextCategories[tag.name] = tag.category;
        });
      specific.forEach((name) => {
        nextCategories[normalizeTag(name)] = "character-specific";
      });
      onSaved(next, nextCategories);
      onClose();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Tags could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <GalleryDialog
      title="Image tags"
      className="character-gallery-tag-dialog"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="gallery-modal-body character-gallery-tag-layout">
        <div className="character-gallery-tag-preview">
          <img
            src={galleryImageUrl(image)}
            alt={image.label || "Character gallery image"}
          />
          <h3>{image.label || "Untitled image"}</h3>
          <button type="button" onClick={onPreview} disabled={busy}>
            View full image ↗
          </button>
        </div>
        <div className="character-gallery-tag-fields">
          <section>
            <h3>Global tags</h3>
            <p>
              Shared across the gallery. Adding a global tag publishes this
              image, including images from private characters.
            </p>
            {!canEditShared && (
              <p>
                Only the uploader or an administrator can change global tags.
                You can still add character-specific tags below.
              </p>
            )}
            <fieldset disabled={busy || !canEditShared}>
              <GalleryTagPicker
                label="Global tags"
                selected={shared}
                onChange={setShared}
                tags={choices}
                categories={["character", "meta", "general"]}
                onCreate={(tag) =>
                  setCreated((previous) => [
                    ...previous.filter((item) => item.name !== tag.name),
                    tag,
                  ])
                }
              />
            </fieldset>
          </section>
          <section className="character-gallery-specific">
            <h3>Only this character</h3>
            <p>
              Character Specific tags stay on this character and never appear in
              the global tag library.
            </p>
            <fieldset disabled={busy}>
              <GalleryTagPicker
                label="Character Specific tags"
                selected={specific}
                onChange={setSpecific}
                tags={localChoices}
                categories={["character-specific"]}
                onCreate={() => {}}
              />
            </fieldset>
          </section>
          {error && (
            <p className="gallery-error" role="alert">
              {error}
            </p>
          )}
          <div className="character-gallery-tag-actions">
            <button type="button" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className="gallery-primary"
              onClick={() => void save()}
              disabled={busy}
            >
              {busy ? "Saving tags…" : "Save tags"}
            </button>
          </div>
          <p className="character-gallery-save-note">
            Tags save immediately. Use Save Character for other sheet changes.
          </p>
        </div>
      </div>
    </GalleryDialog>
  );
}
