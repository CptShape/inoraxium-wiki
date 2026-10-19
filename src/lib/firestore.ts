import {
  CampaignData,
  CampaignMember,
  CharacterData,
  CharacterEntryFolder,
  CharacterGeneralItem,
  CharacterGalleryImage,
  CharacterGalleryTagCategory,
  CharacterInventoryItem,
  CharacterSpell,
  CharacterStatus,
  PartyData,
} from '../types/character';
import { changeHomebrewEntry, copyHomebrewObject, HomebrewEntry, HomebrewEntryField } from './homebrewEntries';
import { GalleryPost, GalleryTag, GALLERY_CATEGORIES, imageTags, normalizeTag, publicCharacterGallery, usedGalleryTagNames, characterImageTagScopes, withCharacterImageTags, galleryImageUrl } from './gallery';

import { EMPTY_GALLERY_REACTION, GalleryReaction, GalleryLikeCount, GalleryReactionAction, galleryReactionKey, nextGalleryReaction } from './galleryReactions';

const LOCAL_REACTIONS_KEY = 'eldritchGalleryReactionsV1';
const readLocalGalleryReactions = (): { reactions: Record<string, GalleryReaction>; counts: Record<string, GalleryLikeCount> } => {
  try { return JSON.parse(localStorage.getItem(LOCAL_REACTIONS_KEY) || '{"reactions":{},"counts":{}}'); }
  catch { return { reactions: {}, counts: {} }; }
};
export const subscribeGalleryReactions = (
  uid: string | null,
  onCounts: (counts: Record<string, GalleryLikeCount>) => void,
  onReactions: (reactions: Record<string, GalleryReaction>) => void,
  onError: (reason: unknown) => void,
): (() => void) => {
  if (uid === 'guest') {
    const refresh = () => { const data = readLocalGalleryReactions(); onCounts(data.counts); onReactions(data.reactions); };
    refresh();
    window.addEventListener('gallery-reactions-updated', refresh);
    window.addEventListener('storage', refresh);
    return () => { window.removeEventListener('gallery-reactions-updated', refresh); window.removeEventListener('storage', refresh); };
  }
  let disposed = false;
  const cleanup: Array<() => void> = [];
  getFirestore().then(fs => {
    if (disposed) return;
    if (!fs) { onError(new Error('Gallery reactions unavailable.')); return; }
    cleanup.push(fs.onSnapshot(fs.collection(fs.db, 'galleryLikeCounts'), (snapshot: any) => {
      if (!disposed) onCounts(Object.fromEntries(snapshot.docs.map((item: any) => [item.id, item.data()])));
    }, onError));
    if (uid) cleanup.push(fs.onSnapshot(fs.collection(fs.db, 'users', uid, 'galleryReactions'), (snapshot: any) => {
      if (!disposed) onReactions(Object.fromEntries(snapshot.docs.map((item: any) => [item.id, item.data()])));
    }, onError));
    else onReactions({});
  }).catch(onError);
  return () => { disposed = true; cleanup.forEach(stop => stop()); };
};
export const updateGalleryReaction = async (uid: string | null, image: CharacterGalleryImage, action: GalleryReactionAction) => {
  if (!uid) throw new Error('Sign in to react to images.');
  const key = await galleryReactionKey(image);
  if (uid === 'guest') {
    const data = readLocalGalleryReactions();
    const current = data.reactions[key] || EMPTY_GALLERY_REACTION;
    const next = nextGalleryReaction(current, action);
    data.reactions[key] = next;
    if (action === 'like') data.counts[key] = { likes: Math.max(0, (data.counts[key]?.likes || 0) + Number(next.liked) - Number(current.liked)) };
    localStorage.setItem(LOCAL_REACTIONS_KEY, JSON.stringify(data));
    window.dispatchEvent(new Event('gallery-reactions-updated'));
    return;
  }
  const fs = await getFirestore();
  if (!fs) throw new Error('Database unavailable. Reaction was not saved.');
  const reactionRef = fs.doc(fs.db, 'users', uid, 'galleryReactions', key);
  const countRef = fs.doc(fs.db, 'galleryLikeCounts', key);
  for (let attempt = 0; ; attempt++) {
    let observed: { likes: number; reaction: GalleryReaction } | undefined;
    try {
      await fs.runTransaction(fs.db, async (transaction: any) => {
        const snapshot = await transaction.get(reactionRef);
        const countSnapshot = action === 'like' ? await transaction.get(countRef) : null;
        const current: GalleryReaction = snapshot.exists() ? snapshot.data() : EMPTY_GALLERY_REACTION;
        const likes = countSnapshot?.exists() ? countSnapshot.data().likes : 0;
        observed = { likes, reaction: current };
        const next = nextGalleryReaction(current, action);
        transaction.set(reactionRef, next);
        if (countSnapshot) transaction.set(countRef, { likes: likes + Number(next.liked) - Number(current.liked) });
      });
      return;
    } catch (reason) {
      if (attempt >= 3 || !observed || (reason as { code?: string }).code !== 'permission-denied') throw reason;
      // Rules can reject stale reaction fields before Firestore reports the transaction conflict.
      // Retry only when fresh reads prove another action changed the observed state.
      let currentReaction: any, currentCount: any;
      try { [currentReaction, currentCount] = await Promise.all([fs.getDoc(reactionRef), action === 'like' ? fs.getDoc(countRef) : Promise.resolve(null)]); }
      catch { throw reason; }
      const fresh: GalleryReaction = currentReaction.exists() ? currentReaction.data() : EMPTY_GALLERY_REACTION;
      if ((currentCount?.exists() ? currentCount.data().likes : 0) === observed.likes
        && fresh.liked === observed.reaction.liked && fresh.favorite === observed.reaction.favorite
        && fresh.rockets === observed.reaction.rockets) throw reason;
    }
  }
};

const LOCAL_GALLERY_KEY = 'eldritchGalleryV1';
const readLocalGallery = (): { images: GalleryPost[]; tags: GalleryTag[] } => {
  try { return JSON.parse(localStorage.getItem(LOCAL_GALLERY_KEY) || '{"images":[],"tags":[]}'); }
  catch { return { images: [], tags: [] }; }
};
const isGalleryGuest = (uid: string | null) => !uid || uid === 'guest';

export const subscribeGlobalGallery = (
  uid: string | null,
  onImages: (images: GalleryPost[]) => void,
  onTags: (tags: GalleryTag[]) => void,
  onError: (error: unknown) => void,
): (() => void) => {
  let disposed = false;
  const cleanup: Array<() => void> = [];
  if (uid === 'guest') {
    const refresh = () => { const data = readLocalGallery(); onImages(data.images); onTags(data.tags); };
    refresh();
    window.addEventListener('gallery-updated', refresh);
    window.addEventListener('storage', refresh);
    return () => { window.removeEventListener('gallery-updated', refresh); window.removeEventListener('storage', refresh); };
  }
  let remoteImages: GalleryPost[] = [], remoteTags: GalleryTag[] = [];
  const refresh = () => {
    const local = !uid ? readLocalGallery() : { images: [], tags: [] };
    onImages([...remoteImages, ...local.images]);
    onTags([...remoteTags, ...local.tags]);
  };
  if (!uid) {
    window.addEventListener('gallery-updated', refresh);
    cleanup.push(() => window.removeEventListener('gallery-updated', refresh));
  }
  getFirestore().then(fs => {
    if (disposed) return;
    if (!fs) { onError(new Error('Gallery database unavailable.')); return; }
    cleanup.push(fs.onSnapshot(fs.collection(fs.db, 'galleryImages'), (snapshot: any) => {
      if (!disposed) { remoteImages = snapshot.docs.map((item: any) => ({ ...item.data(), id: item.id })); refresh(); }
    }, onError));
    cleanup.push(fs.onSnapshot(fs.collection(fs.db, 'galleryTags'), (snapshot: any) => {
      if (!disposed) { remoteTags = snapshot.docs.map((item: any) => item.data()); refresh(); }
    }, onError));
  }).catch(onError);
  return () => { disposed = true; cleanup.forEach(unsubscribe => unsubscribe()); };
};

