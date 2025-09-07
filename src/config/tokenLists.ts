/**
 * 代币分类配置文件
 * 手动维护各类代币列表
 */

// 已下架代币黑名单 - 完全过滤
export const DELISTED_TOKENS = [
  'ALPACA', 'BNX', 'OCEAN', 'DGB', 'AKRO', 'SXP', 
  'TRB', 'KNC', 'CRV', 'STORJ', 'ANT', 'COMP',
  'MKR', 'YFI', 'SUSHI', 'UMA', 'BNT', 'REN',
  'LRC', 'BAL', 'ZRX', 'KAVA', 'IOTX', 'RVN',
  'CHZ', 'HOT', 'VET', 'TFUEL', 'HBAR', 'ICX',
  'QTUM', 'ONT', 'ZIL', 'IOST', 'WAVES', 'SC',
  'AGIX'  // AGIX已下架
];

// 坚决不买黑名单 - 风险极高
export const BLACKLIST_TOKENS = [
  'LUNA', 'LUNC', 'USTC', 'FTT', 'SRM', 'RAY',
  'COPE', 'STEP', 'MEDIA', 'ROPE', 'TULIP', 'SLIM',
  'SNY', 'PORT', 'MNGO', 'FIDA', 'KIN', 'MAPS'
];

// 谨慎购买黄名单 - 高波动性风险
export const YELLOWLIST_TOKENS = [
  'SHIB', 'DOGE', 'PEPE', 'FLOKI', 'BABYDOGE', 'SAFEMOON',
  'ICP', 'JASMY', 'LOOM', 'CELR', 'CKB', 'ANKR',
  'DENT', 'WIN', 'BTT', 'TRX', 'JST', 'SUN',
  'NFP', 'AI', 'WLD', 'ORDI', '1000SATS', 'RATS'
];


/**
 * 检查代币是否在指定列表中
 */
export function isTokenInList(symbol: string, tokenList: string[]): boolean {
  const cleanSymbol = symbol.replace(/(USDT|BUSD)$/i, '').toUpperCase();
  return tokenList.includes(cleanSymbol);
}

/**
 * 获取代币风险等级
 */
export function getTokenRiskLevel(symbol: string): 'delisted' | 'blacklist' | 'yellowlist' | 'unknown' {
  if (isTokenInList(symbol, DELISTED_TOKENS)) return 'delisted';
  if (isTokenInList(symbol, BLACKLIST_TOKENS)) return 'blacklist';
  if (isTokenInList(symbol, YELLOWLIST_TOKENS)) return 'yellowlist';
  return 'unknown';
}

/**
 * 获取风险等级图标
 */
export function getRiskIcon(riskLevel: string): string {
  switch (riskLevel) {
    case 'delisted': return '🚫';
    case 'blacklist': return '⛔';
    case 'yellowlist': return '⚠️';
    default: return '';
  }
}

/**
 * 过滤合适的交易对
 */
export function filterTradingPairs(symbols: string[]): string[] {
  return symbols.filter(symbol => {
    // 只保留USDT永续合约
    if (!symbol.includes('USDT')) return false;
    
    // 过滤USDC交易对
    if (symbol.includes('USDC')) return false;
    
    // 过滤季度合约 (包含日期的合约)
    if (/\d{6}$/.test(symbol)) return false; // 以6位数字结尾的季度合约
    
    // 过滤已下架和黑名单代币
    const riskLevel = getTokenRiskLevel(symbol);
    if (riskLevel === 'delisted' || riskLevel === 'blacklist') return false;
    
    return true;
  });
}