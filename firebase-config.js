import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAM0hkZkAM5LtWn_f9yZmdul5gjpDM5G-4",
  authDomain: "query-mangement.firebaseapp.com",
  projectId: "query-mangement",
  storageBucket: "query-mangement.firebasestorage.app",
  messagingSenderId: "195967239707",
  appId: "1:195967239707:web:c172b3e927aa93b321dabe",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});
