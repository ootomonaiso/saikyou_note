// Firebase設定ファイル
// GitHub Actions による自動生成用のテンプレート
// 本番環境ではGitHub Secretsからの値が入ります

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, where } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "${{ secrets.FIREBASE_API_KEY }}",
  authDomain: "${{ secrets.FIREBASE_AUTH_DOMAIN }}",
  projectId: "${{ secrets.FIREBASE_PROJECT_ID }}",
  storageBucket: "${{ secrets.FIREBASE_STORAGE_BUCKET }}",
  messagingSenderId: "${{ secrets.FIREBASE_MESSAGING_SENDER_ID }}",
  appId: "${{ secrets.FIREBASE_APP_ID }}"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

export {
  auth,
  db,
  signInWithPopup,
  GoogleAuthProvider,
  googleProvider,
  signOut,
  onAuthStateChanged,
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  where
};
