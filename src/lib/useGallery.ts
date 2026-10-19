import { useEffect, useMemo, useState } from "react";
import { authProvider } from "./auth";
import {
  subscribeGlobalGallery,
  subscribePublicGalleryCharacters,
} from "./firestore";
import {
  GalleryPost,
  GalleryTag,
  mergeGalleryImages,
  normalizeTag,
  publicCharacterGallery,
  usedGalleryTagNames,
} from "./gallery";
import { CharacterData } from "../types/character";

export function useGallery(includeLegacy = false) {
  const [uid, setUid] = useState(authProvider.getUid);
  const [images, setImages] = useState<GalleryPost[]>([]);
  const [tags, setTags] = useState<GalleryTag[]>([]);
  const [characters, setCharacters] = useState<CharacterData[]>([]);
  const [loading, setLoading] = useState(true);
  const [tagsReady, setTagsReady] = useState(false);
  const [legacyReady, setLegacyReady] = useState(!includeLegacy);
  const [error, setError] = useState("");
  useEffect(() => authProvider.onAuthChange((state) => setUid(state.uid)), []);
  useEffect(() => {
    setLoading(true);
    setError("");
    setImages([]);
    setTags([]);
    setTagsReady(false);
    return subscribeGlobalGallery(
      uid,
      (next) => {
        setImages(next);
        setLoading(false);
      },
      (next) => {
        setTags(next);
        setTagsReady(true);
      },
      (reason) => {
        setLoading(false);
        setError(
          reason instanceof Error
            ? reason.message
            : "Gallery could not be loaded.",
        );
      },
    );
  }, [uid]);
  useEffect(() => {
    setCharacters([]);
    setLegacyReady(!includeLegacy || uid === "guest");
    if (!includeLegacy || uid === "guest") return;
    return subscribePublicGalleryCharacters(
      (next) => {
        setCharacters(next);
        setLegacyReady(true);
      },
      () => setError("Some public character galleries could not be loaded."),
    );
  }, [includeLegacy, uid]);
  const legacy = useMemo(
    () => publicCharacterGallery(characters),
    [characters],
  );
  const allImages = useMemo(
    () => mergeGalleryImages(images, legacy.images) as GalleryPost[],
    [images, legacy.images],
  );
  const allTags = useMemo(() => {
    const map = new Map<string, GalleryTag>();
    legacy.tags.forEach((tag) => map.set(normalizeTag(tag.name), tag));
    tags.forEach((tag) => map.set(normalizeTag(tag.name), tag));
    allImages.forEach((image) =>
      (image.tags || []).forEach((raw) => {
        const name = normalizeTag(raw);
        if (name && !map.has(name))
          map.set(name, { name, category: "general" });
      }),
    );
    const used = usedGalleryTagNames(allImages);
    return [...map.values()]
      .filter((tag) => used.has(normalizeTag(tag.name)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [tags, legacy.tags, allImages]);
  const unusedTagNames = useMemo(() => {
    if (loading || !tagsReady || !legacyReady) return [];
    const used = usedGalleryTagNames(allImages);
    return tags
      .map((tag) => normalizeTag(tag.name))
      .filter((name) => !used.has(name))
      .sort();
  }, [allImages, tags, loading, tagsReady, legacyReady]);
  return {
    uid,
    images: allImages,
    centralImages: images,
    ready: !loading && tagsReady && legacyReady,
    tags: allTags,
    unusedTagNames,
    loading,
    error,
  };
}
