import { Model } from '@nozbe/watermelondb';
import { field, text } from '@nozbe/watermelondb/decorators';

export class SavingGoal extends Model {
  static table = 'saving_goals';

  @text('name') name!: string;
  @text('icon') icon!: string;
  @field('target_amount') targetAmount!: number;
  @field('current_amount') currentAmount!: number;
  @text('currency') currency!: string;
  @field('deadline') deadline!: number;
  @text('image_path') imagePath!: string;
  @text('image_url') imageUrl!: string;
  @text('status') status!: 'active' | 'completed' | 'cancelled';
  @text('cloud_sync') cloudSync!: string;
  @field('created_at') createdAt!: number;
  @field('updated_at') updatedAt!: number;

  get progress(): number {
    if (this.targetAmount === 0) return 0;
    return Math.min((this.currentAmount / this.targetAmount) * 100, 100);
  }

  get remaining(): number {
    return Math.max(this.targetAmount - this.currentAmount, 0);
  }
}

export class Allocation extends Model {
  static table = 'allocations';

  @text('goal_id') goalId!: string;
  @text('wallet_id') walletId!: string;
  @field('amount') amount!: number;
  @text('currency') currency!: string;
  @field('exchange_rate') exchangeRate!: number;
  @text('note') note!: string;
  @field('date') date!: number;
  @text('cloud_sync') cloudSync!: string;
  @field('created_at') createdAt!: number;
  @field('updated_at') updatedAt!: number;
}
