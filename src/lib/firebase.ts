import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Try to load from environment variables first (best for production/GitHub)
// Then fall back to the config file (best for local/AI Studio dev)
let firebaseConfig: any;

try {
  // We use import.meta.env for Vite environment variables
  if (import.meta.env.VITE_FIREBASE_API_KEY) {
    firebaseConfig = {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
      firestoreDatabaseId: import.meta.env.VITE_FIREBASE_DATABASE_ID,
    };
  } else {
    // Fallback to the local file if env vars aren't set
    // @ts-ignore
    const config = await import('../../firebase-applet-config.json');
    firebaseConfig = config.default || config;
  }
} catch (e) {
  console.warn("Could not load Firebase config from env or file. If you are on Render, check your Environment Variables.");
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
