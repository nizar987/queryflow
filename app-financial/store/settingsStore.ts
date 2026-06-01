import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_CURRENCY } from '@/constants/currencies';

interface AppSettings {
  baseCurrency: string;
  language: 'id' | 'en';
  theme: 'dark' | 'light' | 'system';
  pinEnabled: boolean;
  biometricEnabled: boolean;
  isOnboarded: boolean;
  lastActive: number;
}

interface SettingsState extends AppSettings {
  isLoading: boolean;
  load: () => Promise<void>;
  update: (settings: Partial<AppSettings>) => Promise<void>;
}

const SETTINGS_KEY = 'dompeto_settings';

const DEFAULT_SETTINGS: AppSettings = {
  baseCurrency: DEFAULT_CURRENCY,
  language: 'id',
  theme: 'dark',
  pinEnabled: false,
  biometricEnabled: false,
  isOnboarded: false,
  lastActive: Date.now(),
};

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...DEFAULT_SETTINGS,
  isLoading: true,

  load: async () => {
    try {
      const raw = await AsyncStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<AppSettings>;
        set({ ...DEFAULT_SETTINGS, ...saved, isLoading: false });
      } else {
        set({ isLoading: false });
      }
    } catch {
      set({ isLoading: false });
    }
  },

  update: async (settings) => {
    const current = get();
    const next = { ...current, ...settings };
    set(next);
    try {
      const toSave: AppSettings = {
        baseCurrency: next.baseCurrency,
        language: next.language,
        theme: next.theme,
        pinEnabled: next.pinEnabled,
        biometricEnabled: next.biometricEnabled,
        isOnboarded: next.isOnboarded,
        lastActive: next.lastActive,
      };
      await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(toSave));
    } catch (e) {
      console.error('Failed to save settings:', e);
    }
  },
}));
