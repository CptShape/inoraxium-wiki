import { useState } from "react";
import { GalleryPost, GalleryTag, imageTags } from "../lib/gallery";
import { saveGalleryImageTags } from "../lib/firestore";
import { GalleryTagPicker } from "./GalleryControls";

export function GalleryImageTagEditor({
  image,
  tags,
  uid,
  onSaved,
}: {
  image: GalleryPost;
  tags: GalleryTag[];
  uid: string | null;
  onSaved: (image: GalleryPost) => void;
}) {
  const inherited = image.inheritedTags || [];
  const [selected, setSelected] = useState(() =>
    imageTags(image).filter((tag) => !inherited.includes(tag)),
  );
  const [created, setCreated] = useState<GalleryTag[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  const choices = [
    ...new Map([...tags, ...created].map((tag) => [tag.name, tag])).values(),
  ];
  const save = async () => {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await saveGalleryImageTags(uid, image, selected, choices);
      onSaved({ ...image, tags: [...new Set([...selected, ...inherited])] });
      setSaved(true);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Tags could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <aside className="gallery-image-tag-editor" aria-label="Image tag editor">
      <h3>Image tags</h3>
      <p>Add, remove or create tags for this image.</p>
      <fieldset disabled={busy}>
        <GalleryTagPicker
          label="Image tags"
          selected={selected}
          onChange={(next) => {
            setSelected(next);
            setSaved(false);
          }}
          tags={choices}
          onCreate={(tag) =>
            setCreated((current) => [
              ...current.filter((item) => item.name !== tag.name),
              tag,
            ])
          }
        />
        {inherited.length > 0 && (
          <div className="gallery-inherited-tags">
            <p>From the character connection</p>
            <div className="gallery-tag-chips">
              {inherited.map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
          </div>
        )}
        <button
          type="button"
          className="gallery-primary"
          onClick={() => void save()}
        >
          {busy ? "Saving tags…" : "Save image tags"}
        </button>
      </fieldset>
      {error && (
        <p role="alert" className="gallery-error">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="gallery-tag-saved">
          Tags saved.
        </p>
      )}
    </aside>
  );
}
