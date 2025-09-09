import { binanceClient } from '../services/binance';
import { log } from './logger';

/**
 * Format price with appropriate precision based on trading pair info
 */
export async function formatPrice(price: number | string, symbol: string): Promise<string> {
  const numPrice = typeof price === 'string' ? parseFloat(price) : price;
  
  if (isNaN(numPrice)) {
    return '0';
  }

  try {
    // Get symbol precision from Binance API
    const precisionInfo = await binanceClient.getSymbolPrecision(symbol);
    
    if (precisionInfo) {
      const precision = precisionInfo.pricePrecision;
      
      // Use the exact precision from Binance
      return numPrice.toFixed(precision);
    }
  } catch (error) {
    log.debug(`Failed to get precision for ${symbol}, using smart formatting`, error);
  }

  // Fallback to smart precision based on price value
  return formatPriceSmartFallback(numPrice);
}

/**
 * Smart price formatting fallback when precision info is unavailable
 */
function formatPriceSmartFallback(price: number): string {
  if (price >= 1000) {
    // High value coins (BTC, ETH): 2 decimal places
    return price.toFixed(2);
  } else if (price >= 1) {
    // Mid value coins (ADA, DOT): 4 decimal places  
    return price.toFixed(4);
  } else if (price >= 0.01) {
    // Low value coins (DOGE): 6 decimal places
    return price.toFixed(6);
  } else if (price >= 0.000001) {
    // Very low value coins (SHIB): 8 decimal places
    return price.toFixed(8);
  } else {
    // Extremely low value: up to 12 decimal places
    return price.toFixed(12);
  }
}

/**
 * Format price with thousands separators for better readability
 */
export async function formatPriceWithSeparators(price: number | string, symbol: string): Promise<string> {
  const formattedPrice = await formatPrice(price, symbol);
  const numPrice = parseFloat(formattedPrice);
  
  // For prices >= 1, add thousands separators
  if (numPrice >= 1) {
    return numPrice.toLocaleString('en-US', {
      minimumFractionDigits: getPrecisionFromFormattedPrice(formattedPrice),
      maximumFractionDigits: getPrecisionFromFormattedPrice(formattedPrice)
    });
  }
  
  return formattedPrice;
}

/**
 * Get number of decimal places from a formatted price string
 */
function getPrecisionFromFormattedPrice(formattedPrice: string): number {
  const decimalIndex = formattedPrice.indexOf('.');
  if (decimalIndex === -1) return 0;
  return formattedPrice.length - decimalIndex - 1;
}

/**
 * Batch format multiple prices with their symbols
 */
export async function batchFormatPrices(priceSymbolPairs: Array<{ price: number | string; symbol: string }>): Promise<string[]> {
  const results: string[] = [];
  
  for (const pair of priceSymbolPairs) {
    const formatted = await formatPriceWithSeparators(pair.price, pair.symbol);
    results.push(formatted);
  }
  
  return results;
}

/**
 * Format price change percentage with appropriate precision
 */
export function formatPriceChange(changePercent: number): string {
  if (Math.abs(changePercent) >= 100) {
    // Large changes: 1 decimal place
    return changePercent.toFixed(1);
  } else if (Math.abs(changePercent) >= 10) {
    // Medium changes: 2 decimal places
    return changePercent.toFixed(2);
  } else {
    // Small changes: 3 decimal places for precision
    return changePercent.toFixed(3);
  }
}