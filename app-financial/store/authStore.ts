import { create } from 'zustand';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  User,
  GoogleAuthProvider,
  signInWithCredential,
} from 'firebase/auth';
import { auth } from '@/services/firebase';

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isGuest: boolean;
  isPinVerified: boolean;
  error: string | null;

  // Actions
  signUp: (email: string, password: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signInAsGuest: () => Promise<void>;
  signOut: () => Promise<void>;
  verifyPin: () => Promise<void>;
  clearError: () => void;
  initialize: () => () => void; // returns unsubscribe fn
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  isGuest: false,
  isPinVerified: false,
  error: null,

  initialize: () => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      set({ user, isLoading: false });
    });
    return unsubscribe;
  },

  signUp: async (email, password) => {
    set({ isLoading: true, error: null });
    try {
      await createUserWithEmailAndPassword(auth, email, password);
      set({ isGuest: false });
    } catch (error: any) {
      set({ error: error.message });
    } finally {
      set({ isLoading: false });
    }
  },

  signIn: async (email, password) => {
    set({ isLoading: true, error: null });
    try {
      await signInWithEmailAndPassword(auth, email, password);
      set({ isGuest: false });
    } catch (error: any) {
      set({ error: error.message });
    } finally {
      set({ isLoading: false });
    }
  },

  signInAsGuest: async () => {
    set({ isLoading: true, error: null });
    try {
      // Guest mode: no Firebase auth, data stays local only
      set({ isGuest: true, user: null, isLoading: false });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },

  signOut: async () => {
    set({ isLoading: true });
    try {
      await firebaseSignOut(auth);
      set({ user: null, isGuest: false, isPinVerified: false });
    } catch (error: any) {
      set({ error: error.message });
    } finally {
      set({ isLoading: false });
    }
  },

  clearError: () => set({ error: null }),
  
  verifyPin: async () => {
    set({ isPinVerified: true });
  },
}));