export const subscribePublicGalleryCharacters = (onChange: (characters: CharacterData[]) => void, onError: (error: unknown) => void): (() => void) => {
  let disposed = false, unsubscribe = () => {};
  getFirestore().then(fs => {
    if (disposed) return;
    if (!fs) { onError(new Error('Public character galleries unavailable.')); return; }
    unsubscribe = fs.onSnapshot(fs.query(fs.collection(fs.db, 'characters'), fs.where('visibility', '==', 'public')), (snapshot: any) => {
      if (!disposed) onChange(snapshot.docs.map((item: any) => ({ ...item.data(), id: item.id })));
    }, onError);
  }).catch(onError);
  return () => { disposed = true; unsubscribe(); };
};

export const saveGlobalGallery = async (uid: string | null, images: GalleryPost[], tags: GalleryTag[]) => {
  if (images.length > 100 || tags.length > 200) throw new Error('Save up to 100 images and 200 tags at a time.');
  const cleanTags = [...new Map(tags.map(tag => {
    const name = normalizeTag(tag.name);
    if (!name || !GALLERY_CATEGORIES.includes(tag.category)) throw new Error('Invalid tag.');
    return [name, { name, category: tag.category }] as const;
  })).values()];
  const cleanImages = images.map(image => {
    if (image.sourceCharacterId || image.userId !== (uid || 'guest')) throw new Error('Only your own global images can be edited here.');
    if (!/^https?:\/\//i.test(image.url)) throw new Error('Use an HTTP or HTTPS image URL.');
    const normalizedTags = imageTags(image);
    if (normalizedTags.length > 100) throw new Error('Each image can have up to 100 tags.');
    return stripUndefinedDeep({ ...image, tags: normalizedTags, updatedAt: Date.now() }) as GalleryPost;
  });
  if (isGalleryGuest(uid)) {
    const data = readLocalGallery();
    const imageMap = new Map(data.images.map(image => [image.id, image]));
    const tagMap = new Map(data.tags.map(tag => [tag.name, tag]));
    cleanImages.forEach(image => imageMap.set(image.id, image));
    cleanTags.forEach(tag => tagMap.set(tag.name, tag));
    const nextImages = [...imageMap.values()];
    const used = usedGalleryTagNames(nextImages);
    localStorage.setItem(LOCAL_GALLERY_KEY, JSON.stringify({ images: nextImages, tags: [...tagMap.values()].filter(tag => used.has(normalizeTag(tag.name))) }));
    window.dispatchEvent(new Event('gallery-updated'));
    return;
  }
  const fs = await getFirestore();
  if (!fs) throw new Error('Database unavailable. Images were not published.');
  const batch = fs.writeBatch(fs.db);
  cleanImages.forEach(image => batch.set(fs.doc(fs.db, 'galleryImages', image.id), image));
  cleanTags.forEach(tag => batch.set(fs.doc(fs.db, 'galleryTags', encodeURIComponent(tag.name)), tag, { merge: true }));
  await batch.commit();
};

export const deleteGlobalGalleryImage = async (uid: string | null, image: GalleryPost) => {
  if (image.sourceCharacterId || image.userId !== (uid || 'guest')) throw new Error('Only the uploader can delete this image.');
  if (isGalleryGuest(uid)) {
    const data = readLocalGallery();
    const images = data.images.filter(item => item.id !== image.id);
    const used = usedGalleryTagNames(images);
    localStorage.setItem(LOCAL_GALLERY_KEY, JSON.stringify({ images, tags: data.tags.filter(tag => used.has(normalizeTag(tag.name))) }));
    window.dispatchEvent(new Event('gallery-updated'));
    return;
  }
  const fs = await getFirestore();
  if (!fs) throw new Error('Database unavailable.');
  await fs.deleteDoc(fs.doc(fs.db, 'galleryImages', image.id));
};

/** Update only tags; admin edits never replace uploader metadata or stale image fields. */
export const saveGalleryImageTags = async (uid: string | null, image: GalleryPost, rawTags: string[], definitions: GalleryTag[]) => {
  const tags = [...new Set(rawTags.map(normalizeTag).filter(Boolean))];
  if (tags.length > 100) throw new Error('Each image can have up to 100 tags.');
  const owner = !image.sourceCharacterId && image.userId === (uid || 'guest');
  if (!owner && (isGalleryGuest(uid) || !(await loadAdminAccess(uid)).isAdmin)) throw new Error('Only the uploader or an administrator can edit these tags.');
  const cleanDefinitions = [...new Map(definitions.filter(tag => tags.includes(normalizeTag(tag.name))).map(tag => {
    if (!GALLERY_CATEGORIES.includes(tag.category)) throw new Error('Invalid tag category.');
    const name = normalizeTag(tag.name);
    return [name, { name, category: tag.category }] as const;
  })).values()];
  if (isGalleryGuest(uid)) {
    const current = readLocalGallery().images.find(item => item.id === image.id);
    if (!current) throw new Error('Image no longer exists.');
    return saveGlobalGallery(uid, [{ ...current, tags }], cleanDefinitions);
  }
  const fs = await getFirestore();
  if (!fs) throw new Error('Database unavailable. Tags were not saved.');
  if (image.sourceCharacterId) {
    if (!image.sourceImageId) throw new Error('Original character image could not be identified.');
    const ref = fs.doc(fs.db, 'characters', image.sourceCharacterId);
    await fs.runTransaction(fs.db, async (transaction: any) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists()) throw new Error('Character no longer exists.');
      const character = snapshot.data() as CharacterData;
      if (!(character.gallery || []).some(item => item.id === image.sourceImageId)) throw new Error('Image no longer exists.');
      const categories = { ...character.galleryTagCategories };
      const gallery = (character.gallery || []).map(item => {
        if (item.id !== image.sourceImageId) return item;
        const nextTags = tags.map(tag => (item.tags || []).find(original => normalizeTag(original) === tag) || tag);
        nextTags.forEach(tag => { const definition = cleanDefinitions.find(item => item.name === normalizeTag(tag)); if (definition) categories[tag.toLowerCase()] = definition.category; });
        const scopes = characterImageTagScopes(item, character.galleryTagCategories);
        return { ...item, tags: [...new Set([...scopes.roles, ...nextTags])], ...(scopes.specific.length ? { characterSpecificTags: scopes.specific } : {}) };
      });
      transaction.update(ref, { gallery, galleryTagCategories: categories, updatedAt: Date.now() });
      cleanDefinitions.forEach(tag => transaction.set(fs.doc(fs.db, 'galleryTags', encodeURIComponent(tag.name)), tag, { merge: true }));
    });
    return;
  }
  const batch = fs.writeBatch(fs.db);
  batch.update(fs.doc(fs.db, 'galleryImages', image.id), { tags, updatedAt: Date.now() });
  cleanDefinitions.forEach(tag => batch.set(fs.doc(fs.db, 'galleryTags', encodeURIComponent(tag.name)), tag, { merge: true }));
  await batch.commit();
};

