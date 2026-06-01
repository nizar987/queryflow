import { Model } from '@nozbe/watermelondb';
import { field, text } from '@nozbe/watermelondb/decorators';

export class Transaction extends Model {
  static table = 'transactions';

  @field('amount') amount!: number;
  @text('type') type!: 'expense' | 'income' | 'transfer';
  @text('category_id') categoryId!: string;
  @text('wallet_id') walletId!: string;
  @text('to_wallet_id') toWalletId!: string;
  @text('currency') currency!: string;
  @field('exchange_rate') exchangeRate!: number;
  @text('note') note!: string;
  @field('date') date!: number;
  @text('receipt_path') receiptPath!: string;
  @text('receipt_url') receiptUrl!: string;
  @field('is_recurring') isRecurring!: boolean;
  @text('recurring_interval') recurringInterval!: string;
  @text('cloud_sync') cloudSync!: string;
  @field('created_at') createdAt!: number;
  @field('updated_at') updatedAt!: number;
}
