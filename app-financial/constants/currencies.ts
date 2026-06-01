// Supported currencies (ISO 4217)
export interface CurrencyDef {
  code: string;
  name: string;
  nameEn: string;
  symbol: string;
  flag: string;
}

export const CURRENCIES: CurrencyDef[] = [
  { code: 'IDR', name: 'Rupiah Indonesia', nameEn: 'Indonesian Rupiah', symbol: 'Rp', flag: '🇮🇩' },
  { code: 'USD', name: 'Dolar Amerika', nameEn: 'US Dollar', symbol: '$', flag: '🇺🇸' },
  { code: 'EUR', name: 'Euro', nameEn: 'Euro', symbol: '€', flag: '🇪🇺' },
  { code: 'SGD', name: 'Dolar Singapura', nameEn: 'Singapore Dollar', symbol: 'S$', flag: '🇸🇬' },
  { code: 'MYR', name: 'Ringgit Malaysia', nameEn: 'Malaysian Ringgit', symbol: 'RM', flag: '🇲🇾' },
  { code: 'GBP', name: 'Pound Sterling', nameEn: 'British Pound', symbol: '£', flag: '🇬🇧' },
  { code: 'JPY', name: 'Yen Jepang', nameEn: 'Japanese Yen', symbol: '¥', flag: '🇯🇵' },
  { code: 'AUD', name: 'Dolar Australia', nameEn: 'Australian Dollar', symbol: 'A$', flag: '🇦🇺' },
  { code: 'SAR', name: 'Riyal Arab Saudi', nameEn: 'Saudi Riyal', symbol: 'SR', flag: '🇸🇦' },
  { code: 'CNY', name: 'Yuan China', nameEn: 'Chinese Yuan', symbol: '¥', flag: '🇨🇳' },
  { code: 'THB', name: 'Baht Thailand', nameEn: 'Thai Baht', symbol: '฿', flag: '🇹🇭' },
  { code: 'KRW', name: 'Won Korea', nameEn: 'South Korean Won', symbol: '₩', flag: '🇰🇷' },
  { code: 'HKD', name: 'Dolar Hong Kong', nameEn: 'Hong Kong Dollar', symbol: 'HK$', flag: '🇭🇰' },
  { code: 'AED', name: 'Dirham UEA', nameEn: 'UAE Dirham', symbol: 'د.إ', flag: '🇦🇪' },
];

export const CURRENCY_MAP = CURRENCIES.reduce((acc, cur) => {
  acc[cur.code] = cur;
  return acc;
}, {} as Record<string, CurrencyDef>);

export const DEFAULT_CURRENCY = 'IDR';

// Exchange rate cache TTL in milliseconds (4 hours)
export const EXCHANGE_RATE_TTL = 4 * 60 * 60 * 1000;

// ExchangeRate-API free endpoint (no key needed for basic pairs)
export const EXCHANGE_RATE_API_BASE = 'https://open.er-api.com/v6/latest';
