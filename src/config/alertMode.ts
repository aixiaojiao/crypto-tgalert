import { config } from '../config';
import type { FuturesSymbolInfo } from '../types/binance';

/**
 * 标的模式划分(单一真相源)。
 *
 * 币安把加密永续和 TradFi 永续放在同一个 USDⓈ本位合约体系里,只用 contractType 区分:
 *   - 加密永续:    contractType === 'PERPETUAL' 且 underlyingType === 'COIN'
 *   - TradFi 永续: contractType === 'TRADIFI_PERPETUAL'(币安官方拼写,注意是 TRADIFI 不是 TRADFI)
 *     覆盖美股(EQUITY)、商品(COMMODITY)、指数(INDEX)、韩股(KR_EQUITY)、pre-IPO(PREMARKET)。
 *
 * 在符号宇宙的源头按 isSymbolInMode 过滤一次,所有下游警报服务自动继承正确的标的集合。
 */
type SymbolModeFields = Pick<FuturesSymbolInfo, 'contractType' | 'underlyingType'>;

export function isCryptoSymbol(s: SymbolModeFields): boolean {
  return s.contractType === 'PERPETUAL' && s.underlyingType === 'COIN';
}

export function isTradfiSymbol(s: SymbolModeFields): boolean {
  return s.contractType === 'TRADIFI_PERPETUAL';
}

/** 当前 ALERT_MODE 下该符号是否纳入监控宇宙 */
export function isSymbolInMode(s: SymbolModeFields): boolean {
  return config.app.alertMode === 'tradfi' ? isTradfiSymbol(s) : isCryptoSymbol(s);
}

/** 面向用户的模式文案(启动通知 / welcome / help 共用,避免多处重复) */
export function alertModeLabel(): { title: string; desc: string } {
  return config.app.alertMode === 'tradfi'
    ? { title: 'Binance TradFi 永续警报', desc: 'TradFi 永续(美股/商品/指数等)' }
    : { title: 'Crypto Alert', desc: '加密永续' };
}