/** Save character-local scopes and the shared publication together, without replacing other character edits. */
export const saveCharacterGalleryImageTags = async (
  uid: string | null,
  characterId: string,
  image: CharacterGalleryImage,
  shared: string[],
  specific: string[],
  definitions: GalleryTag[],
  categories: Record<string, CharacterGalleryTagCategory>,
  central?: GalleryPost,
  syncShared = true,
): Promise<CharacterGalleryImage> => {
  if (!uid) throw new Error('Sign in to edit image tags.');
  shared = [...new Set(shared.map(normalizeTag).filter(Boolean))];
  specific = [...new Set(specific.map(normalizeTag).filter(Boolean))];
  if (shared.length > 100 || specific.length > 100) throw new Error('Use up to 100 tags per scope.');
  const previous = characterImageTagScopes(image, categories).shared;
  const changed = shared.some(tag => !previous.includes(tag)) || previous.some(tag => !shared.includes(tag));
  const publish = syncShared && (!!central || (shared.length > 0 && changed));
  if (central && central.userId !== uid && syncShared && !(await loadAdminAccess(uid)).isAdmin) throw new Error('Only the uploader or an administrator can edit global tags.');
  if (!/^https?:\/\//i.test(galleryImageUrl(image))) throw new Error('Invalid image URL.');
  const digest = publish && !central ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(galleryImageUrl(image))))).map(value => value.toString(16).padStart(2, '0')).join('') : '';
  const globalId = central?.id || (publish ? `shared-${digest}` : image.globalGalleryImageId);
  const cleanDefinitions: GalleryTag[] = shared.map(name => ({ name, category: definitions.find(tag => normalizeTag(tag.name) === name && tag.category !== 'character-specific')?.category || 'general' }));
  const patch = (saved: CharacterGalleryImage): CharacterGalleryImage => stripUndefinedDeep({
    ...withCharacterImageTags(saved, shared, specific, categories),
    ...(globalId ? { globalGalleryImageId: globalId } : {}),
  }) as CharacterGalleryImage;
  const updateCharacter = (character: CharacterData) => {
    const saved = (character.gallery || []).find(item => item.id === image.id || galleryImageUrl(item) === galleryImageUrl(image));
    // Persist saved roles; the caller retains any unsaved role selections in its own draft.
    const next = patch(saved || { ...image, tags: [] });
    const gallery = saved ? (character.gallery || []).map(item => item.id === saved.id ? next : item) : [...(character.gallery || []), next];
    const galleryTagCategories = { ...character.galleryTagCategories };
    cleanDefinitions.forEach(tag => { galleryTagCategories[tag.name] = tag.category; });
    specific.forEach(tag => { galleryTagCategories[tag] = 'character-specific'; });
    return { gallery, galleryTagCategories, updatedAt: Date.now() };
  };
  const publication = (existing?: GalleryPost): GalleryPost => existing
    ? { ...existing, tags: shared, updatedAt: Date.now() }
    : stripUndefinedDeep({ id: globalId!, url: galleryImageUrl(image), thumbUrl: image.thumbUrl, label: image.label, userId: uid, tags: shared, createdAt: image.createdAt || Date.now(), updatedAt: Date.now() }) as GalleryPost;
  if (isGalleryGuest(uid)) {
    const characters = getLocalCharacters();
    const character = characters.find(item => item.id === characterId);
    if (!character) throw new Error('Save the character before editing image tags.');
    const data = readLocalGallery();
    const existing = data.images.find(item => item.id === globalId);
    if (publish && existing && existing.userId !== uid) throw new Error('Only the uploader can edit global tags.');
    const nextCharacters = characters.map(item => item.id === characterId ? { ...item, ...updateCharacter(character) } : item);
    const posts = publish ? [...data.images.filter(item => item.id !== globalId), publication(existing)] : data.images;
    const tags = new Map(data.tags.map(tag => [tag.name, tag]));
    if (publish) cleanDefinitions.forEach(tag => tags.set(tag.name, tag));
    const used = usedGalleryTagNames(posts);
    const oldCharacters = localStorage.getItem('battleTrackerLocalCharacters');
    const oldGallery = localStorage.getItem(LOCAL_GALLERY_KEY);
    try {
      localStorage.setItem('battleTrackerLocalCharacters', JSON.stringify(nextCharacters));
      localStorage.setItem(LOCAL_GALLERY_KEY, JSON.stringify({ images: posts, tags: [...tags.values()].filter(tag => used.has(tag.name)) }));
    } catch (error) {
      if (oldCharacters !== null) localStorage.setItem('battleTrackerLocalCharacters', oldCharacters);
      if (oldGallery !== null) localStorage.setItem(LOCAL_GALLERY_KEY, oldGallery);
      throw error;
    }
    window.dispatchEvent(new Event('gallery-updated'));
  } else {
    const fs = await getFirestore();
    if (!fs) throw new Error('Database unavailable. Tags were not saved.');
    const ref = fs.doc(fs.db, 'characters', characterId);
    await fs.runTransaction(fs.db, async (transaction: any) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists()) throw new Error('Save the character before editing image tags.');
      const globalRef = publish ? fs.doc(fs.db, 'galleryImages', globalId!) : null;
      const globalSnapshot = globalRef ? await transaction.get(globalRef) : null;
      transaction.update(ref, updateCharacter(snapshot.data() as CharacterData));
      if (globalRef) {
        if (globalSnapshot.exists()) transaction.update(globalRef, { tags: shared, updatedAt: Date.now() });
        else transaction.set(globalRef, publication());
        cleanDefinitions.forEach(tag => transaction.set(fs.doc(fs.db, 'galleryTags', encodeURIComponent(tag.name)), tag, { merge: true }));
      }
    });
  }
  return patch(image);
};

/** Admin cleanup rechecks image usage; ordinary gallery reads never delete data. */
export const pruneUnusedGalleryTags = async (uid: string | null, candidates: string[]) => {
  const names = [...new Set(candidates.map(normalizeTag).filter(Boolean))];
  if (!names.length) return;
  if (isGalleryGuest(uid)) {
    const data = readLocalGallery(), used = usedGalleryTagNames(data.images);
    const tags = data.tags.filter(tag => !names.includes(normalizeTag(tag.name)) || used.has(normalizeTag(tag.name)));
    if (tags.length === data.tags.length) return;
    localStorage.setItem(LOCAL_GALLERY_KEY, JSON.stringify({ ...data, tags }));
    window.dispatchEvent(new Event('gallery-updated'));
    return;
  }
  if (!(await loadAdminAccess(uid)).isAdmin) return;
  const fs = await getFirestore();
  if (!fs) throw new Error('Gallery tag cleanup is unavailable.');
  const publicSnapshot = await fs.getDocs(fs.query(fs.collection(fs.db, 'characters'), fs.where('visibility', '==', 'public')));
  const legacy = publicCharacterGallery(publicSnapshot.docs.map((item: any) => ({ ...item.data(), id: item.id })));
  const legacyUsed = usedGalleryTagNames(legacy.images);
  for (const name of names) {
    if (legacyUsed.has(name)) continue;
    await fs.runTransaction(fs.db, async (transaction: any) => {
      const ref = fs.doc(fs.db, 'galleryTags', encodeURIComponent(name));
      const tag = await transaction.get(ref);
      if (!tag.exists()) return;
      // Image publishers also write this tag document. A concurrent publish
      // conflicts with this read and retries cleanup against the new image usage.
      const usage = await fs.getDocs(fs.query(fs.collection(fs.db, 'galleryImages'), fs.where('tags', 'array-contains', name)));
      if (usage.empty) transaction.delete(ref);
    });
  }
};

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  provider?: string;
}

