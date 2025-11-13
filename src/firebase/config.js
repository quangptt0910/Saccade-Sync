// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
    apiKey: "AIzaSyCx01bQPQotYkkdNwgYyWUF9QAmECdUaAc",
    authDomain: "saccadesync.firebaseapp.com",
    projectId: "saccadesync",
    storageBucket: "saccadesync.firebasestorage.app",
    messagingSenderId: "257964961462",
    appId: "1:257964961462:web:f8fc82e4c129c258d54017",
    measurementId: "G-JGNLS1PHCE"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

// Initialize Firebase services
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);

// Export services to use in other files
export { app, analytics, db, auth, storage };