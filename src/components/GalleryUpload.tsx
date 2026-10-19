import { useEffect, useRef, useState } from "react";
import { ImagePlus, Link, Upload, X } from "lucide-react";
import {
  GalleryPost,
  GalleryTag,
  galleryImageUrl,
  imageTags,
  normalizeTag,
  resolveGalleryLinks,
} from "../lib/gallery";
import { loadImgurAlbumImages } from "../lib/imgur";
import { uploadImageToPixhost } from "../lib/pixhost";
import {
  announceGlobalGalleryImages,
  GalleryAnnouncementError,
} from "../lib/galleryAnnouncements";
import { authProvider } from "../lib/auth";
import { saveGlobalGallery } from "../lib/firestore";
import { GalleryDialog, GalleryTagPicker } from "./GalleryControls";

interface Draft extends GalleryPost {
  file?: File;
  preview?: string;
  error?: string;
}
export function GalleryUpload({
  uid,
  tags,
  existing,
  initial,
  onClose,
}: {
  uid: string | null;
  tags: GalleryTag[];
  existing: GalleryPost[];
  initial?: GalleryPost;
  onClose: () => void;
}) {
  const [drafts, setDrafts] = useState<Draft[]>(
    initial ? [{ ...initial, tags: imageTags(initial) }] : [],
  );
  const [published, setPublished] = useState<{
    count: number;
    remaining: string[];
  } | null>(null);
  const [newTags, setNewTags] = useState<GalleryTag[]>([]);
  const [commonTags, setCommonTags] = useState<string[]>([]);
  const [links, setLinks] = useState(""),
    [album, setAlbum] = useState("");
  const [busy, setBusy] = useState(false),
    [importing, setImporting] = useState(false);
  const [status, setStatus] = useState(""),
    [error, setError] = useState("");
  const [preserveOriginal, setPreserveOriginal] = useState(true);
  const urls = useRef<string[]>([]);
  useEffect(
    () => () => urls.current.forEach((url) => URL.revokeObjectURL(url)),
    [],
  );
  useEffect(() => {
    if (!drafts.length || published) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [drafts.length, published]);
  const allTags = [
    ...new Map([...tags, ...newTags].map((tag) => [tag.name, tag])).values(),
  ];
  const createTag = (tag: GalleryTag) =>
    setNewTags((current) => [
      ...current.filter((item) => item.name !== tag.name),
      tag,
    ]);
  const update = (id: string, patch: Partial<Draft>) =>
    setDrafts((current) =>
      current.map((image) =>
        image.id === id ? { ...image, ...patch } : image,
      ),
    );
  const append = (images: Array<Partial<Draft> & Pick<Draft, "url">>) => {
    const known = new Set(
      [...existing.filter((image) => image.id !== initial?.id), ...drafts]
        .map(galleryImageUrl)
        .filter(Boolean),
    );
    const next: Draft[] = [];
    images.forEach((image) => {
      const url = image.url ? galleryImageUrl(image as GalleryPost) : "";
      if (url && known.has(url)) return;
      if (url) known.add(url);
      next.push({
        ...image,
        id: crypto.randomUUID(),
        userId: uid || "guest",
        url: image.url,
        label: image.label || "",
        tags: [...commonTags],
        createdAt: Date.now() + next.length,
      });
    });
    if (drafts.length + next.length > 100) {
      setError("Up to 100 images can be prepared in one upload.");
      return;
    }
    setDrafts((current) => [...current, ...next]);
    setStatus(
      `${next.length} image(s) added to the queue. ${images.length - next.length} duplicate(s) skipped.`,
    );
    setError("");
  };
  const sendAnnouncement = async (remaining: string[], count: number) => {
    try {
      await announceGlobalGalleryImages(
        authProvider.getDisplayName() || "Bir kullanıcı",
        remaining,
      );
      onClose();
    } catch (reason) {
      const acknowledged =
        reason instanceof GalleryAnnouncementError ? reason.announcedImages : 0;
      setPublished({ count, remaining: remaining.slice(acknowledged) });
      setError(
        `Images published. ${reason instanceof Error ? reason.message : "Discord announcement failed."} You can retry the announcement without uploading again.`,
      );
    }
  };
  const retryAnnouncement = async () => {
    if (!published || busy) return;
    setBusy(true);
    setError("");
    try {
      await sendAnnouncement(published.remaining, published.count);
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!drafts.length || busy || importing) return;
    setBusy(true);
    setError("");
    const ready: GalleryPost[] = [];
    let failed = false;
    try {
      for (const [index, draft] of drafts.entries()) {
        setStatus(`Preparing ${index + 1} / ${drafts.length}…`);
        let url = draft.url,
          thumbUrl = draft.thumbUrl;
        if (draft.file && !url) {
          try {
            const uploaded = await uploadImageToPixhost(draft.file, {
              preserveOriginal,
            });
            url = uploaded.showUrl;
            thumbUrl = uploaded.thumbUrl;
            update(draft.id, { url, thumbUrl, error: "" });
          } catch (reason) {
            failed = true;
            update(draft.id, {
              error:
                reason instanceof Error ? reason.message : "Upload failed.",
            });
            continue;
          }
        }
        ready.push({
          id: draft.id,
          userId: uid || "guest",
          url,
          thumbUrl: thumbUrl || url,
          label: draft.label || "",
          tags: imageTags(draft),
          createdAt: draft.createdAt || Date.now(),
        });
      }
      if (failed) {
        setError(
          "Some files could not be uploaded. Nothing has been published; retry failed files or remove them. Successful uploads will be reused.",
        );
        return;
      }
      if (new Set(ready.map(galleryImageUrl)).size !== ready.length) {
        setError(
          "The queue contains duplicate image URLs. Remove the duplicate before saving.",
        );
        return;
      }
      const used = new Set(ready.flatMap(imageTags));
      const definitions = allTags.filter((tag) => used.has(tag.name));
      used.forEach((name) => {
        if (!definitions.some((tag) => tag.name === name))
          definitions.push({ name: normalizeTag(name), category: "general" });
      });
      await saveGlobalGallery(uid, ready, definitions);
      if (!initial && uid && uid !== "guest") {
        const remaining = ready.map(galleryImageUrl);
        setPublished({ count: ready.length, remaining });
        await sendAnnouncement(remaining, ready.length);
      } else onClose();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Publishing failed. Your upload queue is still here.",
      );
    } finally {
      setBusy(false);
    }
  };
  const close = () => {
    if (busy || importing) return;
    if (drafts.length && !window.confirm("Discard this unsaved upload queue?"))
      return;
    onClose();
  };
  if (published)
    return (
      <GalleryDialog
        title="Images published"
        onClose={() => {
          if (!busy) onClose();
        }}
      >
        <div className="gallery-modal-body">
          <p role="status">
            {published.count} image(s) published to the gallery.
          </p>
          {error ? (
            <p role="alert" className="gallery-error">
              {error}
            </p>
          ) : (
            <p>Sending Discord announcement…</p>
          )}
        </div>
        <footer>
          <button type="button" onClick={onClose} disabled={busy}>
            Done
          </button>
          <button
            type="button"
            className="gallery-primary"
            onClick={() => void retryAnnouncement()}
            disabled={busy || !published.remaining.length}
          >
            {busy ? "Sending…" : "Retry Discord announcement"}
          </button>
        </footer>
      </GalleryDialog>
    );
  return (
    <GalleryDialog
      title={initial ? "Edit image & tags" : "Add images to the archive"}
      onClose={close}
      className="gallery-upload"
    >
      <div className="gallery-modal-body">
        {!uid || uid === "guest" ? (
          <p className="gallery-notice">
            Guest mode: gallery changes are saved in this browser only. Sign in
            to publish to the shared gallery.
          </p>
        ) : (
          <p className="gallery-muted">
            Published images are visible to everyone. Review each image and its
            tags before publishing.
          </p>
        )}
        {!initial && (
          <fieldset
            disabled={busy || importing}
            className="gallery-import-grid"
          >
            <label className="gallery-file-drop">
              <ImagePlus size={28} />
              <strong>Choose image files</strong>
              <span>Single or bulk · uploaded through Pixhost</span>
              <input
                type="file"
                multiple
                accept="image/*"
                aria-label="Choose gallery image files"
                onChange={(event) => {
                  const files = Array.from(event.target.files || []);
                  const valid = files.filter((file) =>
                    file.type.startsWith("image/"),
                  );
                  append(
                    valid.map((file) => {
                      const preview = URL.createObjectURL(file);
                      urls.current.push(preview);
                      return {
                        url: "",
                        file,
                        preview,
                        label: file.name.replace(/\.[^.]+$/, ""),
                      };
                    }),
                  );
                  event.target.value = "";
                }}
              />
            </label>
            <div>
              <label className="gallery-field-label" htmlFor="gallery-links">
                Imgur / Pixhost links or BBCode
              </label>
              <textarea
                id="gallery-links"
                rows={3}
                value={links}
                onChange={(event) => setLinks(event.target.value)}
                placeholder="Paste one or many image links / Pixhost BBCode blocks…"
              />
              <button
                type="button"
                onClick={async () => {
                  setImporting(true);
                  setError("");
                  try {
                    const images = await resolveGalleryLinks(links);
                    if (!images.length) {
                      setError(
                        "No images found. Paste direct images, Pixhost links / BBCode, or use Album import for Imgur albums.",
                      );
                      return;
                    }
                    append(images);
                    setLinks("");
                  } catch (reason) {
                    setError(
                      reason instanceof Error
                        ? reason.message
                        : "Links could not be imported.",
                    );
                  } finally {
                    setImporting(false);
                  }
                }}
              >
                <Link size={15} /> Preview links
              </button>
            </div>
            <div>
              <label className="gallery-field-label" htmlFor="gallery-album">
                Imgur album
              </label>
              <input
                id="gallery-album"
                value={album}
                onChange={(event) => setAlbum(event.target.value)}
                placeholder="https://imgur.com/a/…"
              />
              <button
                type="button"
                disabled={!album.trim()}
                onClick={async () => {
                  setImporting(true);
                  setError("");
                  try {
                    append(await loadImgurAlbumImages(album));
                    setAlbum("");
                  } catch (reason) {
                    setError(
                      reason instanceof Error
                        ? reason.message
                        : "Album import failed.",
                    );
                  } finally {
                    setImporting(false);
                  }
                }}
              >
                <Upload size={15} /> Import album
              </button>
            </div>
            <label className="gallery-check">
              <input
                type="checkbox"
                checked={preserveOriginal}
                onChange={(event) => setPreserveOriginal(event.target.checked)}
              />{" "}
              Preserve original upload quality
            </label>
          </fieldset>
        )}
        {!initial && (
          <fieldset
            disabled={busy || importing}
            className="gallery-common-tags"
          >
            <GalleryTagPicker
              label="Common tags"
              selected={commonTags}
              onChange={setCommonTags}
              tags={allTags}
              onCreate={createTag}
            />
            <button
              type="button"
              disabled={!commonTags.length || !drafts.length}
              onClick={() =>
                setDrafts((current) =>
                  current.map((image) => ({
                    ...image,
                    tags: [...new Set([...imageTags(image), ...commonTags])],
                  })),
                )
              }
            >
              Add common tags to all queued images
            </button>
            <small>
              New images receive these tags automatically. Individual changes
              stay independent.
            </small>
          </fieldset>
        )}
        <div aria-live="polite" className="gallery-muted">
          {importing ? "Reading album…" : status}
        </div>
        {error && (
          <p role="alert" className="gallery-error">
            {error}
          </p>
        )}
        <fieldset disabled={busy || importing} className="gallery-drafts">
          {drafts.map((image, index) => (
            <article key={image.id} className="gallery-draft">
              <div className="gallery-draft-preview">
                <img
                  src={
                    image.preview || image.thumbUrl || galleryImageUrl(image)
                  }
                  alt={image.label || `Queued image ${index + 1}`}
                />
                <span>{String(index + 1).padStart(2, "0")}</span>
              </div>
              <div>
                <div className="gallery-draft-heading">
                  <label>
                    Image label
                    <input
                      aria-label={`Image ${index + 1} label`}
                      value={image.label || ""}
                      onChange={(event) =>
                        update(image.id, { label: event.target.value })
                      }
                    />
                  </label>
                  {!initial && (
                    <button
                      type="button"
                      aria-label={`Remove queued image ${index + 1}`}
                      onClick={() =>
                        setDrafts((current) =>
                          current.filter((item) => item.id !== image.id),
                        )
                      }
                    >
                      <X size={17} />
                    </button>
                  )}
                </div>
                <GalleryTagPicker
                  label={`Image ${index + 1} tags`}
                  selected={imageTags(image)}
                  onChange={(tags) => update(image.id, { tags })}
                  tags={allTags}
                  onCreate={createTag}
                />
                {image.error && <p className="gallery-error">{image.error}</p>}
              </div>
            </article>
          ))}
        </fieldset>
        {!drafts.length && (
          <div className="gallery-empty">
            Your upload queue is empty. Add files, links or an album above.
          </div>
        )}
      </div>
      <footer>
        <span>{drafts.length} / 100 images</span>
        <button type="button" disabled={busy || importing} onClick={close}>
          Cancel
        </button>
        <button
          className="gallery-primary"
          type="button"
          disabled={!drafts.length || busy || importing}
          onClick={() => void save()}
        >
          {busy
            ? "Saving…"
            : initial
              ? "Save changes"
              : !uid || uid === "guest"
                ? "Save to this browser"
                : "Publish images"}
        </button>
      </footer>
    </GalleryDialog>
  );
}
