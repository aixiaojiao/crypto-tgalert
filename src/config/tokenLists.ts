/**
 * 代币分类配置文件
 * 手动维护各类代币列表
 */

// 已下架代币黑名单 - 完全过滤
export const DELISTED_TOKENS = [
  'ALPACA', 'BNX', 'OCEAN', 'DGB', 'AGIX', 'LINA', 'LOKA'
];

// 坚决不买黑名单 - 风险极高
export const BLACKLIST_TOKENS = [
  'LUNA', 'LUNC', 'USTC', 'TA', 'BID', 'HIFI', 'BSW', 'EPT', 'OBOL', 'NAORIS', 'PUMPBTC', 'YALA','UXLINK'
];

// 谨慎购买黄名单 - 高波动性风险
export const YELLOWLIST_TOKENS = [
   'GPS', 'ZORA', 'DAM', 'PTB', 'Q', 'AIO', 'AVNT', 'SAPIEN', 'JELLYJELLY', 'F', 'BB', 'ACE', 'UB'
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
    case 'yellowlist': return '🟡';
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

/**
 * 过滤历史数据收集用的交易对 - 过滤已下架和风险代币
 */
export function filterHistoricalDataPairs(symbols: string[]): string[] {
  return symbols.filter(symbol => {
    // 只保留USDT永续合约
    if (!symbol.includes('USDT')) return false;

    // 过滤USDC交易对
    if (symbol.includes('USDC')) return false;

    // 过滤季度合约 (包含日期的合约)
    if (/\d{6}$/.test(symbol)) return false; // 以6位数字结尾的季度合约

    // 过滤已下架代币和风险代币，不保留其历史数据
    const riskLevel = getTokenRiskLevel(symbol);
    if (riskLevel === 'delisted' || riskLevel === 'blacklist') return false;

    return true;
  });
}

/**
 * 检查代币是否为风险代币（黑名单或黄名单）
 * 用于推送触发过滤逻辑
 */
export function isRiskyToken(symbol: string): boolean {
  const riskLevel = getTokenRiskLevel(symbol);
  return riskLevel === 'blacklist' || riskLevel === 'yellowlist';
}