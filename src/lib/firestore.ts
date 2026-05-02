import { CharacterData } from '../types/character';

// ─── Firebase Firestore Abstraction ──────────────────────────────────────────

let firestoreInstance: any = null;

async function getFirestore() {
  if (firestoreInstance) return firestoreInstance;

  try {
    const { initializeApp, getApps, getApp } = await import('firebase/app');
    const { getFirestore: fbGetFirestore, collection, doc, setDoc, getDocs, deleteDoc, query, where, or } = await import('firebase/firestore');

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
      getDocs,
      deleteDoc,
      query,
      where,
      or,
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

/** Load characters visible to `userId`:
 *  - Own characters (all visibilities)
 *  - Public characters from other users
 */
export const loadCharacters = async (userId: string | null): Promise<CharacterData[]> => {
  const localData: CharacterData[] = JSON.parse(localStorage.getItem(STORAGE_KEY_LOCAL) || '[]');

  const fs = await getFirestore();
  if (!fs || !userId) {
    // Guest mode: only own (guest) characters
    return localData.filter(char => char.userId === (userId || 'guest'));
  }

  try {
    // Load own characters (all visibilities)
    const ownQ = fs.query(fs.collection(fs.db, 'characters'), fs.where('userId', '==', userId));
    const ownSnap = await fs.getDocs(ownQ);
    const ownChars: CharacterData[] = [];
    ownSnap.forEach((d: any) => ownChars.push({ id: d.id, ...d.data() }));

    // Load public characters from all other users
    const publicQ = fs.query(
      fs.collection(fs.db, 'characters'),
      fs.where('visibility', '==', 'public')
    );
    const publicSnap = await fs.getDocs(publicQ);
    const publicChars: CharacterData[] = [];
    publicSnap.forEach((d: any) => {
      const data = { id: d.id, ...d.data() } as CharacterData;
      if (data.userId !== userId) {
        publicChars.push(data);
      }
    });

    // Merge: own chars take priority over public chars with same id
    const mergedMap = new Map<string, CharacterData>();
    publicChars.forEach(c => mergedMap.set(c.id, c));
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

export const saveCharacter = async (character: CharacterData): Promise<void> => {
  const localData: CharacterData[] = JSON.parse(localStorage.getItem(STORAGE_KEY_LOCAL) || '[]');
  const existIdx = localData.findIndex(c => c.id === character.id);
  const normalized = { ...character, visibility: character.visibility ?? 'private' };
  if (existIdx >= 0) {
    localData[existIdx] = normalized;
  } else {
    localData.push(normalized);
  }
  localStorage.setItem(STORAGE_KEY_LOCAL, JSON.stringify(localData));

  if (!character.userId || character.userId === 'guest') return;

  const fs = await getFirestore();
  if (!fs) return;

  try {
    await fs.setDoc(fs.doc(fs.db, 'characters', character.id), normalized);
  } catch (err) {
    console.error('Failed to save to Firestore:', err);
  }
};

export const deleteCharacterFromDB = async (characterId: string): Promise<void> => {
  const localData: CharacterData[] = JSON.parse(localStorage.getItem(STORAGE_KEY_LOCAL) || '[]');
  const nextLocal = localData.filter(c => c.id !== characterId);
  localStorage.setItem(STORAGE_KEY_LOCAL, JSON.stringify(nextLocal));

  const fs = await getFirestore();
  if (!fs) return;

  try {
    await fs.deleteDoc(fs.doc(fs.db, 'characters', characterId));
  } catch (err) {
    console.error('Failed to delete from Firestore:', err);
  }
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
