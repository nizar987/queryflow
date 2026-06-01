import { Database } from '@nozbe/watermelondb';
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';

import { schema } from './schema';
import migrations from './schema/migrations';
import { Wallet } from './models/Wallet';
import { Category } from './models/Category';
import { Transaction } from './models/Transaction';
import { SavingGoal, Allocation } from './models/SavingGoal';

const adapter = new SQLiteAdapter({
  schema,
  migrations,
  jsi: true, // Use JSI for better performance
  onSetUpError: (error) => {
    console.error('WatermelonDB setup error:', error);
  },
});

export const database = new Database({
  adapter,
  modelClasses: [
    Wallet,
    Category,
    Transaction,
    SavingGoal,
    Allocation,
  ],
});

// Collection shortcuts
export const walletsCollection = database.get<Wallet>('wallets');
export const categoriesCollection = database.get<Category>('categories');
export const transactionsCollection = database.get<Transaction>('transactions');
export const savingGoalsCollection = database.get<SavingGoal>('saving_goals');
export const allocationsCollection = database.get<Allocation>('allocations');