export interface AdminAccess {
  isAdmin: boolean;
  source: string | null;
}

export interface CharacterSaveResult {
  localSaved: boolean;
  remoteSaved: boolean;
  remoteSkipped: boolean;
  error?: unknown;
}

// ─── Firebase Firestore Abstraction ──────────────────────────────────────────

let firestoreInstance: any = null;

async function getFirestore() {
  if (firestoreInstance) return firestoreInstance;

  try {
    const { initializeApp, getApps, getApp } = await import('firebase/app');
    const { getFirestore: fbGetFirestore, collection, doc, setDoc, updateDoc, getDocs, getDoc, deleteDoc, query, where, arrayUnion, or, onSnapshot, runTransaction, writeBatch } = await import('firebase/firestore');

    const app = getApps().length > 0 ? getApp() : initializeApp({
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
    });

    const db = fbGetFirestore(app);

    firestoreInstance = {
      db,
      collection,
      doc,
      setDoc,
      updateDoc,
      getDocs,
      getDoc,
      deleteDoc,
      query,
      where,
      arrayUnion,
      or,
      onSnapshot,
      runTransaction,
      writeBatch,
    };

    return firestoreInstance;
  } catch (err) {
    console.error('Firestore not initialized:', err);
    return null;
  }
}

// ─── Implementation ────────────────────────────────────────────────────────────

const STORAGE_KEY_LOCAL = 'battleTrackerLocalCharacters';
const USER_DICE_SETTINGS_LOCAL = 'battleTrackerUserDiceSettings';

const getLocalCharacters = (): CharacterData[] => JSON.parse(localStorage.getItem(STORAGE_KEY_LOCAL) || '[]');

const setLocalCharacters = (characters: CharacterData[]) => {
  localStorage.setItem(STORAGE_KEY_LOCAL, JSON.stringify(characters));
};

export const updateCharacterFields = async (
  characterId: string,
  userId: string | null,
  patch: Partial<CharacterData>,
): Promise<CharacterSaveResult> => {
  const localData: CharacterData[] = getLocalCharacters();
  const existIdx = localData.findIndex(c => c.id === characterId);
  const normalizedPatch = stripUndefinedDeep({ ...patch, updatedAt: Date.now() }) as Partial<CharacterData>;
  if (existIdx >= 0) {
    localData[existIdx] = { ...localData[existIdx], ...normalizedPatch, id: characterId };
    setLocalCharacters(localData);
  }

  if (!userId || userId === 'guest') {
    return { localSaved: true, remoteSaved: false, remoteSkipped: true };
  }

  const fs = await getFirestore();
  if (!fs) return { localSaved: true, remoteSaved: false, remoteSkipped: true };

  try {
    await fs.setDoc(fs.doc(fs.db, 'characters', characterId), normalizedPatch, { merge: true });
    return { localSaved: true, remoteSaved: true, remoteSkipped: false };
  } catch (err) {
    console.error('Failed to update character fields in Firestore:', err);
    return { localSaved: true, remoteSaved: false, remoteSkipped: false, error: err };
  }
};

export const saveHomebrewEntry = async (characterId: string, userId: string | null, field: HomebrewEntryField, draft: HomebrewEntry, original?: HomebrewEntry): Promise<CharacterData> => {
  const entry = stripUndefinedDeep(draft) as HomebrewEntry;
  const update = (character: CharacterData) => {
    const next = changeHomebrewEntry(character, userId, field, entry, original);
    return next === character ? character : { ...next, updatedAt: Math.max(Date.now(), (character.updatedAt || 0) + 1) };
  };
  if (!userId || userId === 'guest') {
    const characters = getLocalCharacters();
    const current = characters.find(c => c.id === characterId);
    if (!current) throw new Error('Character not found.');
    const next = update(current);
    setLocalCharacters(characters.map(c => c.id === characterId ? next : c));
    return next;
  }
  const fs = await getFirestore();
  if (!fs) throw new Error('Database is unavailable. Nothing was saved.');
  const ref = fs.doc(fs.db, 'characters', characterId);
  const next = await fs.runTransaction(fs.db, async (transaction: any) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new Error('Character not found.');
    const current = { ...snapshot.data(), id: snapshot.id } as CharacterData;
    const updated = update(current);
    if (updated !== current) transaction.update(ref, { [field]: original ? updated[field] : fs.arrayUnion(entry), updatedAt: updated.updatedAt });
    return updated;
  }) as CharacterData;
  try {
    const local = getLocalCharacters();
    setLocalCharacters([...local.filter(c => c.id !== characterId), next]);
  } catch (error) { console.warn('Saved remotely, but local character cache could not be updated:', error); }
  return next;
};

export const subscribeCharacterById = (
  characterId: string,
  userId: string | null,
  onChange: (character: CharacterData | null) => void,
  onError: (error: unknown) => void,
): (() => void) => {
  let unsubscribe = () => {};
  let disposed = false;

  getFirestore()
    .then((fs) => {
      if (!fs) {
        loadCharacterById(characterId, userId).then(onChange).catch(onError);
        return;
      }
      unsubscribe = fs.onSnapshot(
        fs.doc(fs.db, 'characters', characterId),
        (snapshot: any) => {
          if (disposed) return;
          if (!snapshot.exists()) {
            onChange(null);
            return;
          }
          const data = { id: snapshot.id, ...snapshot.data() } as CharacterData;
          const canRead = data.userId === userId
            || data.visibility === 'public'
            || !data.userId
            || data.userId === 'guest'
            || (!!userId && (data.controlUserIds || []).includes(userId))
            || (!!userId && (data.viewUserIds || []).includes(userId));
          onChange(canRead ? data : null);
        },
        onError,
      );
    })
    .catch(onError);

  return () => {
    disposed = true;
    unsubscribe();
  };
};

const stripUndefinedDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => (item === undefined ? null : stripUndefinedDeep(item)));
  }

  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>((next, [key, entry]) => {
      if (entry !== undefined) {
        next[key] = stripUndefinedDeep(entry);
      }
      return next;
    }, {});
  }

  return value;
};

const normalizeCsvEnv = (value?: string): string[] => (
  (value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
);

const hasAdminPermission = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;

  if (record.admin === true || record.isAdmin === true) return true;

  const role = typeof record.role === 'string' ? record.role.toLowerCase() : null;
  if (role === 'admin') return true;

  const roles = Array.isArray(record.roles) ? record.roles.map((item) => String(item).toLowerCase()) : [];
  if (roles.includes('admin')) return true;

  const permissions = Array.isArray(record.permissions)
    ? record.permissions.map((item) => String(item).toLowerCase())
    : [];
  return permissions.includes('admin');
};

const uid = (prefix = '') => `${prefix}${Math.random().toString(36).slice(2, 10)}`;

const unique = (values: Array<string | null | undefined>): string[] => (
  Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)))
);

