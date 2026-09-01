import { CharacterData } from '../types/character';

export interface SessionRecord {
  id: string;
  code: string;
  name: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  characterIds: string[];
}

let firestoreInstance: any = null;

async function getFirestore() {
  if (firestoreInstance) return firestoreInstance;

  try {
    const { initializeApp, getApps, getApp } = await import('firebase/app');
    const {
      getFirestore: fbGetFirestore,
      doc,
      getDoc,
      setDoc,
      onSnapshot,
    } = await import('firebase/firestore');

    const app = getApps().length > 0 ? getApp() : initializeApp({
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
    });

    firestoreInstance = {
      db: fbGetFirestore(app),
      doc,
      getDoc,
      setDoc,
      onSnapshot,
    };

    return firestoreInstance;
  } catch (error) {
    console.error('Firestore not initialized for sessions:', error);
    return null;
  }
}

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

const createSessionCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let index = 0; index < 6; index += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
};

export const createSession = async (userId: string, name = 'New Session'): Promise<SessionRecord> => {
  const fs = await getFirestore();
  if (!fs) throw new Error('Firestore is not available.');

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = createSessionCode();
    const ref = fs.doc(fs.db, 'sessions', code);
    const existing = await fs.getDoc(ref);
    if (existing.exists()) continue;

    const now = Date.now();
    const session: SessionRecord = {
      id: code,
      code,
      name,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
      characterIds: [],
    };
    await fs.setDoc(ref, stripUndefinedDeep(session));
    return session;
  }

  throw new Error('Could not create a unique session code. Please try again.');
};

export const loadSessionByCode = async (code: string): Promise<SessionRecord | null> => {
  const fs = await getFirestore();
  if (!fs) throw new Error('Firestore is not available.');

  const normalizedCode = code.trim().toUpperCase();
  if (!normalizedCode) return null;

  const snapshot = await fs.getDoc(fs.doc(fs.db, 'sessions', normalizedCode));
  if (!snapshot.exists()) return null;
  return { id: snapshot.id, ...snapshot.data() } as SessionRecord;
};

export const addCharacterToSession = async (sessionCode: string, characterId: string): Promise<void> => {
  const fs = await getFirestore();
  if (!fs) throw new Error('Firestore is not available.');

  const code = sessionCode.trim().toUpperCase();
  const ref = fs.doc(fs.db, 'sessions', code);
  const snapshot = await fs.getDoc(ref);
  if (!snapshot.exists()) throw new Error('Session was not found.');

  const session = { id: snapshot.id, ...snapshot.data() } as SessionRecord;
  const characterIds = Array.from(new Set([...(session.characterIds || []), characterId]));
  await fs.setDoc(ref, { characterIds, updatedAt: Date.now() }, { merge: true });
};

export const subscribeSession = (
  sessionCode: string,
  onChange: (session: SessionRecord | null) => void,
  onError: (error: unknown) => void,
): (() => void) => {
  let unsubscribe = () => {};

  getFirestore()
    .then((fs) => {
      if (!fs) throw new Error('Firestore is not available.');
      const ref = fs.doc(fs.db, 'sessions', sessionCode.trim().toUpperCase());
      unsubscribe = fs.onSnapshot(
        ref,
        (snapshot: any) => {
          onChange(snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as SessionRecord) : null);
        },
        onError,
      );
    })
    .catch(onError);

  return () => unsubscribe();
};

export const subscribeSessionCharacters = (
  characterIds: string[],
  onChange: (characters: CharacterData[]) => void,
  onError: (error: unknown) => void,
): (() => void) => {
  let unsubscribers: Array<() => void> = [];
  let disposed = false;

  getFirestore()
    .then((fs) => {
      if (!fs) throw new Error('Firestore is not available.');
      const nextCharacters = new Map<string, CharacterData>();

      unsubscribers = characterIds.map((characterId) => fs.onSnapshot(
        fs.doc(fs.db, 'characters', characterId),
        (snapshot: any) => {
          if (snapshot.exists()) {
            nextCharacters.set(snapshot.id, { id: snapshot.id, ...snapshot.data() } as CharacterData);
          } else {
            nextCharacters.delete(snapshot.id);
          }
          if (!disposed) {
            onChange(characterIds.map((id) => nextCharacters.get(id)).filter((character): character is CharacterData => Boolean(character)));
          }
        },
        onError,
      ));
    })
    .catch(onError);

  return () => {
    disposed = true;
    unsubscribers.forEach((unsubscribe) => unsubscribe());
  };
};
