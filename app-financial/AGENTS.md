# 📝 Expo Development Guide (Dompeto Edition)

## Expo HAS CHANGED

**🚨 IMPORTANT**: Expo has undergone significant changes. Always refer to the **exact versioned documentation** for the version you are working with:

- **Expo 56 Docs**: https://docs.expo.dev/versions/v56.0.0/
- **React Native 0.85/0.86 Docs**: https://reactnative.dev/docs/0.86/

**Do not assume prior knowledge applies. Read the docs first.**

## 🏗️ Project Structure

```
dompeto/ (root)
├── android/            # Android native project files
├── ios/                # iOS native project files
├── assets/             # Static assets, fonts, and icons
├── app/                # Expo Router directory (file-based navigation)
│   ├── (auth)/         # Authentication flow screens
│   ├── (tabs)/         # Bottom tab navigation screens (Dashboard, Transactions, Savings, Reports, Settings)
│   ├── modals/         # Modal interfaces (Add Transaction, Add Wallet, Add Goal)
│   └── _layout.tsx     # Root routing layout
├── components/         # Reusable custom UI components (cards, lists, buttons)
├── constants/          # Application constants, theme colors, currencies, etc.
├── db/                 # WatermelonDB offline-first SQLite database
│   ├── models/         # Database models (Wallet, Category, Transaction, SavingGoal)
│   ├── schema/         # SQLite schemas and migrations
│   └── index.ts        # Database client initialization
├── store/              # Zustand global stores (authStore, settingsStore)
├── services/           # External API & Firebase Sync services
├── utils/              # Utility helper functions
├── app.json            # Expo configuration
├── babel.config.js     # Babel configuration (decorators and Reanimated)
├── package.json        # Project dependencies and scripts
└── tsconfig.json       # TypeScript configuration
```

## 🚀 Expo SDK Versions (CRITICAL)

### Current Version: **Expo SDK 56**

**Breaking Changes & Requirements in Expo 56:**

1. **Native Projects Required**
   - Expo SDK 56 requires **native Android and iOS projects** (pre-generated via `npx expo prebuild` or managed bare workflow).
   - All custom native modules are handled in this workflow.

2. **React Native 0.85+**
   - Uses modern React Native versioning.
   - Decorators require specific Babel setup for compilation.

3. **TypeScript 5**
   - Requires TypeScript 5+ (use `npx tsc --noEmit` to verify type safety).

4. **Dependencies**
   - Update all Expo-related dependencies to compatible versions.
   - **Always use** `npx expo install <package>` for all Expo SDK packages.
   - Avoid manual `npm install` for Expo/React Native packages unless they are non-Expo third-party libraries.

## 🔧 Environment Configuration

Use `.env.local` or `.env` in the project root for local environment variables:
```ini
# .env.local
EXPO_PUBLIC_FIREBASE_API_KEY=your-firebase-api-key
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
EXPO_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your-messaging-id
EXPO_PUBLIC_FIREBASE_APP_ID=your-app-id
```

## 🛠️ Development Commands

### Setup
```bash
# Clone and prepare env configuration
cp .env.example .env.local

# Install dependencies
npm install
```

### Run in Development Mode
```bash
# Start Metro bundler
npx expo start

# Open in Android emulator
npm run android

# Open in iOS simulator
npm run ios

# Open in web browser
npm run web
```

### Type Checking & Linting
```bash
# Run TypeScript compilation check
npx tsc --noEmit
```

## 🏗️ Architecture

### State Management
- **Zustand**: Lightweight global states in `store/`.
  - `store/authStore.ts`: Handles auth states, login, register, and guest mode.
  - `store/settingsStore.ts`: Theme configurations (dark/light/system), localizations, currency bases, and pin codes.

### Database (Offline-First)
- **WatermelonDB**: High-performance SQLite-backed database in `db/`.
  - Models (`db/models/`) require decorators like `@text` or `@field` to link table columns.
  - Field names like `syncStatus` are reserved by WatermelonDB's native synchronization system. Use `cloudSync` or `cloud_sync` instead.

### Navigation
- **Expo Router (File-Based Navigation)**
  - Folders in `app/` define the navigation tree structure.
  - Root Layout: `app/_layout.tsx` (manages GestureHandlerRootView, StatusBar, Stack routes).
  - Tab Layout: `app/(tabs)/_layout.tsx` (manages Bottom Tabs).

### API & Sync Layer
- **Firebase Auth** + **Cloud Firestore**: Configured in `services/`.
- Local changes in WatermelonDB are synchronized with Cloud Firestore periodically or when online.

## ⚠️ Important Notes

1. **Always use `npx expo install`** for Expo packages.
2. **Do not use `npm install`** for Expo SDK packages.
3. **Read versioned docs** (Expo 56) before making changes.
4. **WatermelonDB field constraints**: Ensure schemas match decorators exactly.
5. **Typescript checking**: Always run `npx tsc --noEmit` before proposing code changes to ensure compatibility.

## ✅ Best Practices

1. **Use `npx expo start`** for starting Metro.
2. **Check compatibility** of external dependencies before installing.
3. **Run type checking**: `npx tsc --noEmit`
4. **Platform testing**: Verify layouts look great and scale properly on both iOS and Android platforms.
5. **Use `EXPO_PUBLIC_` prefixes** for environment variables exposed to client-side code.
