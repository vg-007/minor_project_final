import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Your web app's Firebase configuration
// IMPORTANT: Replace this config with your actual Firebase project configuration
const firebaseConfig = {
  apiKey: "AIzaSyBPb7P-7H6-IOImpjevneC4F6NEt6bTWdU",
  authDomain: "travelease-web.firebaseapp.com",
  projectId: "travelease-web",
  storageBucket: "travelease-web.firebasestorage.app",
  messagingSenderId: "595610985175",
  appId: "1:595610985175:web:e6d4b66aa95bb524460692",
  measurementId: "G-3GXLBBPSGJ"
};
// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
