export type CategoryType = 'expense' | 'income';

export interface CategoryDef {
  id: string;
  name: string;
  nameEn: string;
  icon: string;
  color: string;
  type: CategoryType;
  isDefault: true;
}

export const EXPENSE_CATEGORIES: CategoryDef[] = [
  { id: 'food', name: 'Makanan & Minuman', nameEn: 'Food & Drink', icon: '🍔', color: '#FF6B6B', type: 'expense', isDefault: true },
  { id: 'transport', name: 'Transportasi', nameEn: 'Transportation', icon: '🚗', color: '#F59E0B', type: 'expense', isDefault: true },
  { id: 'housing', name: 'Perumahan / Sewa', nameEn: 'Housing / Rent', icon: '🏠', color: '#3B82F6', type: 'expense', isDefault: true },
  { id: 'health', name: 'Kesehatan', nameEn: 'Health', icon: '💊', color: '#EC4899', type: 'expense', isDefault: true },
  { id: 'fashion', name: 'Pakaian & Fashion', nameEn: 'Fashion', icon: '👗', color: '#8B5CF6', type: 'expense', isDefault: true },
  { id: 'education', name: 'Pendidikan', nameEn: 'Education', icon: '🎓', color: '#06B6D4', type: 'expense', isDefault: true },
  { id: 'bills', name: 'Tagihan & Utilitas', nameEn: 'Bills & Utilities', icon: '💳', color: '#14B8A6', type: 'expense', isDefault: true },
  { id: 'entertainment', name: 'Hiburan', nameEn: 'Entertainment', icon: '🎬', color: '#F97316', type: 'expense', isDefault: true },
  { id: 'electronics', name: 'Elektronik & Gadget', nameEn: 'Electronics', icon: '📱', color: '#6C63FF', type: 'expense', isDefault: true },
  { id: 'travel', name: 'Perjalanan', nameEn: 'Travel', icon: '✈️', color: '#00C896', type: 'expense', isDefault: true },
  { id: 'shopping', name: 'Belanja Online', nameEn: 'Online Shopping', icon: '🛍️', color: '#EF4444', type: 'expense', isDefault: true },
  { id: 'pets', name: 'Hewan Peliharaan', nameEn: 'Pets', icon: '🐾', color: '#84CC16', type: 'expense', isDefault: true },
  { id: 'debt', name: 'Cicilan / Utang', nameEn: 'Debt / Loans', icon: '💸', color: '#DC2626', type: 'expense', isDefault: true },
  { id: 'social', name: 'Donasi & Sosial', nameEn: 'Donations', icon: '🤝', color: '#D97706', type: 'expense', isDefault: true },
  { id: 'business_ops', name: 'Operasional Bisnis', nameEn: 'Business Ops', icon: '💼', color: '#4B5563', type: 'expense', isDefault: true },
  { id: 'other_expense', name: 'Lain-lain', nameEn: 'Others', icon: '📦', color: '#6B7280', type: 'expense', isDefault: true },
];

export const INCOME_CATEGORIES: CategoryDef[] = [
  { id: 'salary', name: 'Gaji / Upah', nameEn: 'Salary', icon: '💼', color: '#00C896', type: 'income', isDefault: true },
  { id: 'business', name: 'Penjualan / Bisnis', nameEn: 'Business', icon: '🏪', color: '#6C63FF', type: 'income', isDefault: true },
  { id: 'investment', name: 'Investasi & Dividen', nameEn: 'Investment', icon: '💹', color: '#F59E0B', type: 'income', isDefault: true },
  { id: 'bonus', name: 'Hadiah / Bonus', nameEn: 'Gift / Bonus', icon: '🎁', color: '#EC4899', type: 'income', isDefault: true },
  { id: 'transfer_in', name: 'Transfer Masuk', nameEn: 'Transfer In', icon: '💰', color: '#3B82F6', type: 'income', isDefault: true },
  { id: 'interest', name: 'Bunga Tabungan', nameEn: 'Interest', icon: '🏦', color: '#14B8A6', type: 'income', isDefault: true },
  { id: 'freelance', name: 'Freelance', nameEn: 'Freelance', icon: '🤑', color: '#8B5CF6', type: 'income', isDefault: true },
  { id: 'other_income', name: 'Lainnya', nameEn: 'Others', icon: '📈', color: '#6B7280', type: 'income', isDefault: true },
];

export const ALL_CATEGORIES = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES];

export const WALLET_TYPES = [
  { id: 'cash', name: 'Tunai', nameEn: 'Cash', icon: '💵' },
  { id: 'bank', name: 'Rekening Bank', nameEn: 'Bank Account', icon: '🏦' },
  { id: 'ewallet', name: 'Dompet Digital', nameEn: 'E-Wallet', icon: '📲' },
  { id: 'credit', name: 'Kartu Kredit', nameEn: 'Credit Card', icon: '💳' },
  { id: 'investment', name: 'Investasi', nameEn: 'Investment', icon: '📈' },
  { id: 'savings', name: 'Tabungan', nameEn: 'Savings', icon: '🏧' },
  { id: 'other', name: 'Lainnya', nameEn: 'Others', icon: '👛' },
] as const;

export const TRANSACTION_TYPES = {
  EXPENSE: 'expense',
  INCOME: 'income',
  TRANSFER: 'transfer',
} as const;

export type TransactionType = typeof TRANSACTION_TYPES[keyof typeof TRANSACTION_TYPES];

export const RECURRING_INTERVALS = [
  { id: 'daily', name: 'Setiap Hari', nameEn: 'Daily' },
  { id: 'weekly', name: 'Setiap Minggu', nameEn: 'Weekly' },
  { id: 'monthly', name: 'Setiap Bulan', nameEn: 'Monthly' },
  { id: 'yearly', name: 'Setiap Tahun', nameEn: 'Yearly' },
] as const;