export const loadAdminAccess = async (uid: string | null, email?: string | null): Promise<AdminAccess> => {
  if (!uid) return { isAdmin: false, source: null };

  const adminUids = normalizeCsvEnv(import.meta.env.VITE_ADMIN_UIDS as string | undefined);
  if (adminUids.includes(uid.toLowerCase())) {
    return { isAdmin: true, source: 'env:VITE_ADMIN_UIDS' };
  }

  const adminEmails = normalizeCsvEnv(import.meta.env.VITE_ADMIN_EMAILS as string | undefined);
  if (email && adminEmails.includes(email.toLowerCase())) {
    return { isAdmin: true, source: 'env:VITE_ADMIN_EMAILS' };
  }

  const fs = await getFirestore();
  if (!fs) return { isAdmin: false, source: null };

  try {
    const candidates: Array<[string, string]> = [
      ['adminUsers', uid],
      ['userPermissions', uid],
      ['users', uid],
    ];

    for (const [collectionName, docId] of candidates) {
      const snapshot = await fs.getDoc(fs.doc(fs.db, collectionName, docId));
      if (snapshot.exists() && hasAdminPermission(snapshot.data())) {
        return { isAdmin: true, source: `${collectionName}/${docId}` };
      }
    }
  } catch (err) {
    console.error('Failed to load admin access:', err);
  }

  return { isAdmin: false, source: null };
};

/** Load characters visible to `userId`:
 *  - Own characters (all visibilities)
 *  - Characters the user can control or view
 *  - Public characters from other users
 *  - All characters when the caller is an admin
 */
export const loadCharacters = async (userId: string | null, includeAll = false): Promise<CharacterData[]> => {
  const localData: CharacterData[] = getLocalCharacters();

  const fs = await getFirestore();
  if (!fs || !userId) {
    // Guest mode: only own (guest) characters
    return localData.filter(char => char.userId === (userId || 'guest'));
  }

  try {
    if (includeAll) {
      const allSnap = await fs.getDocs(fs.collection(fs.db, 'characters'));
      const allChars: CharacterData[] = [];
      allSnap.forEach((d: any) => allChars.push({ id: d.id, ...d.data() }));
      const mergedMap = new Map<string, CharacterData>();
      allChars.forEach(c => mergedMap.set(c.id, c));
      localData.forEach(l => {
        if (!mergedMap.has(l.id)) mergedMap.set(l.id, l);
      });
      return Array.from(mergedMap.values());
    }

    const readCharacterQuery = async (queryRef: any, label: string): Promise<CharacterData[]> => {
      try {
        const snap = await fs.getDocs(queryRef);
        const result: CharacterData[] = [];
        snap.forEach((d: any) => result.push({ id: d.id, ...d.data() }));
        return result;
      } catch (err) {
        console.error(`Firestore character query failed (${label}):`, err);
        return [];
      }
    };

    // Load own characters (all visibilities)
    const ownQ = fs.query(fs.collection(fs.db, 'characters'), fs.where('userId', '==', userId));
    const controlledQ = fs.query(
      fs.collection(fs.db, 'characters'),
      fs.where('controlUserIds', 'array-contains', userId)
    );
    const viewQ = fs.query(
      fs.collection(fs.db, 'characters'),
      fs.where('viewUserIds', 'array-contains', userId)
    );
    const publicQ = fs.query(
      fs.collection(fs.db, 'characters'),
      fs.where('visibility', '==', 'public')
    );

    const [ownChars, controlledChars, viewChars, publicChars] = await Promise.all([
      readCharacterQuery(ownQ, 'owner'),
      readCharacterQuery(controlledQ, 'control'),
      readCharacterQuery(viewQ, 'view'),
      readCharacterQuery(publicQ, 'public'),
    ]);

    // Merge: own chars take priority over public chars with same id
    const mergedMap = new Map<string, CharacterData>();
    publicChars.filter(c => c.userId !== userId).forEach(c => mergedMap.set(c.id, c));
    viewChars.forEach(c => mergedMap.set(c.id, c));
    controlledChars.forEach(c => mergedMap.set(c.id, c));
    ownChars.forEach(c => mergedMap.set(c.id, c));
    localData.forEach(l => {
      if (l.userId === userId && !mergedMap.has(l.id)) {
        mergedMap.set(l.id, l);
      }
    });

    return Array.from(mergedMap.values());
  } catch (err) {
    console.error('Firestore query failed, using localStorage:', err);
    return localData.filter(c => c.userId === userId);
  }
};

export const saveCharacter = async (character: CharacterData): Promise<CharacterSaveResult> => {
  const localData: CharacterData[] = getLocalCharacters();
  const existIdx = localData.findIndex(c => c.id === character.id);
  const normalized = { ...character, visibility: character.visibility ?? 'private' };
  if (existIdx >= 0) {
    localData[existIdx] = normalized;
  } else {
    localData.push(normalized);
  }
  setLocalCharacters(localData);

  if (!character.userId || character.userId === 'guest') {
    return { localSaved: true, remoteSaved: false, remoteSkipped: true };
  }

  const fs = await getFirestore();
  if (!fs) return { localSaved: true, remoteSaved: false, remoteSkipped: true };

  try {
    await fs.setDoc(fs.doc(fs.db, 'characters', character.id), stripUndefinedDeep(normalized));
    return { localSaved: true, remoteSaved: true, remoteSkipped: false };
  } catch (err) {
    console.error('Failed to save to Firestore:', err);
    return { localSaved: true, remoteSaved: false, remoteSkipped: false, error: err };
  }
};

export const saveCharacterInventory = async (
  characterId: string,
  inventory: CharacterInventoryItem[],
  inventoryFolders: CharacterEntryFolder[],
  collapsedInventoryFolderIds: string[],
  generalItems: CharacterGeneralItem[],
  userId: string | null
): Promise<void> => {
  const localData: CharacterData[] = getLocalCharacters();
  const existIdx = localData.findIndex(c => c.id === characterId);

  if (existIdx >= 0) {
    localData[existIdx] = {
      ...localData[existIdx],
      generalItems,
      inventory,
      inventoryFolders,
      collapsedInventoryFolderIds,
    };
    setLocalCharacters(localData);
  }

  if (!userId || userId === 'guest') return;

  const fs = await getFirestore();
  if (!fs) return;

  try {
    await fs.setDoc(
      fs.doc(fs.db, 'characters', characterId),
      stripUndefinedDeep({ inventory, inventoryFolders, collapsedInventoryFolderIds, generalItems }),
      { merge: true }
    );
  } catch (err) {
    console.error('Failed to save inventory to Firestore:', err);
  }
};

export const deleteCharacterFromDB = async (characterId: string): Promise<void> => {
  const localData: CharacterData[] = getLocalCharacters();
  const nextLocal = localData.filter(c => c.id !== characterId);
  setLocalCharacters(nextLocal);

  const fs = await getFirestore();
  if (!fs) return;

  try {
    await fs.deleteDoc(fs.doc(fs.db, 'characters', characterId));
  } catch (err) {
    console.error('Failed to delete from Firestore:', err);
  }
};

export const reloadCharacterFromFirestore = async (
  characterId: string,
  userId: string | null,
): Promise<CharacterData | null> => {
  const localData = getLocalCharacters().filter((character) => character.id !== characterId);
  setLocalCharacters(localData);

  if (!userId || userId === 'guest') {
    return null;
  }

  const fs = await getFirestore();
  if (!fs) return null;

  try {
    const snapshot = await fs.getDoc(fs.doc(fs.db, 'characters', characterId));
    if (!snapshot.exists()) return null;

    const data = { id: snapshot.id, ...snapshot.data() } as CharacterData;
    const canRead = data.userId === userId
      || data.visibility === 'public'
      || (!!userId && (data.controlUserIds || []).includes(userId))
      || (!!userId && (data.viewUserIds || []).includes(userId));
    if (!canRead) {
      return null;
    }

    setLocalCharacters([...localData, data]);
    return data;
  } catch (err) {
    console.error('Failed to reload character from Firestore:', err);
    return null;
  }
};

