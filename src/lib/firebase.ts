import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Load from environment variables (best for production/GitHub)
// Helper to get env variables with fallback support
const getEnv = (key: string) => {
  const rawVal = import.meta.env[key] || (typeof process !== 'undefined' ? process.env[key] : undefined);
  if (typeof rawVal === 'string') {
    // Clean up potential quotes or whitespace from copy-pasting
    return rawVal.trim().replace(/^["']|["']$/g, '');
  }
  return rawVal;
};

const firebaseConfig = {
  apiKey: getEnv('VITE_FIREBASE_API_KEY'),
  authDomain: getEnv('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: getEnv('VITE_FIREBASE_PROJECT_ID'),
  storageBucket: getEnv('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: getEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId: getEnv('VITE_FIREBASE_APP_ID'),
  firestoreDatabaseId: getEnv('VITE_FIREBASE_DATABASE_ID'),
};

console.log("[Firebase] Initializing for project:", firebaseConfig.projectId);

if (!firebaseConfig.apiKey || !firebaseConfig.authDomain) {
  console.error("[Firebase] 🚨 CRITICAL CONFIG ERROR: API Key or Auth Domain is missing from environment variables.");
}

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig?.firestoreDatabaseId);

export const googleProvider = new GoogleAuthProvider();
// Add Drive scopes
googleProvider.addScope('https://www.googleapis.com/auth/drive.readonly');
googleProvider.addScope('https://www.googleapis.com/auth/userinfo.profile');
googleProvider.addScope('https://www.googleapis.com/auth/userinfo.email');

export default app;
