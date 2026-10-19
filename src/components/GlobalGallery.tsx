import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  ImageIcon,
  Plus,
  Search,
  SlidersHorizontal,
  Tags,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
  Star,
} from "lucide-react";
import {
  GalleryPost,
  GalleryTag,
  GALLERY_CATEGORIES,
  GALLERY_CATEGORY_LABELS,
  galleryImageUrl,
  imageTags,
  matchesGalleryQuery,
  normalizeTag,
  parseGalleryQuery,
  setQueryTag,
} from "../lib/gallery";
import { GalleryReactions } from "./GalleryReactions";
import { useGalleryReactions } from "../lib/useGalleryReactions";
import { useGallery } from "../lib/useGallery";
import {
  deleteGlobalGalleryImage,
  loadAdminAccess,
  saveGlobalGallery,
  pruneUnusedGalleryTags,
} from "../lib/firestore";
import { GalleryDialog, GallerySearch } from "./GalleryControls";
import { GalleryUpload } from "./GalleryUpload";
import { GalleryImageTagEditor } from "./GalleryImageTagEditor";
import { CharacterGalleryTagCategory } from "../types/character";
import "./gallery.css";

function GalleryLightbox({
  images,
  image,
  uid,
  onSelect,
  onClose,
  onEdit,
  onDelete,
  isAdmin,
  tags,
  onTagsSaved,
  reactions,
}: {
  images: GalleryPost[];
  image: GalleryPost;
  uid: string | null;
  onSelect: (image: GalleryPost) => void;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  isAdmin: boolean;
  tags: GalleryTag[];
  onTagsSaved: (image: GalleryPost) => void;
  reactions: ReturnType<typeof useGalleryReactions>;
}) {
  const [zoom, setZoom] = useState(1);
  const index = images.findIndex((item) => item.id === image.id);
  const canEdit = !image.sourceCharacterId && image.userId === (uid || "guest");
  useEffect(() => setZoom(1), [image.id]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).matches("input,textarea,select"))
        return;
      if (event.key === "ArrowRight" && images.length > 1)
        onSelect(images[(index + 1) % images.length]);
      if (event.key === "ArrowLeft" && images.length > 1)
        onSelect(images[(index - 1 + images.length) % images.length]);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [images, index, onSelect]);
  return (
    <GalleryDialog
      title={image.label || "Untitled image"}
      onClose={onClose}
      className="gallery-lightbox"
    >
      <div className="gallery-lightbox-toolbar">
        <span>
          {index + 1} / {images.length}
        </span>
        <button
          type="button"
          aria-label="Previous image"
          disabled={images.length < 2}
          onClick={() =>
            onSelect(images[(index - 1 + images.length) % images.length])
          }
        >
          <ArrowLeft size={17} />
        </button>
        <button
          type="button"
          aria-label="Next image"
          disabled={images.length < 2}
          onClick={() => onSelect(images[(index + 1) % images.length])}
        >
          <ArrowRight size={17} />
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          disabled={zoom <= 0.5}
          onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}
        >
          <ZoomOut size={17} />
        </button>
        <button type="button" onClick={() => setZoom(1)}>
          Fit · {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          aria-label="Zoom in"
          disabled={zoom >= 4}
          onClick={() => setZoom((value) => Math.min(4, value + 0.25))}
        >
          <ZoomIn size={17} />
        </button>
        <a href={galleryImageUrl(image)} target="_blank" rel="noreferrer">
          Open original ↗
        </a>
      </div>
      <div
        className={`gallery-lightbox-content ${isAdmin || canEdit ? "has-tag-editor" : ""}`}
      >
        <div
          className={`gallery-lightbox-canvas ${zoom !== 1 ? "is-zoomed" : ""}`}
        >
          <img
            key={image.id}
            src={galleryImageUrl(image)}
            alt={image.label || "Gallery image"}
            style={
              zoom === 1
                ? {}
                : {
                    width: `${zoom * 100}%`,
                    maxWidth: "none",
                    maxHeight: "none",
                  }
            }
          />
        </div>
        {(isAdmin || canEdit) && (
          <GalleryImageTagEditor
            key={image.id}
            image={image}
            tags={tags}
            uid={uid}
            onSaved={onTagsSaved}
          />
        )}
      </div>
      <footer>
        <GalleryReactions image={image} reactions={reactions} />
        <div className="gallery-tag-chips">
          {imageTags(image).map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
        {image.sourceCharacterId ? (
          <a
            href={`#homebrew-gallery/${encodeURIComponent(image.sourceCharacterId)}`}
          >
            From {image.sourceCharacterName} ↗
          </a>
        ) : (
          canEdit && (
            <>
              <button type="button" onClick={onEdit}>
                Edit tags & label
              </button>
              <button
                type="button"
                className="gallery-danger"
                onClick={onDelete}
              >
                <Trash2 size={14} /> Delete
              </button>
            </>
          )
        )}
      </footer>
    </GalleryDialog>
  );
}