export const loadUserProfiles = async (): Promise<UserProfile[]> => {
  const fs = await getFirestore();
  if (!fs) return [];

  try {
    const snapshot = await fs.getDocs(fs.collection(fs.db, 'users'));
    const profiles: UserProfile[] = [];
    snapshot.forEach((d: any) => {
      const data = d.data() || {};
      profiles.push({
        uid: data.uid || d.id,
        email: data.email || '',
        displayName: data.displayName || data.email || d.id,
        photoURL: data.photoURL || '',
        provider: data.provider || '',
      });
    });
    return profiles.sort((a, b) => (
      (a.email || a.displayName || a.uid).localeCompare(b.email || b.displayName || b.uid)
    ));
  } catch (err) {
    console.error('Failed to load user profiles:', err);
    return [];
  }
};

export const transferCharacterOwner = async (
  characterId: string,
  nextOwnerUid: string,
  nextOwnerEmail?: string
): Promise<void> => {
  const localData: CharacterData[] = getLocalCharacters();
  const existIdx = localData.findIndex(c => c.id === characterId);
  if (existIdx >= 0) {
    localData[existIdx] = {
      ...localData[existIdx],
      userId: nextOwnerUid,
      ownerEmail: nextOwnerEmail || undefined,
      controlUserIds: [],
      viewUserIds: [],
    } as CharacterData;
    setLocalCharacters(localData);
  }

  const fs = await getFirestore();
  if (!fs) return;

  try {
    await fs.setDoc(fs.doc(fs.db, 'characters', characterId), {
      userId: nextOwnerUid,
      ownerEmail: nextOwnerEmail || '',
      controlUserIds: [],
      viewUserIds: [],
      ownerTransferredAt: Date.now(),
    }, { merge: true });
  } catch (err) {
    console.error('Failed to transfer character owner:', err);
    throw err;
  }
};

export const loadCharacterById = async (
  characterId: string,
  userId: string | null,
): Promise<CharacterData | null> => {
  const localMatch = getLocalCharacters().find((character) => character.id === characterId) || null;

  const fs = await getFirestore();
  if (fs) {
    try {
      const snapshot = await fs.getDoc(fs.doc(fs.db, 'characters', characterId));
      if (snapshot.exists()) {
        const data = { id: snapshot.id, ...snapshot.data() } as CharacterData;
        const isOwner = !!userId && data.userId === userId;
        const canRead = isOwner
          || data.visibility === 'public'
          || !data.userId
          || data.userId === 'guest'
          || (!!userId && (data.controlUserIds || []).includes(userId))
          || (!!userId && (data.viewUserIds || []).includes(userId));
        if (canRead) {
          return data;
        }
      }
    } catch (err) {
      console.error('Failed to load character by id from Firestore:', err);
    }
  }

  if (!localMatch) return null;
  const isLocalOwner = !userId || localMatch.userId === userId || localMatch.userId === 'guest';
  const isLocalPublic = localMatch.visibility === 'public';
  const canReadLocalAccess = !!userId
    && ((localMatch.controlUserIds || []).includes(userId) || (localMatch.viewUserIds || []).includes(userId));
  return isLocalOwner || isLocalPublic || canReadLocalAccess ? localMatch : null;
};

// ─── Favorites ─────────────────────────────────────────────────────────────────
// Favourites live in a separate collection keyed by `${userId}_${characterId}`.

const FAV_KEY_LOCAL = 'battleTrackerLocalFavorites';

export const loadFavorites = async (userId: string | null): Promise<string[]> => {
  const localFavs: string[] = JSON.parse(localStorage.getItem(FAV_KEY_LOCAL) || '[]');
  
  const mappedLocal = localFavs.map(id => id.includes('_') ? id.split('_')[1] : id);
  if (!userId) return mappedLocal;

  const fs = await getFirestore();
  if (!fs) return mappedLocal;

  try {
    const q = fs.query(fs.collection(fs.db, 'favorites'), fs.where('userId', '==', userId));
    const snap = await fs.getDocs(q);
    const ids: string[] = [];
    snap.forEach((d: any) => {
      const data = d.data();
      if (data && data.characterId) {
        ids.push(data.characterId);
      }
    });
    return ids;
  } catch (err) {
    console.error('Failed to load favorites from Firestore:', err);
    return mappedLocal;
  }
};

export const toggleFavorite = async (userId: string | null, characterId: string, isCurrentlyFav: boolean): Promise<boolean> => {
  // Returns true if now favorited
  const localFavs: string[] = JSON.parse(localStorage.getItem(FAV_KEY_LOCAL) || '[]');
  const docId = userId ? `${userId}_${characterId}` : `guest_${characterId}`;

  if (isCurrentlyFav) {
    const next = localFavs.filter(f => f !== docId);
    localStorage.setItem(FAV_KEY_LOCAL, JSON.stringify(next));
  } else {
    if (!localFavs.includes(docId)) {
      localFavs.push(docId);
    }
    localStorage.setItem(FAV_KEY_LOCAL, JSON.stringify(localFavs));
  }

  if (!userId || userId === 'guest') return !isCurrentlyFav;

  const fs = await getFirestore();
  if (!fs) return !isCurrentlyFav;

  try {
    if (isCurrentlyFav) {
      await fs.deleteDoc(fs.doc(fs.db, 'favorites', docId));
    } else {
      await fs.setDoc(fs.doc(fs.db, 'favorites', docId), { userId, characterId });
    }
  } catch (err) {
    console.error('Failed to toggle favorite in Firestore:', err);
  }

  return !isCurrentlyFav;
};

export interface UserDiceSettings {
  macros: Array<{
    id: string;
    name: string;
    formula: string;
  }>;
  webhookUrl?: string;
  autoSend?: boolean;
}

export const loadUserDiceSettings = async (userId: string | null): Promise<UserDiceSettings> => {
  const localRaw = localStorage.getItem(USER_DICE_SETTINGS_LOCAL);
  const localParsed = localRaw ? JSON.parse(localRaw) : {};
  const localState: UserDiceSettings = {
    macros: localParsed.macros ?? [],
    webhookUrl: localParsed.webhookUrl ?? '',
    autoSend: localParsed.autoSend ?? false,
  };

  if (!userId || userId === 'guest') return localState;

  const fs = await getFirestore();
  if (!fs) return localState;

  try {
    const snap = await fs.getDocs(fs.query(fs.collection(fs.db, 'userDiceSettings'), fs.where('userId', '==', userId)));
    const first = snap.docs?.[0];
    if (!first) return localState;
    const data = first.data();
    return {
      macros: data.macros ?? [],
      webhookUrl: data.webhookUrl ?? '',
      autoSend: data.autoSend ?? false,
    };
  } catch (err) {
    console.error('Failed to load user dice settings from Firestore:', err);
    return localState;
  }
};

export const saveUserDiceSettings = async (userId: string | null, settings: UserDiceSettings): Promise<void> => {
  localStorage.setItem(USER_DICE_SETTINGS_LOCAL, JSON.stringify(settings));

  if (!userId || userId === 'guest') return;

  const fs = await getFirestore();
  if (!fs) return;

  try {
    await fs.setDoc(fs.doc(fs.db, 'userDiceSettings', userId), {
      userId,
      macros: settings.macros,
      webhookUrl: settings.webhookUrl ?? '',
      autoSend: settings.autoSend ?? false,
    });
  } catch (err) {
    console.error('Failed to save user dice settings to Firestore:', err);
  }
};

