import { Model } from '@nozbe/watermelondb';
import { field, text } from '@nozbe/watermelondb/decorators';

export class Wallet extends Model {
  static table = 'wallets';

  @text('name') name!: string;
  @text('icon') icon!: string;
  @text('type') type!: string;
  @text('currency') currency!: string;
  @field('balance') balance!: number;
  @text('color') color!: string;
  @field('is_archived') isArchived!: boolean;
  @field('sort_order') sortOrder!: number;
  @text('cloud_sync') cloudSync!: string;
  @field('created_at') createdAt!: number;
  @field('updated_at') updatedAt!: number;
}
