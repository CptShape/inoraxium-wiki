import { useEffect, useRef, useState } from "react";
import { CharacterGalleryImage } from "../types/character";
import { galleryImageUrl } from "./gallery";
import { subscribeGalleryReactions, updateGalleryReaction } from "./firestore";
import {
  EMPTY_GALLERY_REACTION,
  GalleryLikeCount,
  GalleryReaction,
  GalleryReactionAction,
  galleryReactionKey,
} from "./galleryReactions";

export function useGalleryReactions(
  uid: string | null,
  images: CharacterGalleryImage[],
) {
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [state, setState] = useState<{
    uid: string | null;
    counts: Record<string, GalleryLikeCount>;
    reactions: Record<string, GalleryReaction>;
    countsReady: boolean;
    reactionsReady: boolean;
    error: string;
  }>({
    uid,
    counts: {},
    reactions: {},
    countsReady: false,
    reactionsReady: false,
    error: "",
  });
  const currentUid = useRef(uid);
  currentUid.current = uid;
  const queue = useRef<Promise<void>>(Promise.resolve());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const signature = JSON.stringify(images.map(galleryImageUrl).sort());
  useEffect(() => {
    let active = true;
    Promise.all(
      (JSON.parse(signature) as string[]).map(
        async (url) =>
          [url, await galleryReactionKey({ id: "", url })] as const,
      ),
    )
      .then((entries) => {
        if (active) setKeys(Object.fromEntries(entries));
      })
      .catch(() => {
        if (active)
          setState((current) => ({
            ...current,
            error: "Image reactions could not be prepared.",
          }));
      });
    return () => {
      active = false;
    };
  }, [signature]);
  useEffect(() => {
    setState({
      uid,
      counts: {},
      reactions: {},
      countsReady: false,
      reactionsReady: false,
      error: "",
    });
    return subscribeGalleryReactions(
      uid,
      (counts) =>
        setState((current) => ({ ...current, uid, counts, countsReady: true })),
      (reactions) =>
        setState((current) => ({
          ...current,
          uid,
          reactions,
          reactionsReady: true,
        })),
      (reason) =>
        setState((current) => ({
          ...current,
          error:
            reason instanceof Error ? reason.message : "Reactions unavailable.",
        })),
    );
  }, [uid]);
  const ready = state.uid === uid && state.countsReady && state.reactionsReady;
  const reaction = (image: CharacterGalleryImage) =>
    ready
      ? state.reactions[keys[galleryImageUrl(image)]] || EMPTY_GALLERY_REACTION
      : EMPTY_GALLERY_REACTION;
  const likes = (image: CharacterGalleryImage) =>
    ready ? state.counts[keys[galleryImageUrl(image)]]?.likes || 0 : 0;
  const react = (
    image: CharacterGalleryImage,
    action: GalleryReactionAction,
  ) => {
    // Queue every click, including rapid rocket presses, and continue after a failed request.
    queue.current = queue.current
      .catch(() => {})
      .then(async () => {
        if (currentUid.current !== uid) return;
        await updateGalleryReaction(uid, image, action);
        if (mounted.current && currentUid.current === uid)
          setState((current) => ({ ...current, error: "" }));
      });
    return queue.current.catch((reason) => {
      if (mounted.current && currentUid.current === uid)
        setState((current) => ({
          ...current,
          error:
            reason instanceof Error
              ? reason.message
              : "Reaction could not be saved.",
        }));
    });
  };
  return {
    reaction,
    likes,
    react,
    error: state.uid === uid ? state.error : "",
    ready: (image: CharacterGalleryImage) =>
      !!uid && ready && !!keys[galleryImageUrl(image)],
  };
}
