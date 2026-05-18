import { GameSystemId } from '../types';
import { SavedSkillTreeRecord } from '../types/skillTree';

const STORAGE_KEY = 'savedSkillTreesLocal';

let firestoreHelpers: any = null;

const readLocalRecords = (): SavedSkillTreeRecord[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeLocalRecords = (records: SavedSkillTreeRecord[]) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
};

async function getSkillTreeFirestore() {
  if (firestoreHelpers) return firestoreHelpers;

  const appMod = await import('firebase/app');
  const firestoreMod = await import('firebase/firestore');

  const app = appMod.getApps().length > 0
    ? appMod.getApp()
    : appMod.initializeApp({
        apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
        authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
        projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
        storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
        appId: import.meta.env.VITE_FIREBASE_APP_ID,
      });

  firestoreHelpers = {
    db: firestoreMod.getFirestore(app),
    collection: firestoreMod.collection,
    doc: firestoreMod.doc,
    setDoc: firestoreMod.setDoc,
    deleteDoc: firestoreMod.deleteDoc,
    getDocs: firestoreMod.getDocs,
    query: firestoreMod.query,
    where: firestoreMod.where,
    getApps: appMod.getApps,
    getApp: appMod.getApp,
    initializeApp: appMod.initializeApp,
    getFirestore: firestoreMod.getFirestore,
  };

  return firestoreHelpers;
}

const skillTreeCollectionName = 'skillTrees';

const sortByUpdatedAt = (records: SavedSkillTreeRecord[]) =>
  [...records].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

export const loadSavedSkillTrees = async (system: GameSystemId): Promise<SavedSkillTreeRecord[]> => {
  const localRecords = readLocalRecords().filter((record) => record.system === system);

  try {
    const fs = await getSkillTreeFirestore();
    const queryRef = fs.query(
      fs.collection(fs.db, skillTreeCollectionName),
      fs.where('system', '==', system),
    );
    const snapshot = await fs.getDocs(queryRef);
    const records: SavedSkillTreeRecord[] = [];
    snapshot.forEach((docSnapshot: any) => {
      records.push({
        id: docSnapshot.id,
        ...docSnapshot.data(),
      } as SavedSkillTreeRecord);
    });

    if (records.length > 0) {
      const dedupedLocal = localRecords.filter(
        (localRecord) => !records.some((remoteRecord) => remoteRecord.id === localRecord.id),
      );
      writeLocalRecords(sortByUpdatedAt([...records, ...dedupedLocal]));
      return sortByUpdatedAt(records);
    }
  } catch (error) {
    console.error('Failed to load saved skill trees from Firestore:', error);
  }

  return sortByUpdatedAt(localRecords);
};

export const saveSkillTreeRecord = async (
  draft: Omit<SavedSkillTreeRecord, 'id' | 'createdAt' | 'updatedAt'> & { id?: string | null },
  options?: { asCopy?: boolean },
): Promise<SavedSkillTreeRecord> => {
  const now = new Date().toISOString();
  const localRecords = readLocalRecords();
  const existing = draft.id ? localRecords.find((record) => record.id === draft.id) ?? null : null;

  let nextId = draft.id ?? null;

  try {
    const fs = await getSkillTreeFirestore();
    const docRef = options?.asCopy || !nextId
      ? fs.doc(fs.collection(fs.db, skillTreeCollectionName))
      : fs.doc(fs.db, skillTreeCollectionName, nextId);

    nextId = (docRef as { id: string }).id;
    const record: SavedSkillTreeRecord = {
      id: nextId,
      name: draft.name,
      system: draft.system,
      source: 'rpgskilltreegenerator',
      treeData: draft.treeData,
      createdAt: existing && !options?.asCopy ? existing.createdAt : now,
      updatedAt: now,
      createdBy: existing && !options?.asCopy ? existing.createdBy : draft.createdBy,
      createdByName: existing && !options?.asCopy ? existing.createdByName : draft.createdByName,
      updatedBy: draft.updatedBy,
      updatedByName: draft.updatedByName,
    };

    await fs.setDoc(docRef, {
      name: record.name,
      system: record.system,
      source: record.source,
      treeData: record.treeData,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      createdBy: record.createdBy,
      createdByName: record.createdByName,
      updatedBy: record.updatedBy,
      updatedByName: record.updatedByName,
    });

    const nextLocal = localRecords.filter((recordItem) => recordItem.id !== record.id);
    nextLocal.push(record);
    writeLocalRecords(sortByUpdatedAt(nextLocal));
    return record;
  } catch (error) {
    console.error('Failed to save skill tree to Firestore, using localStorage fallback:', error);
    const fallbackRecord: SavedSkillTreeRecord = {
      id: options?.asCopy || !nextId ? `local-${Date.now()}` : nextId,
      name: draft.name,
      system: draft.system,
      source: 'rpgskilltreegenerator',
      treeData: draft.treeData,
      createdAt: existing && !options?.asCopy ? existing.createdAt : now,
      updatedAt: now,
      createdBy: existing && !options?.asCopy ? existing.createdBy : draft.createdBy,
      createdByName: existing && !options?.asCopy ? existing.createdByName : draft.createdByName,
      updatedBy: draft.updatedBy,
      updatedByName: draft.updatedByName,
    };
    const nextLocal = localRecords.filter((recordItem) => recordItem.id !== fallbackRecord.id);
    nextLocal.push(fallbackRecord);
    writeLocalRecords(sortByUpdatedAt(nextLocal));
    return fallbackRecord;
  }
};

export const deleteSkillTreeRecord = async (recordId: string): Promise<void> => {
  const localRecords = readLocalRecords();
  writeLocalRecords(localRecords.filter((record) => record.id !== recordId));

  if (recordId.startsWith('local-')) {
    return;
  }

  try {
    const fs = await getSkillTreeFirestore();
    await fs.deleteDoc(fs.doc(fs.db, skillTreeCollectionName, recordId));
  } catch (error) {
    console.error('Failed to delete skill tree from Firestore:', error);
  }
};
