import { initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User
} from "firebase/auth";
import { doc, getFirestore, serverTimestamp, setDoc } from "firebase/firestore";
import { apiFetch } from "./api";
import type { AuthUser } from "./auth";

const firebaseConfig = {
  apiKey: "AIzaSyAMxIT7KMkxaq8bCD4YUoS2ev6XNhAZjww",
  authDomain: "adslogins.firebaseapp.com",
  projectId: "adslogins",
  storageBucket: "adslogins.firebasestorage.app",
  messagingSenderId: "1060576333681",
  appId: "1:1060576333681:web:5c948626188fca4f4330d0"
};

const app = initializeApp(firebaseConfig);
export const firebaseApp = app;
export const firestore = getFirestore(app);
export const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch((error) => {
  console.warn("Failed to set Firebase auth persistence", error);
});

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

async function upsertFirestoreUser(user: User) {
  if (!user.email) {
    throw new Error("Firebase user is missing an email address.");
  }

  await setDoc(
    doc(firestore, "users", user.uid),
    {
      uid: user.uid,
      email: user.email,
      name: user.displayName || user.email.split("@")[0],
      photoURL: user.photoURL || "",
      lastLoginAt: serverTimestamp(),
      provider: user.providerData[0]?.providerId || "google.com"
    },
    { merge: true }
  );
}

async function exchangeBackendSession(user: User): Promise<AuthUser> {
  if (!user.email) {
    throw new Error("Firebase user is missing an email address.");
  }

  const response = await apiFetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: user.email,
      name: user.displayName || user.email.split("@")[0]
    })
  });

  const userData = await response.json();
  if (!response.ok || userData.error) {
    throw new Error(userData.error || "Failed to start app session");
  }

  return userData as AuthUser;
}

export async function signInWithFirebaseGoogle(): Promise<AuthUser> {
  const result = await signInWithPopup(auth, googleProvider);
  await upsertFirestoreUser(result.user);
  return exchangeBackendSession(result.user);
}

export async function signInWithFirebaseEmail(email: string, password: string): Promise<AuthUser> {
  const result = await signInWithEmailAndPassword(auth, email, password);
  await upsertFirestoreUser(result.user);
  return exchangeBackendSession(result.user);
}

export async function createFirebaseAccount(name: string, email: string, password: string): Promise<AuthUser> {
  const result = await createUserWithEmailAndPassword(auth, email, password);
  if (name.trim()) {
    await updateProfile(result.user, { displayName: name.trim() });
  }
  await upsertFirestoreUser({
    ...result.user,
    displayName: name.trim() || result.user.displayName
  } as User);
  return exchangeBackendSession(result.user);
}

export async function syncFirebaseUserToBackend(user: User): Promise<AuthUser> {
  await upsertFirestoreUser(user);
  return exchangeBackendSession(user);
}

export function subscribeToFirebaseAuth(callback: (user: User | null) => void) {
  return onAuthStateChanged(auth, callback);
}

export async function signOutFirebaseAuth() {
  await signOut(auth);
}

export function getFirebaseFriendlyError(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code: string }).code) : "";

  switch (code) {
    case "auth/invalid-credential":
      return "Incorrect email or password.";
    case "auth/email-already-in-use":
      return "This email is already in use. Try logging in instead.";
    case "auth/weak-password":
      return "Password is too weak. Use at least 6 characters.";
    case "auth/popup-closed-by-user":
      return "Google sign-in was closed before finishing.";
    case "auth/popup-blocked":
      return "Your browser blocked the sign-in popup. Please allow popups and try again.";
    case "auth/unauthorized-domain":
      return "This domain is not yet authorized in Firebase Auth. Add localhost in Firebase console authorized domains.";
    case "auth/operation-not-allowed":
      return "This sign-in method is not enabled in Firebase yet.";
    case "auth/invalid-email":
      return "Please enter a valid email address.";
    default:
      return error instanceof Error ? error.message : "Authentication failed.";
  }
}