export const createCampaign = async (
  uidValue: string,
  profile: { email?: string | null; displayName?: string | null },
  name: string,
): Promise<CampaignData> => {
  const fs = await getFirestore();
  if (!fs) throw new Error('Firestore is not available.');

  const id = uid('camp_');
  const now = Date.now();
  const member: CampaignMember = {
    uid: uidValue,
    email: profile.email || '',
    displayName: profile.displayName || profile.email || uidValue,
    role: 'dm',
    joinedAt: now,
  };
  const campaign: CampaignData = {
    id,
    name: name.trim() || 'Untitled Campaign',
    createdBy: uidValue,
    inviteCode: uid('invite_'),
    dmUserIds: [uidValue],
    playerUserIds: [],
    members: [member],
    createdAt: now,
    updatedAt: now,
  };

  await fs.setDoc(fs.doc(fs.db, 'campaigns', id), stripUndefinedDeep(campaign));
  await fs.setDoc(fs.doc(fs.db, 'campaignInvites', campaign.inviteCode), stripUndefinedDeep({
    id: campaign.inviteCode,
    campaignId: campaign.id,
    inviteCode: campaign.inviteCode,
    createdBy: uidValue,
    active: true,
    createdAt: now,
  }));
  return campaign;
};

export const ensureCampaignInvite = async (campaign: CampaignData): Promise<void> => {
  const fs = await getFirestore();
  if (!fs) throw new Error('Firestore is not available.');

  await fs.setDoc(fs.doc(fs.db, 'campaignInvites', campaign.inviteCode), stripUndefinedDeep({
    id: campaign.inviteCode,
    campaignId: campaign.id,
    inviteCode: campaign.inviteCode,
    createdBy: campaign.createdBy,
    active: true,
    createdAt: campaign.createdAt || Date.now(),
    updatedAt: Date.now(),
  }), { merge: true });
};

const normalizeCampaign = (id: string, data: any): CampaignData => {
  const rawDmUserIds = Array.isArray(data.dmUserIds) ? data.dmUserIds.filter(Boolean) : [];
  const playerUserIds = Array.isArray(data.playerUserIds) ? data.playerUserIds.filter(Boolean) : [];
  const existingMembers = Array.isArray(data.members) ? data.members.filter((member: any) => member && member.uid) : [];
  const dmUserIds = unique(rawDmUserIds.length > 0 ? rawDmUserIds : [data.createdBy]);
  const memberMap = new Map<string, CampaignMember>();
  existingMembers.forEach((member: any) => {
    const isDm = dmUserIds.includes(member.uid);
    memberMap.set(member.uid, {
      uid: member.uid,
      email: member.email || '',
      displayName: member.displayName || member.email || member.uid,
      role: isDm ? 'dm' : 'player',
      joinedAt: typeof member.joinedAt === 'number' ? member.joinedAt : 0,
    });
  });
  dmUserIds.forEach((uidValue) => {
    if (!memberMap.has(uidValue)) {
      memberMap.set(uidValue, { uid: uidValue, role: 'dm', joinedAt: typeof data.createdAt === 'number' ? data.createdAt : 0 });
    }
  });
  playerUserIds.forEach((uidValue) => {
    if (!memberMap.has(uidValue)) {
      memberMap.set(uidValue, { uid: uidValue, role: 'player', joinedAt: typeof data.updatedAt === 'number' ? data.updatedAt : 0 });
    }
  });
  const members = Array.from(memberMap.values());

  return {
    id,
    name: data.name || 'Untitled Campaign',
    createdBy: data.createdBy || '',
    inviteCode: data.inviteCode || '',
    joinInviteCode: data.joinInviteCode,
    dmUserIds,
    playerUserIds,
    members,
    createdAt: typeof data.createdAt === 'number' ? data.createdAt : 0,
    updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : 0,
  };
};

const normalizeParty = (id: string, data: any): PartyData => ({
  id,
  campaignId: data.campaignId || '',
  name: data.name || 'Untitled Party',
  createdBy: data.createdBy || '',
  visibility: data.visibility === 'public' ? 'public' : 'private',
  characterIds: Array.isArray(data.characterIds) ? data.characterIds.filter(Boolean) : [],
  generalItems: Array.isArray(data.generalItems) ? data.generalItems : [],
  inventory: Array.isArray(data.inventory) ? data.inventory : [],
  inventoryFolders: Array.isArray(data.inventoryFolders) ? data.inventoryFolders : [],
  spells: Array.isArray(data.spells) ? data.spells : [],
  spellFolders: Array.isArray(data.spellFolders) ? data.spellFolders : [],
  statuses: Array.isArray(data.statuses) ? data.statuses : [],
  statusFolders: Array.isArray(data.statusFolders) ? data.statusFolders : [],
  createdAt: typeof data.createdAt === 'number' ? data.createdAt : 0,
  updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : 0,
});

export const loadCampaignsForUser = async (uidValue: string | null, includeAll = false): Promise<CampaignData[]> => {
  if (!uidValue) return [];
  const fs = await getFirestore();
  if (!fs) return [];

  const readCampaignQuery = async (queryRef: any): Promise<CampaignData[]> => {
    try {
      const snap = await fs.getDocs(queryRef);
      const result: CampaignData[] = [];
      snap.forEach((d: any) => result.push(normalizeCampaign(d.id, d.data())));
      return result;
    } catch (err) {
      console.error('Campaign query failed:', err);
      return [];
    }
  };

  const allCampaigns = await readCampaignQuery(fs.collection(fs.db, 'campaigns'));
  let visibleCampaigns = includeAll
    ? allCampaigns
    : allCampaigns.filter((campaign) => {
      const hasMembershipData = campaign.dmUserIds.length > 0 || campaign.playerUserIds.length > 0 || campaign.members.length > 0;
      return (
        campaign.dmUserIds.includes(uidValue)
        || campaign.playerUserIds.includes(uidValue)
        || campaign.members.some((member) => member.uid === uidValue)
        || (!hasMembershipData && campaign.createdBy === uidValue)
      );
    });

  if (!includeAll && visibleCampaigns.length === 0) {
    const [dmCampaigns, playerCampaigns] = await Promise.all([
      readCampaignQuery(fs.query(fs.collection(fs.db, 'campaigns'), fs.where('dmUserIds', 'array-contains', uidValue))),
      readCampaignQuery(fs.query(fs.collection(fs.db, 'campaigns'), fs.where('playerUserIds', 'array-contains', uidValue))),
    ]);
    const fallbackMap = new Map<string, CampaignData>();
    [...dmCampaigns, ...playerCampaigns].forEach((campaign) => fallbackMap.set(campaign.id, campaign));
    visibleCampaigns = Array.from(fallbackMap.values());
  }

  return visibleCampaigns.sort((a, b) => b.updatedAt - a.updatedAt);
};

export const loadCampaignById = async (campaignId: string): Promise<CampaignData | null> => {
  const fs = await getFirestore();
  if (!fs) return null;

  try {
    const snapshot = await fs.getDoc(fs.doc(fs.db, 'campaigns', campaignId));
    return snapshot.exists() ? normalizeCampaign(snapshot.id, snapshot.data()) : null;
  } catch (err) {
    console.error('Failed to load campaign:', err);
    return null;
  }
};

