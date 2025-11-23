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
    apiKey: "AIzaSyDQuoxvbIexN9GVZPDja2xqrFzdKEyhUPM",
    authDomain: "semt-f9b00.firebaseapp.com",
    projectId: "semt-f9b00",
    storageBucket: "semt-f9b00.firebasestorage.app",
    messagingSenderId: "53799890840",
    appId: "1:53799890840:web:8a5ff68ac9a2e72c5785ed",
    measurementId: "G-C2WBZ4T8QY"
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