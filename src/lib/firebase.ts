import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, (firebaseConfig as any).firestoreDatabaseId);

export const googleProvider = new GoogleAuthProvider();
// Add Drive scopes
googleProvider.addScope('https://www.googleapis.com/auth/drive.readonly');
googleProvider.addScope('https://www.googleapis.com/auth/userinfo.profile');
googleProvider.addScope('https://www.googleapis.com/auth/userinfo.email');

export default app;