function GalleryTagManager({
  tags,
  uid,
  onClose,
}: {
  tags: GalleryTag[];
  uid: string | null;
  onClose: () => void;
}) {
  const [name, setName] = useState(""),
    [category, setCategory] = useState<CharacterGalleryTagCategory>("general");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  const save = async () => {
    const normalized = normalizeTag(name);
    if (!normalized) return;
    if (!tags.some((tag) => tag.name === normalized)) {
      setError(
        "Create new tags while adding or editing an image. Tags with no images are removed automatically.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      await saveGlobalGallery(uid, [], [{ name: normalized, category }]);
      setStatus(`Saved ${normalized}.`);
      setName("");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Tag could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <GalleryDialog title="Tag library" onClose={onClose}>
      <div className="gallery-modal-body">
        <p className="gallery-muted">
          Select a tag to change its category. Create new tags when uploading or
          editing images; unused tags are removed automatically.
        </p>
        <label>
          Tag name
          <input
            aria-label="Tag library name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="ayrton_octappen"
          />
        </label>
        <label>
          Category
          <select
            aria-label="Tag library category"
            value={category}
            onChange={(event) =>
              setCategory(event.target.value as CharacterGalleryTagCategory)
            }
          >
            {GALLERY_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {GALLERY_CATEGORY_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        {error && (
          <p role="alert" className="gallery-error">
            {error}
          </p>
        )}
        <p role="status">{status}</p>
        <div className="gallery-tag-library">
          {GALLERY_CATEGORIES.map((value) => (
            <section key={value}>
              <h3 data-category={value}>{GALLERY_CATEGORY_LABELS[value]}</h3>
              {tags
                .filter((tag) => tag.category === value)
                .map((tag) => (
                  <button
                    type="button"
                    key={tag.name}
                    onClick={() => {
                      setName(tag.name);
                      setCategory(tag.category);
                    }}
                  >
                    {tag.name}
                  </button>
                ))}
            </section>
          ))}
        </div>
      </div>
      <footer>
        <button
          type="button"
          disabled={busy || !normalizeTag(name)}
          className="gallery-primary"
          onClick={() => void save()}
        >
          {busy ? "Saving…" : "Save tag"}
        </button>
      </footer>
    </GalleryDialog>
  );
}

export default function GlobalGallery() {
  const {
    uid,
    images,
    tags,
    unusedTagNames,
    loading,
    error: loadError,
  } = useGallery(true);
  const cleanupAttempt = useRef("");
  const unusedSignature = JSON.stringify(unusedTagNames);
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    let active = true;
    setIsAdmin(false);
    if (uid && uid !== "guest")
      loadAdminAccess(uid)
        .then((access) => {
          if (active) setIsAdmin(access.isAdmin);
        })
        .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [uid]);
  useEffect(() => {
    if (!isAdmin && uid && uid !== "guest") return;
    const key = `${uid}:${unusedSignature}`;
    if (!unusedTagNames.length) {
      cleanupAttempt.current = "";
      return;
    }
    if (cleanupAttempt.current === key) return;
    cleanupAttempt.current = key;
    void pruneUnusedGalleryTags(uid, JSON.parse(unusedSignature)).catch(
      (reason) =>
        console.warn("Unused gallery tags could not be removed:", reason),
    );
  }, [uid, isAdmin, unusedSignature]);
  const [query, setQuery] = useState(
    () => new URLSearchParams(window.location.search).get("gallery_q") || "",
  );
  const deferredQuery = useDeferredValue(query);
  const reactions = useGalleryReactions(uid, images);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);
  const [tagSearch, setTagSearch] = useState(""),
    [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1),
    [density, setDensity] = useState("comfortable");
  const [showTags, setShowTags] = useState(false),
    [upload, setUpload] = useState(false),
    [manageTags, setManageTags] = useState(false);
  const [selected, setSelected] = useState<GalleryPost | null>(null),
    [editing, setEditing] = useState<GalleryPost | undefined>();
  const [error, setError] = useState(""),
    [copied, setCopied] = useState(false);
  const filters = parseGalleryQuery(query);
  const counts = useMemo(() => {
    const result = new Map<string, number>();
    images.forEach((image) =>
      imageTags(image).forEach((tag) =>
        result.set(tag, (result.get(tag) || 0) + 1),
      ),
    );
    return result;
  }, [images]);
  const filtered = useMemo(
    () =>
      images
        .filter(
          (image) =>
            matchesGalleryQuery(image, deferredQuery) &&
            (!favoritesOnly || reactions.reaction(image).favorite),
        )
        .sort((a, b) =>
          sort === "oldest"
            ? (a.createdAt || 0) - (b.createdAt || 0)
            : sort === "label"
              ? (a.label || "").localeCompare(b.label || "")
              : (b.createdAt || 0) - (a.createdAt || 0),
        ),
    [images, deferredQuery, sort, favoritesOnly, reactions.reaction],
  );
  useEffect(() => setPage(1), [query, sort, favoritesOnly]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / 50));
  const activePage = Math.min(page, pageCount);
  useEffect(
    () => setPage((current) => Math.min(current, pageCount)),
    [pageCount],
  );
  const changePage = (value: number) => {
    setPage(Math.max(1, Math.min(pageCount, value)));
    resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const pagination = (
    <nav className="gallery-pagination" aria-label="Gallery pages">
      <button
        type="button"
        aria-label="First gallery page"
        disabled={activePage === 1}
        onClick={() => changePage(1)}
      >
        «
      </button>
      <button
        type="button"
        aria-label="Previous gallery page"
        disabled={activePage === 1}
        onClick={() => changePage(activePage - 1)}
      >
        <ArrowLeft size={15} /> Previous
      </button>
      <label>
        Page{" "}
        <select
          aria-label="Gallery page"
          value={activePage}
          onChange={(event) => changePage(Number(event.target.value))}
        >
          {Array.from({ length: pageCount }, (_, index) => (
            <option key={index + 1} value={index + 1}>
              {index + 1}
            </option>
          ))}
        </select>{" "}
        of {pageCount}
      </label>
      <button
        type="button"
        aria-label="Next gallery page"
        disabled={activePage === pageCount}
        onClick={() => changePage(activePage + 1)}
      >
        Next <ArrowRight size={15} />
      </button>
      <button
        type="button"
        aria-label="Last gallery page"
        disabled={activePage === pageCount}
        onClick={() => changePage(pageCount)}
      >
        »
      </button>
      <span>
        {filtered.length ? (activePage - 1) * 50 + 1 : 0}–
        {Math.min(activePage * 50, filtered.length)} / {filtered.length}
      </span>
    </nav>
  );
  useEffect(() => {
    const url = new URL(window.location.href);
    if (query) url.searchParams.set("gallery_q", query);
    else url.searchParams.delete("gallery_q");
    window.history.replaceState(null, "", url);
  }, [query]);
  const cycle = (tag: string) =>
    setQuery((current) => {
      const mode = parseGalleryQuery(current).get(tag);
      return setQueryTag(
        current,
        tag,
        mode === "include"
          ? "exclude"
          : mode === "exclude"
            ? undefined
            : "include",
      );
    });
  const removeImage = async (image: GalleryPost) => {
    if (
      !window.confirm(
        "Delete this image from the shared gallery? The image on its original host will remain.",
      )
    )
      return;
    try {
      await deleteGlobalGalleryImage(uid, image);
      setSelected(null);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Image could not be deleted.",
      );
    }
  };
  return (
    <div className="global-gallery">
      <header className="gallery-hero">
        <div className="gallery-eyebrow">
          <span /> THE VISUAL ARCHIVE
        </div>
        <div className="gallery-title-row">
          <div>
            <h1>
              Gallery<span aria-hidden="true">✦</span>
            </h1>
            <p>Characters, stories, and everything in between.</p>
          </div>
          <div className="gallery-hero-actions">
            <button type="button" onClick={() => setManageTags(true)}>
              <Tags size={16} /> Tag library
            </button>
            <button
              type="button"
              className="gallery-primary"
              onClick={() => {
                setEditing(undefined);
                setUpload(true);
              }}
            >
              <Plus size={18} /> Add images
            </button>
          </div>
        </div>
        <div className="gallery-search-row">
          <Search size={21} />
          <GallerySearch value={query} onChange={setQuery} tags={tags} />
          <button
            type="button"
            aria-label="Clear search"
            disabled={!query}
            onClick={() => setQuery("")}
          >
            <X size={17} />
          </button>
          <button
            type="button"
            aria-label="Copy gallery search link"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(window.location.href);
                setCopied(true);
              } catch {
                setError(
                  "The search link could not be copied. You can copy it from your address bar.",
                );
              }
            }}
          >
            {copied ? <Check size={17} /> : <Copy size={17} />}
          </button>
        </div>
        <div className="gallery-search-help">
          <span>
            <b>tag</b> must include
          </span>
          <span>
            <b>−tag</b> must exclude
          </span>
          <span>Space separates tags · ↑ ↓ and Tab to complete</span>
          <span>Likes are shared · Rocket counts are yours</span>
        </div>
        {filters.size > 0 && (
          <div className="gallery-active-filters">
            {[...filters].map(([tag, mode]) => (
              <button
                type="button"
                data-state={mode}
                key={tag}
                onClick={() => setQuery((current) => setQueryTag(current, tag))}
                aria-label={`Clear filter ${tag}`}
              >
                {mode === "exclude" ? "−" : "+"} {tag}
                <X size={12} />
              </button>
            ))}
            <button type="button" onClick={() => setQuery("")}>
              Clear all
            </button>
          </div>
        )}
      </header>
      {(loadError || error || reactions.error) && (
        <p className="gallery-error" role="alert">
          {error || loadError || reactions.error}
        </p>
      )}
      <div className="gallery-workspace">
        <aside className={`gallery-sidebar ${showTags ? "is-open" : ""}`}>
          <div className="gallery-sidebar-heading">
            <Tags size={16} />
            <h2>Explore tags</h2>
            <span>{tags.length}</span>
          </div>
          <p className="gallery-muted">
            Click: include → exclude → clear.
            <br />
            Double-click: exclude.
          </p>
          <input
            aria-label="Find tags in sidebar"
            value={tagSearch}
            onChange={(event) => setTagSearch(event.target.value)}
            placeholder="Find a tag…"
          />
          {GALLERY_CATEGORIES.map((category) => (
            <section className="gallery-category" key={category}>
              <h3 data-category={category}>
                {GALLERY_CATEGORY_LABELS[category]}
              </h3>
              {tags
                .filter(
                  (tag) =>
                    tag.category === category &&
                    tag.name.includes(normalizeTag(tagSearch)),
                )
                .map((tag) => (
                  <button
                    type="button"
                    key={tag.name}
                    data-state={filters.get(tag.name) || "neutral"}
                    aria-label={`Filter tag ${tag.name}`}
                    aria-pressed={filters.has(tag.name)}
                    onClick={(event) => {
                      if (event.detail < 2) cycle(tag.name);
                    }}
                    onDoubleClick={() =>
                      setQuery((current) =>
                        setQueryTag(current, tag.name, "exclude"),
                      )
                    }
                  >
                    <span>
                      {filters.get(tag.name) === "exclude"
                        ? "−"
                        : filters.get(tag.name) === "include"
                          ? "+"
                          : "#"}{" "}
                      {tag.name}
                    </span>
                    <small>{counts.get(tag.name) || 0}</small>
                  </button>
                ))}
              {!tags.some(
                (tag) =>
                  tag.category === category &&
                  tag.name.includes(normalizeTag(tagSearch)),
              ) && <small className="gallery-muted">No tags yet</small>}
            </section>
          ))}
        </aside>
        <main className="gallery-results" ref={resultsRef}>
          <div className="gallery-results-toolbar">
            <div className="gallery-result-count" role="status">
              {loading ? (
                "Opening archive…"
              ) : (
                <>
                  <strong>{filtered.length}</strong>{" "}
                  {filtered.length === 1 ? "image" : "images"}{" "}
                  <span>/ {images.length} in archive</span>
                </>
              )}
            </div>
            <button
              type="button"
              className="gallery-favorites-filter"
              aria-pressed={favoritesOnly}
              disabled={!uid}
              onClick={() => setFavoritesOnly((value) => !value)}
            >
              <Star size={16} fill={favoritesOnly ? "currentColor" : "none"} />{" "}
              Favorites only
            </button>
            <button
              className="gallery-mobile-tags"
              type="button"
              onClick={() => setShowTags((value) => !value)}
              aria-expanded={showTags}
            >
              <SlidersHorizontal size={15} /> Tags
            </button>
            <label className="gallery-sr-only" htmlFor="gallery-sort">
              Sort images
            </label>
            <select
              id="gallery-sort"
              value={sort}
              onChange={(event) => setSort(event.target.value)}
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="label">By label</option>
            </select>
            <label className="gallery-sr-only" htmlFor="gallery-density">
              Grid density
            </label>
            <select
              id="gallery-density"
              value={density}
              onChange={(event) => setDensity(event.target.value)}
            >
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </select>
          </div>
          {!loading && !filtered.length ? (
            <div className="gallery-empty">
              <ImageIcon size={42} />
              <h2>
                {images.length
                  ? "No images match these tags"
                  : "A new chapter, in pictures."}
              </h2>
              <p>
                {images.length
                  ? "Try removing a filter or checking the spelling of your tags."
                  : "Add your first images and build a shared visual archive."}
              </p>
              <button
                type="button"
                onClick={() => {
                  if (images.length) {
                    setQuery("");
                    setFavoritesOnly(false);
                  } else setUpload(true);
                }}
              >
                {images.length ? "Reset filters" : "Add images"}
              </button>
            </div>
          ) : (
            <div className={`gallery-grid gallery-grid-${density}`}>
              {filtered
                .slice((activePage - 1) * 50, activePage * 50)
                .map((image) => (
                  <article className="gallery-card" key={image.id}>
                    <button
                      className="gallery-card-image"
                      type="button"
                      aria-label={`Open image ${image.label || image.id}`}
                      onClick={() => setSelected(image)}
                    >
                      <img
                        loading="lazy"
                        decoding="async"
                        src={image.thumbUrl || galleryImageUrl(image)}
                        alt={image.label || "Gallery image"}
                        onError={(event) => {
                          const full = galleryImageUrl(image);
                          if (event.currentTarget.src !== full)
                            event.currentTarget.src = full;
                        }}
                      />
                      <span className="gallery-card-overlay">View image ↗</span>
                    </button>
                    <div className="gallery-card-body">
                      <h3>{image.label || "Untitled"}</h3>
                      <div className="gallery-card-tags">
                        {imageTags(image)
                          .slice(0, 5)
                          .map((tag) => (
                            <button
                              type="button"
                              key={tag}
                              onClick={() =>
                                setQuery((current) =>
                                  setQueryTag(current, tag, "include"),
                                )
                              }
                            >
                              {tag}
                            </button>
                          ))}
                        {imageTags(image).length > 5 && (
                          <span>+{imageTags(image).length - 5}</span>
                        )}
                      </div>
                      <GalleryReactions image={image} reactions={reactions} />
                      {image.sourceCharacterName && (
                        <small>↗ {image.sourceCharacterName}</small>
                      )}
                    </div>
                  </article>
                ))}
            </div>
          )}
          {!loading && pagination}
        </main>
      </div>
      {selected && (
        <GalleryLightbox
          key={selected.id}
          images={filtered}
          image={selected}
          uid={uid}
          isAdmin={isAdmin}
          reactions={reactions}
          tags={tags}
          onTagsSaved={setSelected}
          onSelect={setSelected}
          onClose={() => setSelected(null)}
          onEdit={() => {
            setEditing(selected);
            setSelected(null);
            setUpload(true);
          }}
          onDelete={() => void removeImage(selected)}
        />
      )}
      {upload && (
        <GalleryUpload
          uid={uid}
          tags={tags}
          existing={images}
          initial={editing}
          onClose={() => {
            setUpload(false);
            setEditing(undefined);
          }}
        />
      )}
      {manageTags && (
        <GalleryTagManager
          tags={tags}
          uid={uid}
          onClose={() => setManageTags(false)}
        />
      )}
    </div>
  );
}
