# Dompeto Setup Plan

## Step 1: Expo Init ✅ (Running)
- create-expo-app blank-typescript

## Step 2: Install Core Dependencies
- expo-router (navigation)
- nativewind + tailwindcss (styling)
- @nozbe/watermelondb (offline DB)
- firebase (auth + firestore + storage)
- zustand (state management)
- react-native-safe-area-context
- expo-secure-store
- expo-local-authentication (biometrik)
- expo-notifications
- @react-native-async-storage/async-storage
- victory-native (charts)
- react-native-reanimated
- react-native-gesture-handler
- expo-image-picker
- expo-camera
- dayjs (date utility)
- currency.js

## Step 3: Project Structure
/app
  /(auth)
  /(tabs)
    index.tsx (Dashboard)
    transactions.tsx
    savings.tsx
    reports.tsx
    wallets.tsx
  /modals
    add-transaction.tsx
    add-wallet.tsx
    add-goal.tsx
/components
/store (zustand)
/db (watermelondb)
  /models
  /schema
  sync.ts
/services
  firebase.ts
  currency.ts
/constants
  colors.ts
  categories.ts
/hooks
/utils

## Step 4: Firebase Config
- Initialize Firebase project connection
- Setup Firestore security rules
- Setup Auth

## Step 5: WatermelonDB Schema
- Define all tables (wallets, categories, transactions, saving_goals, allocations)

## Step 6: Zustand Stores
- authStore
- walletStore
- transactionStore
- categoryStore
- savingGoalStore
- currencyStore
