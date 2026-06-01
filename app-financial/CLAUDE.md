# 📝 Dompeto - AI & Developer Prompt Guide

Welcome to Dompeto! This guide assists AI agents and developers in understanding the codebase, commands, and best practices for building this offline-first financial tracking app.

## 🔧 Core Commands

### Starting & Running the App
```bash
# Start Metro Bundler
npx expo start

# Start on Android
npm run android

# Start on iOS
npm run ios

# Start on Web
npm run web
```

### Dependency Management
* **Always** use `npx expo install <package>` for any Expo SDK packages.
* For pure utility dependencies, standard `npm install <package> --legacy-peer-deps` is fine.

### Code Quality & Validation
```bash
# Type Check (Do this before finalizing any changes!)
npx tsc --noEmit
```

## 🏗️ Architecture & Stack

1. **Routing**: Expo Router (file-based).
   - Core routes are located in `app/`.
   - `app/(tabs)/` handles bottom tab navigation.
   - `app/modals/` contains presentational modals (like adding wallet/transaction).
2. **Database (Offline-First)**: WatermelonDB + SQLite.
   - Schemas are in `db/schema/index.ts`.
   - Models are in `db/models/`.
   - **Crucial**: Fields named `syncStatus` conflict with WatermelonDB's built-in properties. Always use `cloudSync` / `cloud_sync` for cloud-sync status.
3. **State Management**: Zustand stores in `store/`.
   - Simple, fast, and does not require complex boilerplate.
4. **Styling**: Vanilla React Native `StyleSheet` with curated styling colors defined in `constants/colors.ts`.

## 🔄 Code Change Guidelines

### 1. Adding a new Screen / Route
* Add the route inside `app/(tabs)/<name>.tsx` or `app/modals/<name>.tsx`.
* Register the route in `app/_layout.tsx` (for modals) or `app/(tabs)/_layout.tsx` (for tabs).

### 2. Updating the Database Schema & Models
* Database schema is modified in `db/schema/index.ts`. Remember to bump the `version` number!
* Add a migration in `db/schema/migrations.ts` if needed.
* Add columns/tables into models (e.g., `db/models/Transaction.ts`) using `@field` or `@text` decorators:
  ```typescript
  import { Model } from '@nozbe/watermelondb';
  import { field, text } from '@nozbe/watermelondb/decorators';
  
  export class NewModel extends Model {
    static table = 'new_table';
    @text('name') name!: string;
  }
  ```
* Register the model in `db/index.ts` under the `modelClasses` array and export collection shortcuts if appropriate.

### 3. Adding a new Zustand Store
* Define a store inside `store/` (e.g., `store/newStore.ts`).
* Use `create` from `zustand`. Combine with local storage using `AsyncStorage` if persistence is required.

## ✅ Coding Best Practices
* **Keep Code Type-Safe**: Keep interfaces strict and complete inside components and stores. Avoid `any` types.
* **Component Styling**: Always use `constants/colors.ts` theme colors. Support dark mode elegantly.
* **Imports**: Use the `@/*` alias for clean imports (e.g., `import { Colors } from '@/constants/colors';`).
* **Offline-First Mindset**: Read and write data using WatermelonDB collections. Allow database queries to drive the UI.
