import AsyncStorage from '@react-native-async-storage/async-storage';
import { CURRENCIES, EXCHANGE_RATE_API_BASE, EXCHANGE_RATE_TTL } from '@/constants/currencies';

const RATE_CACHE_KEY = 'dompeto_exchange_rates';

interface RateCache {
  base: string;
  rates: Record<string, number>;
  cachedAt: number;
}

/**
 * Fetch exchange rates from API and cache locally
 */
export async function fetchExchangeRates(base: string = 'USD'): Promise<Record<string, number> | null> {
  try {
    const response = await fetch(`${EXCHANGE_RATE_API_BASE}/${base}`);
    if (!response.ok) throw new Error('API error');
    const data = await response.json();
    const rates: Record<string, number> = data.rates;

    const cache: RateCache = { base, rates, cachedAt: Date.now() };
    await AsyncStorage.setItem(RATE_CACHE_KEY, JSON.stringify(cache));

    return rates;
  } catch (error) {
    console.warn('Exchange rate fetch failed, using cache:', error);
    return null;
  }
}

/**
 * Get cached exchange rates (returns null if stale or missing)
 */
export async function getCachedRates(base: string = 'USD'): Promise<{ rates: Record<string, number>; isStale: boolean } | null> {
  try {
    const raw = await AsyncStorage.getItem(RATE_CACHE_KEY);
    if (!raw) return null;

    const cache: RateCache = JSON.parse(raw);
    if (cache.base !== base) return null;

    const isStale = Date.now() - cache.cachedAt > EXCHANGE_RATE_TTL;
    return { rates: cache.rates, isStale };
  } catch {
    return null;
  }
}

/**
 * Get exchange rate from source to target currency.
 * Falls back to cached rate if offline.
 */
export async function getExchangeRate(from: string, to: string): Promise<{ rate: number; isStale: boolean }> {
  if (from === to) return { rate: 1, isStale: false };

  // Try to get fresh rates
  let rates: Record<string, number> | null = null;
  let isStale = false;

  const cached = await getCachedRates('USD');
  if (cached && !cached.isStale) {
    rates = cached.rates;
  } else {
    // Try to fetch fresh
    const fresh = await fetchExchangeRates('USD');
    if (fresh) {
      rates = fresh;
    } else if (cached) {
      // Use stale cache as fallback
      rates = cached.rates;
      isStale = true;
    }
  }

  if (!rates) {
    console.warn('No exchange rates available');
    return { rate: 1, isStale: true };
  }

  // Convert: from → USD → to
  const fromRate = rates[from] ?? 1;
  const toRate = rates[to] ?? 1;
  const rate = toRate / fromRate;

  return { rate, isStale };
}

/**
 * Convert amount from one currency to another
 */
export async function convertCurrency(
  amount: number,
  from: string,
  to: string
): Promise<{ converted: number; rate: number; isStale: boolean }> {
  const { rate, isStale } = await getExchangeRate(from, to);
  return { converted: amount * rate, rate, isStale };
}

/**
 * Format amount with currency symbol
 */
export function formatCurrency(amount: number, currencyCode: string, locale: string = 'id-ID'): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currencyCode,
      minimumFractionDigits: currencyCode === 'IDR' ? 0 : 2,
      maximumFractionDigits: currencyCode === 'IDR' ? 0 : 2,
    }).format(amount);
  } catch {
    return `${currencyCode} ${amount.toLocaleString()}`;
  }
}
