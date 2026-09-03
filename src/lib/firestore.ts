import {
  CampaignData,
  CampaignMember,
  CharacterData,
  CharacterEntryFolder,
  CharacterGeneralItem,
  CharacterInventoryItem,
  CharacterSpell,
  CharacterStatus,
  PartyData,
} from '../types/character';

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
    const { getFirestore: fbGetFirestore, collection, doc, setDoc, getDocs, getDoc, deleteDoc, query, where, or } = await import('firebase/firestore');

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
      getDoc,
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

const getLocalCharacters = (): CharacterData[] => JSON.parse(localStorage.getItem(STORAGE_KEY_LOCAL) || '[]');

const setLocalCharacters = (characters: CharacterData[]) => {
  localStorage.setItem(STORAGE_KEY_LOCAL, JSON.stringify(characters));
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

const cloneWithId = <T extends { id: string }>(entry: T, prefix: string): T => ({
  ...(JSON.parse(JSON.stringify(entry)) as T),
  id: uid(prefix),
});

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
  return campaign;
};

export const loadCampaignsForUser = async (uidValue: string | null, includeAll = false): Promise<CampaignData[]> => {
  if (!uidValue) return [];
  const fs = await getFirestore();
  if (!fs) return [];

  const readCampaignQuery = async (queryRef: any): Promise<CampaignData[]> => {
    try {
      const snap = await fs.getDocs(queryRef);
      const result: CampaignData[] = [];
      snap.forEach((d: any) => result.push({ id: d.id, ...d.data() }));
      return result;
    } catch (err) {
      console.error('Campaign query failed:', err);
      return [];
    }
  };

  if (includeAll) {
    return readCampaignQuery(fs.collection(fs.db, 'campaigns'));
  }

  const [dmCampaigns, playerCampaigns] = await Promise.all([
    readCampaignQuery(fs.query(fs.collection(fs.db, 'campaigns'), fs.where('dmUserIds', 'array-contains', uidValue))),
    readCampaignQuery(fs.query(fs.collection(fs.db, 'campaigns'), fs.where('playerUserIds', 'array-contains', uidValue))),
  ]);
  const map = new Map<string, CampaignData>();
  [...dmCampaigns, ...playerCampaigns].forEach((campaign) => map.set(campaign.id, campaign));
  return Array.from(map.values()).sort((a, b) => b.updatedAt - a.updatedAt);
};

export const loadCampaignById = async (campaignId: string): Promise<CampaignData | null> => {
  const fs = await getFirestore();
  if (!fs) return null;

  try {
    const snapshot = await fs.getDoc(fs.doc(fs.db, 'campaigns', campaignId));
    return snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as CampaignData) : null;
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
  const campaign = await loadCampaignById(campaignId);
  if (!campaign || campaign.inviteCode !== inviteCode) {
    throw new Error('Campaign invite is invalid or expired.');
  }

  const fs = await getFirestore();
  if (!fs) throw new Error('Firestore is not available.');

  const existingMember = campaign.members.find((member) => member.uid === uidValue);
  const members = existingMember
    ? campaign.members
    : [
        ...campaign.members,
        {
          uid: uidValue,
          email: profile.email || '',
          displayName: profile.displayName || profile.email || uidValue,
          role: 'player' as const,
          joinedAt: Date.now(),
        },
      ];
  const updated: CampaignData = {
    ...campaign,
    playerUserIds: unique([...campaign.playerUserIds, uidValue].filter((id) => !campaign.dmUserIds.includes(id))),
    members,
    updatedAt: Date.now(),
  };

  await fs.setDoc(fs.doc(fs.db, 'campaigns', campaign.id), stripUndefinedDeep(updated), { merge: true });
  return updated;
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
      const party = { id: d.id, ...d.data() } as PartyData;
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
): Promise<PartyData> => {
  const nextParty: PartyData = { ...party, updatedAt: Date.now() };

  if (kind === 'item') {
    nextParty.generalItems = [...(party.generalItems || []), cloneWithId(entry as CharacterGeneralItem | CharacterInventoryItem, 'party_item_') as CharacterGeneralItem];
  } else if (kind === 'spell') {
    nextParty.spells = [...(party.spells || []), cloneWithId(entry as CharacterSpell, 'party_spell_')];
  } else {
    nextParty.statuses = [...(party.statuses || []), cloneWithId(entry as CharacterStatus, 'party_status_')];
  }

  await saveParty(nextParty);
  return nextParty;
};
