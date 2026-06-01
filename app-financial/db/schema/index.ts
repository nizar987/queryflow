import { appSchema, tableSchema } from '@nozbe/watermelondb';

export const schema = appSchema({
  version: 1,
  tables: [
    // ─── Wallets ───────────────────────────────────────────────
    tableSchema({
      name: 'wallets',
      columns: [
        { name: 'name', type: 'string' },
        { name: 'icon', type: 'string' },
        { name: 'type', type: 'string' },
        { name: 'currency', type: 'string' },
        { name: 'balance', type: 'number' },
        { name: 'color', type: 'string', isOptional: true },
        { name: 'is_archived', type: 'boolean' },
        { name: 'sort_order', type: 'number' },
        { name: 'cloud_sync', type: 'string' }, // renamed: synced | pending | error
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),

    // ─── Categories ────────────────────────────────────────────
    tableSchema({
      name: 'categories',
      columns: [
        { name: 'name', type: 'string' },
        { name: 'name_en', type: 'string', isOptional: true },
        { name: 'icon', type: 'string' },
        { name: 'color', type: 'string' },
        { name: 'type', type: 'string' },
        { name: 'budget_limit', type: 'number', isOptional: true },
        { name: 'is_default', type: 'boolean' },
        { name: 'sort_order', type: 'number' },
        { name: 'cloud_sync', type: 'string' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),

    // ─── Transactions ──────────────────────────────────────────
    tableSchema({
      name: 'transactions',
      columns: [
        { name: 'amount', type: 'number' },
        { name: 'type', type: 'string' },
        { name: 'category_id', type: 'string', isOptional: true },
        { name: 'wallet_id', type: 'string' },
        { name: 'to_wallet_id', type: 'string', isOptional: true },
        { name: 'currency', type: 'string' },
        { name: 'exchange_rate', type: 'number' },
        { name: 'note', type: 'string', isOptional: true },
        { name: 'date', type: 'number' },
        { name: 'receipt_path', type: 'string', isOptional: true },
        { name: 'receipt_url', type: 'string', isOptional: true },
        { name: 'is_recurring', type: 'boolean' },
        { name: 'recurring_interval', type: 'string', isOptional: true },
        { name: 'cloud_sync', type: 'string' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),

    // ─── Saving Goals ──────────────────────────────────────────
    tableSchema({
      name: 'saving_goals',
      columns: [
        { name: 'name', type: 'string' },
        { name: 'icon', type: 'string', isOptional: true },
        { name: 'target_amount', type: 'number' },
        { name: 'current_amount', type: 'number' },
        { name: 'currency', type: 'string' },
        { name: 'deadline', type: 'number', isOptional: true },
        { name: 'image_path', type: 'string', isOptional: true },
        { name: 'image_url', type: 'string', isOptional: true },
        { name: 'status', type: 'string' },
        { name: 'cloud_sync', type: 'string' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),

    // ─── Goal Allocations ──────────────────────────────────────
    tableSchema({
      name: 'allocations',
      columns: [
        { name: 'goal_id', type: 'string' },
        { name: 'wallet_id', type: 'string' },
        { name: 'amount', type: 'number' },
        { name: 'currency', type: 'string' },
        { name: 'exchange_rate', type: 'number' },
        { name: 'note', type: 'string', isOptional: true },
        { name: 'date', type: 'number' },
        { name: 'cloud_sync', type: 'string' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),

    // ─── Exchange Rate Cache ────────────────────────────────────
    tableSchema({
      name: 'exchange_rates',
      columns: [
        { name: 'base_currency', type: 'string' },
        { name: 'target_currency', type: 'string' },
        { name: 'rate', type: 'number' },
        { name: 'cached_at', type: 'number' },
      ],
    }),
  ],
});
