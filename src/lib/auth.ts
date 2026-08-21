// ─── Firebase Auth Abstraction ─────────────────────────────────────────────────
// Swappable: replace this file's implementation to change auth providers
// without touching any other part of the application.

export interface AuthState {
  uid: string | null;
  displayName: string | null;
  email: string | null;
}

export interface AuthProvider {
  /** App-level state change listener */
  onAuthChange: (setter: (state: AuthState) => void) => () => void;
  /** Log in with email + password */
  signIn: (email: string, password: string) => Promise<AuthState>;
  /** Log in with Google popup */
  signInWithGoogle: () => Promise<AuthState>;
  /** Log out */
  signOut: () => Promise<void>;
  /** Update display name */
  updateDisplayName: (newName: string) => Promise<void>;
  /** Update password */
  updatePassword: (newPassword: string) => Promise<void>;
  /** Get current display name */
  getDisplayName: () => string | null;
  /** Get current UID */
  getUid: () => string | null;
  /** Log in as guest (anonymous) */
  signInAsGuest: () => Promise<AuthState>;
}

let currentAuthState: AuthState = { uid: null, displayName: null, email: null };
let changeListeners: Array<(state: AuthState) => void> = [];

const notify = (state: AuthState) => {
  currentAuthState = state;
  changeListeners.forEach((fn) => fn(state));
};

// ─── Firebase Initialization ───────────────────────────────────────────────────

let firebaseAuth: any = null;

const toAuthState = (user: any): AuthState => ({
  uid: user.uid,
  displayName: user.displayName || user.email,
  email: user.email || null,
});

async function saveUserProfile(user: any): Promise<void> {
  if (!user?.uid || user.isAnonymous) return;

  try {
    const { getApps, getApp, initializeApp } = await import('firebase/app');
    const { getFirestore, doc, setDoc, serverTimestamp } = await import('firebase/firestore');
    const app = getApps().length > 0 ? getApp() : initializeApp({
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
    });
    const db = getFirestore(app);
    await setDoc(doc(db, 'users', user.uid), {
      uid: user.uid,
      email: user.email || '',
      displayName: user.displayName || user.email || 'Google User',
      photoURL: user.photoURL || '',
      provider: 'google',
      lastLoginAt: serverTimestamp(),
    }, { merge: true });
  } catch (error) {
    console.error('Failed to save auth user profile:', error);
  }
}

async function getFirebase() {
  if (firebaseAuth) return firebaseAuth;

  const initMod = await import('firebase/app');
  const initializeApp = initMod.initializeApp;
  const authMod = await import('firebase/auth');
  const getAuth = authMod.getAuth;
  const onAuthStateChanged = authMod.onAuthStateChanged;
  const setPersistence = authMod.setPersistence;
  const browserLocalPersistence = authMod.browserLocalPersistence;
  const signInWithEmailAndPassword = authMod.signInWithEmailAndPassword;
  const fbSignOut = authMod.signOut;
  const updateProfile = authMod.updateProfile;
  const fbUpdatePassword = authMod.updatePassword;
  const signInAnonymously = authMod.signInAnonymously;
  const GoogleAuthProvider = authMod.GoogleAuthProvider;
  const signInWithPopup = authMod.signInWithPopup;

 const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
});

  const auth = getAuth(app);
  await setPersistence(auth, browserLocalPersistence);
  onAuthStateChanged(auth, (user: any) => {
    if (user) {
      notify(toAuthState(user));
      saveUserProfile(user);
    } else {
      notify({ uid: null, displayName: null, email: null });
    }
  });

  firebaseAuth = {
    auth,
    signInWithEmailAndPassword,
    fbSignOut,
    updateProfile,
    fbUpdatePassword,
    signInAnonymously,
    GoogleAuthProvider,
    signInWithPopup,
  };

  return firebaseAuth;
}

// ─── Implementation ────────────────────────────────────────────────────────────

export const authProvider: AuthProvider = {
  onAuthChange: (setter: (state: AuthState) => void) => {
    changeListeners.push(setter);
    // Immediately call with current state
    setter(currentAuthState);
    return () => {
      changeListeners = changeListeners.filter((fn) => fn !== setter);
    };
  },

  signIn: async (email: string, password: string): Promise<AuthState> => {
    const fb = await getFirebase();
    const cred = await fb.signInWithEmailAndPassword(fb.auth, email, password);
    await saveUserProfile(cred.user);
    return toAuthState(cred.user);
  },

  signInWithGoogle: async (): Promise<AuthState> => {
    const fb = await getFirebase();
    const provider = new fb.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const cred = await fb.signInWithPopup(fb.auth, provider);
    await saveUserProfile(cred.user);
    return toAuthState(cred.user);
  },

  signOut: async () => {
    await getFirebase();
    await (await getFirebase()).fbSignOut((await getFirebase()).auth);
  },

  updateDisplayName: async (newName: string) => {
    const fb = await getFirebase();
    const auth = fb.auth;
    if (auth.currentUser) {
      await fb.updateProfile(auth.currentUser, { displayName: newName });
      // Re-notify
      notify({ uid: auth.currentUser.uid, displayName: newName, email: auth.currentUser.email || null });
      await saveUserProfile(auth.currentUser);
    }
  },

  updatePassword: async (newPassword: string) => {
    const fb = await getFirebase();
    const auth = fb.auth;
    if (auth.currentUser) {
      await fb.fbUpdatePassword(auth.currentUser, newPassword);
    }
  },

  getDisplayName: () => currentAuthState.displayName,
  getUid: () => currentAuthState.uid,

  signInAsGuest: async (): Promise<AuthState> => {
    const fb = await getFirebase();
    const cred = await fb.signInAnonymously(fb.auth);
    const user = cred.user;
    return { uid: user.uid, displayName: 'Guest', email: null };
  },
};
