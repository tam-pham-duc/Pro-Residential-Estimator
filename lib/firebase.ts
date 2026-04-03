import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBGfo5E0C-9UlwTJ00GAXLxTFEWlC9vBrA",
  authDomain: "tam-project-350c0.firebaseapp.com",
  databaseURL: "https://tam-project-350c0-default-rtdb.firebaseio.com",
  projectId: "tam-project-350c0",
  storageBucket: "tam-project-350c0.firebasestorage.app",
  messagingSenderId: "743400893160",
  appId: "1:743400893160:web:cf5227680294a2c5b2f75d",
  measurementId: "G-SC2JLHRYZT"
};

// Initialize Firebase
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);
const db = getFirestore(app);

export { app, auth, db };
