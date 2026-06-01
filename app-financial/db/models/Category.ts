import { Model } from '@nozbe/watermelondb';
import { field, text } from '@nozbe/watermelondb/decorators';

export class Category extends Model {
  static table = 'categories';

  @text('name') name!: string;
  @text('name_en') nameEn!: string;
  @text('icon') icon!: string;
  @text('color') color!: string;
  @text('type') type!: 'expense' | 'income';
  @field('budget_limit') budgetLimit!: number;
  @field('is_default') isDefault!: boolean;
  @field('sort_order') sortOrder!: number;
  @text('cloud_sync') cloudSync!: string;
  @field('created_at') createdAt!: number;
  @field('updated_at') updatedAt!: number;
}
