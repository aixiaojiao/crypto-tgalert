/**
 * 技术指标数学工具类
 * Mathematical utilities for technical indicators
 */

/**
 * 数学计算工具类
 */
export class MathUtils {
  /**
   * 计算数组的最大值及其索引
   */
  static maxWithIndex(values: number[]): { value: number; index: number } {
    if (values.length === 0) return { value: 0, index: -1 };

    let maxValue = values[0];
    let maxIndex = 0;

    for (let i = 1; i < values.length; i++) {
      if (values[i] > maxValue) {
        maxValue = values[i];
        maxIndex = i;
      }
    }

    return { value: maxValue, index: maxIndex };
  }

  /**
   * 计算数组的最小值及其索引
   */
  static minWithIndex(values: number[]): { value: number; index: number } {
    if (values.length === 0) return { value: 0, index: -1 };

    let minValue = values[0];
    let minIndex = 0;

    for (let i = 1; i < values.length; i++) {
      if (values[i] < minValue) {
        minValue = values[i];
        minIndex = i;
      }
    }

    return { value: minValue, index: minIndex };
  }

  /**
   * 计算滑动窗口最大值
   */
  static rollingMax(values: number[], period: number): number[] {
    const result: number[] = [];

    for (let i = period - 1; i < values.length; i++) {
      const window = values.slice(i - period + 1, i + 1);
      result.push(Math.max(...window));
    }

    return result;
  }

  /**
   * 计算滑动窗口最小值
   */
  static rollingMin(values: number[], period: number): number[] {
    const result: number[] = [];

    for (let i = period - 1; i < values.length; i++) {
      const window = values.slice(i - period + 1, i + 1);
      result.push(Math.min(...window));
    }

    return result;
  }

  /**
   * 计算平均值
   */
  static mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }

  /**
   * 计算中位数
   */
  static median(values: number[]): number {
    if (values.length === 0) return 0;

    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);

    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }

  /**
   * 计算方差
   */
  static variance(values: number[]): number {
    if (values.length === 0) return 0;

    const mean = this.mean(values);
    const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
    return this.mean(squaredDiffs);
  }

  /**
   * 计算标准差
   */
  static standardDeviation(values: number[]): number {
    return Math.sqrt(this.variance(values));
  }

  /**
   * 计算皮尔逊相关系数
   */
  static correlation(x: number[], y: number[]): number {
    if (x.length !== y.length || x.length === 0) return 0;

    const n = x.length;
    const meanX = this.mean(x);
    const meanY = this.mean(y);

    let numerator = 0;
    let sumXSquared = 0;
    let sumYSquared = 0;

    for (let i = 0; i < n; i++) {
      const deltaX = x[i] - meanX;
      const deltaY = y[i] - meanY;

      numerator += deltaX * deltaY;
      sumXSquared += deltaX * deltaX;
      sumYSquared += deltaY * deltaY;
    }

    const denominator = Math.sqrt(sumXSquared * sumYSquared);
    return denominator === 0 ? 0 : numerator / denominator;
  }

  /**
   * 计算线性回归斜率
   */
  static linearRegressionSlope(values: number[]): number {
    if (values.length < 2) return 0;

    const n = values.length;
    const x = Array.from({ length: n }, (_, i) => i);
    const y = values;

    const meanX = this.mean(x);
    const meanY = this.mean(y);

    let numerator = 0;
    let denominator = 0;

    for (let i = 0; i < n; i++) {
      numerator += (x[i] - meanX) * (y[i] - meanY);
      denominator += (x[i] - meanX) * (x[i] - meanX);
    }

    return denominator === 0 ? 0 : numerator / denominator;
  }

  /**
   * 计算百分位数
   */
  static percentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;
    if (percentile < 0 || percentile > 100) return 0;

    const sorted = [...values].sort((a, b) => a - b);
    const index = (percentile / 100) * (sorted.length - 1);

    if (Number.isInteger(index)) {
      return sorted[index];
    }

    const lower = sorted[Math.floor(index)];
    const upper = sorted[Math.ceil(index)];
    const weight = index - Math.floor(index);

    return lower + weight * (upper - lower);
  }

  /**
   * 归一化到指定范围
   */
  static normalize(values: number[], min: number = 0, max: number = 100): number[] {
    if (values.length === 0) return [];

    const dataMin = Math.min(...values);
    const dataMax = Math.max(...values);
    const range = dataMax - dataMin;

    if (range === 0) return values.map(() => (min + max) / 2);

    return values.map(val => {
      const normalized = (val - dataMin) / range;
      return min + normalized * (max - min);
    });
  }

  /**
   * 平滑处理（移动平均）
   */
  static smooth(values: number[], period: number): number[] {
    if (period <= 1) return [...values];

    const result: number[] = [];

    for (let i = 0; i < values.length; i++) {
      const start = Math.max(0, i - period + 1);
      const window = values.slice(start, i + 1);
      result.push(this.mean(window));
    }

    return result;
  }

  /**
   * 检测交叉点
   */
  static findCrossovers(
    series1: number[],
    series2: number[]
  ): Array<{ index: number; type: 'bullish' | 'bearish' }> {
    if (series1.length !== series2.length || series1.length < 2) return [];

    const crossovers: Array<{ index: number; type: 'bullish' | 'bearish' }> = [];

    for (let i = 1; i < series1.length; i++) {
      const prev1 = series1[i - 1];
      const curr1 = series1[i];
      const prev2 = series2[i - 1];
      const curr2 = series2[i];

      // 看多交叉：series1从下方穿越series2
      if (prev1 <= prev2 && curr1 > curr2) {
        crossovers.push({ index: i, type: 'bullish' });
      }
      // 看空交叉：series1从上方穿越series2
      else if (prev1 >= prev2 && curr1 < curr2) {
        crossovers.push({ index: i, type: 'bearish' });
      }
    }

    return crossovers;
  }

  /**
   * 计算变化率
   */
  static rateOfChange(values: number[], period: number): number[] {
    const result: number[] = [];

    for (let i = period; i < values.length; i++) {
      const current = values[i];
      const previous = values[i - period];

      if (previous === 0) {
        result.push(0);
      } else {
        const roc = ((current - previous) / previous) * 100;
        result.push(roc);
      }
    }

    return result;
  }

  /**
   * 计算动量
   */
  static momentum(values: number[], period: number): number[] {
    const result: number[] = [];

    for (let i = period; i < values.length; i++) {
      const momentum = values[i] - values[i - period];
      result.push(momentum);
    }

    return result;
  }

  /**
   * 安全的数值格式化
   */
  static safeNumber(value: number, decimals: number = 8): number {
    if (!Number.isFinite(value)) return 0;
    return Number(value.toFixed(decimals));
  }

  /**
   * 检查是否为有效数字
   */
  static isValidNumber(value: number): boolean {
    return Number.isFinite(value) && !Number.isNaN(value);
  }

  /**
   * 计算数组中非零值的数量
   */
  static countNonZero(values: number[]): number {
    return values.filter(val => val !== 0).length;
  }

  /**
   * 计算数组中正值的数量
   */
  static countPositive(values: number[]): number {
    return values.filter(val => val > 0).length;
  }

  /**
   * 计算数组中负值的数量
   */
  static countNegative(values: number[]): number {
    return values.filter(val => val < 0).length;
  }
}