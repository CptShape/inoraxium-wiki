export interface EditorAccess {
  canEdit: boolean;
  source: string | null;
}

let firestoreApp: any = null;

async function getFirestoreHelpers() {
  if (firestoreApp) return firestoreApp;

  const { initializeApp, getApps, getApp } = await import('firebase/app');
  const { getFirestore, doc, getDoc } = await import('firebase/firestore');

  const app = getApps().length > 0 ? getApp() : initializeApp({
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  });

  firestoreApp = {
    db: getFirestore(app),
    doc,
    getDoc,
  };

  return firestoreApp;
}

const hasEditPermission = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;

  if (record.canEdit === true || record.edit === true) return true;

  const role = typeof record.role === 'string' ? record.role.toLowerCase() : null;
  if (role && ['admin', 'editor', 'edit'].includes(role)) return true;

  const roles = Array.isArray(record.roles) ? record.roles.map((item) => String(item).toLowerCase()) : [];
  if (roles.some((item) => ['admin', 'editor', 'edit'].includes(item))) return true;

  const permissions = Array.isArray(record.permissions)
    ? record.permissions.map((item) => String(item).toLowerCase())
    : [];
  if (permissions.includes('edit') || permissions.includes('editor') || permissions.includes('admin')) return true;

  return false;
};

export const loadEditorAccess = async (uid: string | null): Promise<EditorAccess> => {
  if (!uid) return { canEdit: false, source: null };

  const envAllowed = (import.meta.env.VITE_EDITOR_UIDS as string | undefined)
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (envAllowed?.includes(uid)) {
    return { canEdit: true, source: 'env:VITE_EDITOR_UIDS' };
  }

  try {
    const fs = await getFirestoreHelpers();
    const candidates: Array<[string, string]> = [
      ['editorPermissions', uid],
      ['userPermissions', uid],
      ['users', uid],
    ];

    for (const [collectionName, docId] of candidates) {
      const snapshot = await fs.getDoc(fs.doc(fs.db, collectionName, docId));
      if (snapshot.exists() && hasEditPermission(snapshot.data())) {
        return { canEdit: true, source: `${collectionName}/${docId}` };
      }
    }
  } catch (error) {
    console.error('Failed to load editor access:', error);
  }

  return { canEdit: false, source: null };
};