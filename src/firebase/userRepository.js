import { doc, setDoc, getDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "./config";

// Create or update a user profile in Firestore
// Matches the schema defined in firestore.rules
export const createUserProfile = async (user, additionalData = {}) => {
    if (!user) return;

    const userRef = doc(db, "users", user.uid);
    
    const userData = {
        email: user.email,
        displayName: user.displayName || "",
        createdAt: serverTimestamp(),
        ...additionalData
    };

    try {
        // use merge: true to avoid overwriting existing fields if the document exists
        await setDoc(userRef, userData, { merge: true });
        return userData;
    } catch (error) {
        console.error("Error creating user profile:", error);
        throw error;
    }
};

// Get a user profile
export const getUserProfile = async (userId) => {
    const userRef = doc(db, "users", userId);
    try {
        const docSnap = await getDoc(userRef);
        if (docSnap.exists()) {
            return docSnap.data();
        } else {
            return null;
        }
    } catch (error) {
        console.error("Error getting user profile:", error);
        throw error;
    }
};

// Update user score (example for game data)
export const updateUserScore = async (userId, newScore) => {
    if (!Number.isFinite(newScore)) {
        throw new Error("Invalid score: must be a finite number");
    }

    const userRef = doc(db, "users", userId);
    try {
        await updateDoc(userRef, {
            score: newScore,
            lastPlayed: serverTimestamp()
        });
    } catch (error) {
        console.error("Error updating score:", error);
        throw error;
    }
};