export const joinCampaignByInvite = async (
  campaignId: string,
  inviteCode: string,
  uidValue: string,
  profile: { email?: string | null; displayName?: string | null },
): Promise<CampaignData> => {
  const fs = await getFirestore();
  if (!fs) throw new Error('Firestore is not available.');

  const inviteSnapshot = await fs.getDoc(fs.doc(fs.db, 'campaignInvites', inviteCode));
  if (!inviteSnapshot.exists()) {
    throw new Error('Campaign invite is invalid or expired.');
  }

  const invite = inviteSnapshot.data() || {};
  if (invite.active === false || invite.campaignId !== campaignId || invite.inviteCode !== inviteCode) {
    throw new Error('Campaign invite is invalid or expired.');
  }

  const member: CampaignMember = {
    uid: uidValue,
    email: profile.email || '',
    displayName: profile.displayName || profile.email || uidValue,
    role: 'player',
    joinedAt: Date.now(),
  };

  const campaignSnapshot = await fs.getDoc(fs.doc(fs.db, 'campaigns', campaignId));
  if (!campaignSnapshot.exists()) {
    throw new Error('Campaign invite points to a campaign that no longer exists.');
  }

  const campaign = normalizeCampaign(campaignSnapshot.id, campaignSnapshot.data());
  const nextMembers = [
    ...campaign.members.filter((existingMember) => existingMember.uid !== uidValue),
    member,
  ];
  const nextCampaign: CampaignData = {
    ...campaign,
    playerUserIds: unique([...campaign.playerUserIds, uidValue]),
    members: nextMembers,
    joinInviteCode: inviteCode,
    updatedAt: Date.now(),
  };

  try {
    await fs.setDoc(fs.doc(fs.db, 'campaigns', campaignId), stripUndefinedDeep(nextCampaign), { merge: true });
  } catch (err) {
    console.error('Failed to join campaign by invite:', err);
    throw new Error('Campaign invite was found, but joining was blocked by Firestore rules. Deploy the latest firestore.rules and try again.');
  }

  const updated = await loadCampaignById(campaignId);
  if (!updated) throw new Error('Joined campaign, but it could not be loaded yet. Refresh and try again.');
  return updated;
};

export const saveCampaign = async (campaign: CampaignData): Promise<void> => {
  const fs = await getFirestore();
  if (!fs) throw new Error('Firestore is not available.');
  await fs.setDoc(fs.doc(fs.db, 'campaigns', campaign.id), stripUndefinedDeep({ ...campaign, updatedAt: Date.now() }), { merge: true });
};

export const createParty = async (campaignId: string, uidValue: string, name: string): Promise<PartyData> => {
  const fs = await getFirestore();
  if (!fs) throw new Error('Firestore is not available.');

  const id = uid('party_');
  const now = Date.now();
  const party: PartyData = {
    id,
    campaignId,
    name: name.trim() || 'Untitled Party',
    createdBy: uidValue,
    visibility: 'private',
    characterIds: [],
    generalItems: [],
    inventory: [],
    inventoryFolders: [],
    spells: [],
    spellFolders: [],
    statuses: [],
    statusFolders: [],
    createdAt: now,
    updatedAt: now,
  };

  await fs.setDoc(fs.doc(fs.db, 'parties', id), stripUndefinedDeep(party));
  return party;
};

export const loadPartiesForCampaign = async (
  campaignId: string,
  uidValue: string | null,
  isDm = false,
): Promise<PartyData[]> => {
  if (!uidValue) return [];
  const fs = await getFirestore();
  if (!fs) return [];

  try {
    const snap = await fs.getDocs(fs.query(fs.collection(fs.db, 'parties'), fs.where('campaignId', '==', campaignId)));
    const result: PartyData[] = [];
    snap.forEach((d: any) => {
      const party = normalizeParty(d.id, d.data());
      if (isDm || party.visibility === 'public' || party.createdBy === uidValue) {
        result.push(party);
      }
    });
    return result.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch (err) {
    console.error('Failed to load campaign parties:', err);
    return [];
  }
};

export const loadPartiesForCharacterTransfer = async (
  uidValue: string | null,
  characterId: string,
  includeAll = false,
): Promise<Array<{ campaign: CampaignData; party: PartyData }>> => {
  if (!uidValue) return [];
  const campaigns = await loadCampaignsForUser(uidValue, includeAll);
  const result: Array<{ campaign: CampaignData; party: PartyData }> = [];

  for (const campaign of campaigns) {
    const isDm = includeAll || campaign.dmUserIds.includes(uidValue);
    const parties = await loadPartiesForCampaign(campaign.id, uidValue, isDm);
    parties.forEach((party) => {
      if (party.characterIds.includes(characterId)) {
        result.push({ campaign, party });
      }
    });
  }

  return result.sort((a, b) => a.campaign.name.localeCompare(b.campaign.name) || a.party.name.localeCompare(b.party.name));
};

export const saveParty = async (party: PartyData): Promise<void> => {
  const fs = await getFirestore();
  if (!fs) throw new Error('Firestore is not available.');
  await fs.setDoc(fs.doc(fs.db, 'parties', party.id), stripUndefinedDeep({ ...party, updatedAt: Date.now() }), { merge: true });
};

export const addCharacterToParty = async (party: PartyData, characterId: string): Promise<PartyData> => {
  const fs = await getFirestore();
  if (!fs) throw new Error('Firestore is not available.');

  const campaign = await loadCampaignById(party.campaignId);
  const nextParty: PartyData = {
    ...party,
    characterIds: unique([...party.characterIds, characterId]),
    updatedAt: Date.now(),
  };

  await fs.setDoc(fs.doc(fs.db, 'parties', party.id), stripUndefinedDeep(nextParty), { merge: true });

  if (campaign?.dmUserIds?.length) {
    const charSnapshot = await fs.getDoc(fs.doc(fs.db, 'characters', characterId));
    if (charSnapshot.exists()) {
      const character = { id: charSnapshot.id, ...charSnapshot.data() } as CharacterData;
      const nextViewUserIds = unique([...(character.viewUserIds || []), ...campaign.dmUserIds].filter((id) => id !== character.userId));
      await fs.setDoc(fs.doc(fs.db, 'characters', characterId), { viewUserIds: nextViewUserIds }, { merge: true });
    }
  }

  return nextParty;
};

export const addEntryToPartyInventory = async (
  party: PartyData,
  kind: 'item' | 'spell' | 'status',
  entry: CharacterGeneralItem | CharacterInventoryItem | CharacterSpell | CharacterStatus,
  sourceCharacterId?: string,
): Promise<PartyData> => {
  const fs = await getFirestore();
  if (!fs) throw new Error('Database is unavailable. Nothing was sent.');
  const copy = stripUndefinedDeep(copyHomebrewObject(entry));
  const field = kind === 'item' ? 'generalItems' : kind === 'spell' ? 'spells' : 'statuses';
  const ref = fs.doc(fs.db, 'parties', party.id);
  return fs.runTransaction(fs.db, async (transaction: any) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new Error('This party no longer exists.');
    const current = { ...snapshot.data(), id: snapshot.id } as PartyData;
    if (sourceCharacterId && !current.characterIds.includes(sourceCharacterId)) throw new Error('This character is no longer in that party.');
    const updatedAt = Math.max(Date.now(), (current.updatedAt || 0) + 1);
    transaction.update(ref, { [field]: fs.arrayUnion(copy), updatedAt });
    return { ...current, [field]: [...current[field] || [], copy], updatedAt };
  });
};
