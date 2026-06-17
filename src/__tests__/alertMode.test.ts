import { isCryptoSymbol, isTradfiSymbol, isSymbolInMode, alertModeLabel } from '../config/alertMode';
import { config } from '../config';
import type { FuturesSymbolInfo } from '../types/binance';

/**
 * 用真实 exchangeInfo 字段构造测试样本(取自币安线上实测):
 *   BTCUSDT  -> PERPETUAL / COIN        (加密)
 *   NVDAUSDT -> TRADIFI_PERPETUAL / EQUITY     (美股)
 *   XAUUSDT  -> TRADIFI_PERPETUAL / COMMODITY  (黄金)
 *   SPCXUSDT -> TRADIFI_PERPETUAL / PREMARKET  (pre-IPO,字段实测为 EQUITY,这里用 PREMARKET 覆盖另一取值)
 *   季度合约  -> CURRENT_QUARTER / COIN  (既非加密永续也非 TradFi)
 */
function mkSymbol(over: Partial<FuturesSymbolInfo>): FuturesSymbolInfo {
  return {
    symbol: 'BTCUSDT',
    pair: 'BTCUSDT',
    contractType: 'PERPETUAL',
    deliveryDate: 0,
    onboardDate: 0,
    status: 'TRADING',
    maintMarginPercent: '2.5',
    requiredMarginPercent: '5',
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    marginAsset: 'USDT',
    pricePrecision: 2,
    quantityPrecision: 3,
    baseAssetPrecision: 8,
    quotePrecision: 8,
    underlyingType: 'COIN',
    underlyingSubType: ['PoW'],
    settlePlan: 0,
    triggerProtect: '0.05',
    liquidationFee: '0.015',
    marketTakeBound: '0.05',
    maxMoveOrderLimit: 10000,
    ...over,
  };
}

const cryptoPerp = mkSymbol({ symbol: 'BTCUSDT', contractType: 'PERPETUAL', underlyingType: 'COIN' });
const equityPerp = mkSymbol({ symbol: 'NVDAUSDT', contractType: 'TRADIFI_PERPETUAL', underlyingType: 'EQUITY' });
const commodityPerp = mkSymbol({ symbol: 'XAUUSDT', contractType: 'TRADIFI_PERPETUAL', underlyingType: 'COMMODITY' });
const preIpoPerp = mkSymbol({ symbol: 'SPCXUSDT', contractType: 'TRADIFI_PERPETUAL', underlyingType: 'PREMARKET' });
const quarterly = mkSymbol({ symbol: 'BTCUSDT_260626', contractType: 'CURRENT_QUARTER', underlyingType: 'COIN' });

describe('alertMode 标的划分', () => {
  describe('isCryptoSymbol', () => {
    it('只对 PERPETUAL + COIN 返回 true', () => {
      expect(isCryptoSymbol(cryptoPerp)).toBe(true);
    });
    it('对 TradFi 永续返回 false(即便是 EQUITY/COMMODITY/PREMARKET)', () => {
      expect(isCryptoSymbol(equityPerp)).toBe(false);
      expect(isCryptoSymbol(commodityPerp)).toBe(false);
      expect(isCryptoSymbol(preIpoPerp)).toBe(false);
    });
    it('对季度合约(非永续)返回 false', () => {
      expect(isCryptoSymbol(quarterly)).toBe(false);
    });
    it('对 PERPETUAL 但 underlyingType 非 COIN 的边界返回 false', () => {
      expect(isCryptoSymbol(mkSymbol({ contractType: 'PERPETUAL', underlyingType: 'INDEX' }))).toBe(false);
    });
  });

  describe('isTradfiSymbol', () => {
    it('对所有 TRADIFI_PERPETUAL 返回 true(不论 underlyingType)', () => {
      expect(isTradfiSymbol(equityPerp)).toBe(true);
      expect(isTradfiSymbol(commodityPerp)).toBe(true);
      expect(isTradfiSymbol(preIpoPerp)).toBe(true);
    });
    it('对加密永续返回 false', () => {
      expect(isTradfiSymbol(cryptoPerp)).toBe(false);
    });
    it('对季度合约返回 false', () => {
      expect(isTradfiSymbol(quarterly)).toBe(false);
    });
  });

  describe('isSymbolInMode 跟随 ALERT_MODE 切换', () => {
    const original = config.app.alertMode;
    afterEach(() => {
      config.app.alertMode = original;
    });

    it('tradfi 模式下只放行 TradFi 永续,屏蔽加密', () => {
      config.app.alertMode = 'tradfi';
      expect(isSymbolInMode(equityPerp)).toBe(true);
      expect(isSymbolInMode(commodityPerp)).toBe(true);
      expect(isSymbolInMode(cryptoPerp)).toBe(false);
      expect(isSymbolInMode(quarterly)).toBe(false);
    });

    it('crypto 模式下只放行加密永续,屏蔽 TradFi', () => {
      config.app.alertMode = 'crypto';
      expect(isSymbolInMode(cryptoPerp)).toBe(true);
      expect(isSymbolInMode(equityPerp)).toBe(false);
      expect(isSymbolInMode(commodityPerp)).toBe(false);
      expect(isSymbolInMode(quarterly)).toBe(false);
    });
  });

  describe('alertModeLabel 文案跟随模式', () => {
    const original = config.app.alertMode;
    afterEach(() => {
      config.app.alertMode = original;
    });

    it('tradfi 模式给出 TradFi 文案', () => {
      config.app.alertMode = 'tradfi';
      const { title, desc } = alertModeLabel();
      expect(title).toContain('TradFi');
      expect(desc).toContain('美股');
    });

    it('crypto 模式给出加密文案', () => {
      config.app.alertMode = 'crypto';
      const { title, desc } = alertModeLabel();
      expect(title).toBe('Crypto Alert');
      expect(desc).toBe('加密永续');
    });
  });
});
