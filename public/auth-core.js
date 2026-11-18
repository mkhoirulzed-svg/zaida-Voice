import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDqzKq2OXQfYnG-DOSyuzo4xo0GjSb-a8",
  authDomain: "zaida-voice.firebaseapp.com",
  projectId: "zaida-voice",
  storageBucket: "zaida-voice.firebasestorage.app",
  messagingSenderId: "146292786794",
  appId: "1:146292786794:web:da865938c177b21d5d6c13"
};

// Every ZAIDA page imports this module so Firebase configuration and Auth
// initialization stay identical throughout the application.
export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);

// Firebase restores persisted credentials asynchronously. Consumers can await
// this promise before showing a logged-out state or requesting account data.
export const authReady = new Promise(resolve => {
  let unsubscribe = () => {};
  unsubscribe = onAuthStateChanged(auth, user => {
    unsubscribe();
    resolve(user);
  }, error => {
    unsubscribe();
    console.error("[ZAIDA Auth] Session restoration failed:", error);
    resolve(null);
  });
});

// Redirect is more reliable than a popup on mobile browsers and embedded
// webviews. Desktop keeps the familiar popup flow.
export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
  if (mobile) {
    await signInWithRedirect(auth, provider);
    return null;
  }
  return signInWithPopup(auth, provider);
}

// Complete a pending mobile redirect after the browser returns to ZAIDA.
// A normal page load simply resolves to null.
export const redirectResultReady = getRedirectResult(auth).catch(error => {
  console.error("[ZAIDA Auth] Google redirect result:", error);
  return null;
});
