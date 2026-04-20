import { AlertType, AlertCondition, AlertConfig, AlertPriority, NotificationChannel, BreakthroughAlertMetadata } from '../services/alerts/IAlertService';
import { AlertIdManager } from '../services/alerts/AlertIdManager';

export interface ParsedAlertCommand {
  symbol: string;
  condition: AlertCondition;
  value: number;
  type: AlertType;
  priority?: AlertPriority;
  timeframe?: string; // For breakthrough alerts
  watchAllSymbols?: boolean; // For multi-breakthrough alerts
}

export class AlertCommandParser {
  private static readonly CONDITION_PATTERNS = {
    [AlertCondition.CROSSES_ABOVE]: /crosses?\s+above|breaks?\s+above/i,
    [AlertCondition.CROSSES_BELOW]: /crosses?\s+below|breaks?\s+below/i,
    [AlertCondition.GREATER_THAN]: /[>]|above|over|higher/i,
    [AlertCondition.LESS_THAN]: /[<]|below|under|lower/i,
    [AlertCondition.EQUALS]: /[=]|equals?|is/i,
    [AlertCondition.PERCENTAGE_CHANGE]: /[%]|percent|pct|change/i
  };

  private static readonly SYMBOL_PATTERN = /^[A-Z]{2,10}$/i;
  private static readonly NUMBER_PATTERN = /\d+(?:\.\d+)?/;

  /**
   * 解析警报命令
   * 支持的格式:
   * - /alert BTC > 50000
   * - /alert ETH < 3000
   * - /alert DOGE = 0.1
   * - /alert BTC change 5%
   * - /alert ETH crosses above 3500
   * - /alert breakthrough BTC 1w
   * - /alert bt ETH all
   * - /alert breakthrough all 1m
   */
  static parseAlertCommand(args: string[]): ParsedAlertCommand {
    if (!args || args.length < 2) {
      throw new Error('警报参数不足。格式: /alert <symbol> <condition> <value> 或 /alert breakthrough <symbol> <timeframe>');
    }

    // 检查是否为breakthrough命令
    const firstArg = args[0].toLowerCase();
    if (firstArg === 'breakthrough' || firstArg === 'bt') {
      return this.parseBreakthroughCommand(args.slice(1));
    }

    // 传统警报命令解析
    if (args.length < 3) {
      throw new Error('警报参数不足。格式: /alert <symbol> <condition> <value>');
    }

    const fullCommand = args.join(' ');

    // 提取符号
    const symbol = this.extractSymbol(args[0]);

    // 提取条件和值
    const { condition, value } = this.extractConditionAndValue(fullCommand, symbol);

    // 根据条件确定警报类型
    const type = this.determineAlertType(condition, value);

    return {
      symbol: symbol.toUpperCase(),
      condition,
      value,
      type,
      priority: AlertPriority.MEDIUM
    };
  }

  /**
   * 将解析结果转换为AlertConfig
   */
  static async toAlertConfig(
    parsed: ParsedAlertCommand,
    userId: string,
    chatId: number
  ): Promise<AlertConfig> {
    // 使用新的统一ID生成系统
    const idType = AlertIdManager.getIdTypeFromAlertType(parsed.type);
    const id = await AlertIdManager.generateId(idType, userId);

    // Breakthrough警报的特殊配置
    const isBreakthroughAlert = parsed.type === AlertType.BREAKTHROUGH || parsed.type === AlertType.MULTI_BREAKTHROUGH;

    const baseConfig: AlertConfig = {
      id,
      symbol: parsed.symbol,
      type: parsed.type,
      condition: parsed.condition,
      thresholds: {
        value: parsed.value,
        ...(parsed.timeframe && { timeframe: parsed.timeframe })
      },
      enabled: true,
      notificationChannels: [NotificationChannel.TELEGRAM],
      cooldownMs: isBreakthroughAlert ? this.calculateDynamicCooldown(parsed.timeframe) : 5 * 60 * 1000,
      maxRetries: 3,
      priority: parsed.priority || AlertPriority.MEDIUM,
      metadata: {
        userId,
        chatId,
        createdAt: new Date().toISOString()
      }
    };

    // 为breakthrough警报添加特殊元数据
    if (isBreakthroughAlert && parsed.timeframe) {
      const breakthroughMetadata: BreakthroughAlertMetadata = {
        timeframe: parsed.timeframe as any,
        watchAllSymbols: parsed.watchAllSymbols || false,
        triggeredSymbols: []
      };

      baseConfig.metadata = {
        ...baseConfig.metadata,
        ...breakthroughMetadata
      };
    }

    return baseConfig;
  }

  private static extractSymbol(firstArg: string): string {
    const symbol = firstArg.toUpperCase();

    if (!this.SYMBOL_PATTERN.test(symbol)) {
      throw new Error(`无效的交易对符号: ${firstArg}`);
    }

    return symbol;
  }

  private static extractConditionAndValue(fullCommand: string, symbol: string): {
    condition: AlertCondition;
    value: number;
  } {
    // 移除符号，只保留条件和值部分
    const conditionPart = fullCommand.replace(new RegExp(`^${symbol}\\s+`, 'i'), '').trim();

    // 查找匹配的条件
    let matchedCondition: AlertCondition | null = null;

    for (const [condition, pattern] of Object.entries(this.CONDITION_PATTERNS)) {
      const match = conditionPart.match(pattern);
      if (match) {
        matchedCondition = condition as AlertCondition;
        break;
      }
    }

    if (!matchedCondition) {
      throw new Error('无法识别的条件。支持: >, <, =, %, crosses above, crosses below');
    }

    // 提取数值
    const numberMatch = conditionPart.match(this.NUMBER_PATTERN);
    if (!numberMatch) {
      throw new Error('无法找到有效的数值');
    }

    const value = parseFloat(numberMatch[0]);
    if (isNaN(value) || value <= 0) {
      throw new Error(`无效的数值: ${numberMatch[0]}`);
    }

    return {
      condition: matchedCondition,
      value
    };
  }

  private static determineAlertType(condition: AlertCondition, _value: number): AlertType {
    switch (condition) {
      case AlertCondition.GREATER_THAN:
      case AlertCondition.CROSSES_ABOVE:
        return AlertType.PRICE_ABOVE;

      case AlertCondition.LESS_THAN:
      case AlertCondition.CROSSES_BELOW:
        return AlertType.PRICE_BELOW;

      case AlertCondition.PERCENTAGE_CHANGE:
        return AlertType.PRICE_CHANGE;

      default:
        return AlertType.PRICE_ABOVE; // 默认类型
    }
  }

  /**
   * 生成警报描述
   */
  static generateAlertDescription(config: AlertConfig): string {
    const { symbol, condition, thresholds, type } = config;
    const conditionText = this.getConditionText(condition);

    switch (type) {
      case AlertType.PRICE_ABOVE:
      case AlertType.PRICE_BELOW:
        return `${symbol} 价格 ${conditionText} ${thresholds.value}`;

      case AlertType.PRICE_CHANGE:
        return `${symbol} 价格变化 ${conditionText} ${thresholds.value}%`;

      case AlertType.BREAKTHROUGH:
        const timeframeName = this.getTimeframeName(thresholds.timeframe);
        return `${symbol} ${conditionText} (${timeframeName})`;

      case AlertType.MULTI_BREAKTHROUGH:
        const multiTimeframeName = this.getTimeframeName(thresholds.timeframe);
        return `全币种 ${conditionText} (${multiTimeframeName})`;

      default:
        return `${symbol} ${conditionText} ${thresholds.value}`;
    }
  }

  private static getTimeframeName(timeframe?: string): string {
    const timeframeNames: Record<string, string> = {
      '1w': '1周',
      '1m': '1个月',
      '6m': '6个月',
      '1y': '1年',
      'all': '历史'
    };

    return timeframeNames[timeframe || 'all'] || timeframe || '未知';
  }

  private static getConditionText(condition: AlertCondition): string {
    switch (condition) {
      case AlertCondition.GREATER_THAN:
        return '高于';
      case AlertCondition.LESS_THAN:
        return '低于';
      case AlertCondition.EQUALS:
        return '等于';
      case AlertCondition.PERCENTAGE_CHANGE:
        return '变化超过';
      case AlertCondition.CROSSES_ABOVE:
        return '突破上方';
      case AlertCondition.CROSSES_BELOW:
        return '跌破下方';
      case AlertCondition.BREAKS_HIGH:
        return '突破历史高点';
      case AlertCondition.BREAKS_TIMEFRAME_HIGH:
        return '突破时间框架高点';
      default:
        return '满足条件';
    }
  }

  /**
   * 根据时间框架计算动态冷却时间
   * 策略：确保及时通知，避免垃圾信息
   */
  private static calculateDynamicCooldown(timeframe?: string): number {
    if (!timeframe) return 30 * 60 * 1000; // 默认30分钟

    // 解析时间框架为分钟数
    const timeframeMinutes = this.parseTimeframeToMinutes(timeframe);

    if (timeframeMinutes <= 10) {
      // 10分钟以下：1分钟冷却
      return 1 * 60 * 1000;
    } else if (timeframeMinutes <= 60) {
      // 10分钟到1小时：5分钟冷却
      return 5 * 60 * 1000;
    } else {
      // 1小时以上：30分钟冷却
      return 30 * 60 * 1000;
    }
  }

  /**
   * 将时间框架字符串转换为分钟数
   */
  private static parseTimeframeToMinutes(timeframe: string): number {
    switch (timeframe) {
      case '1w': return 7 * 24 * 60;      // 1周 = 10080分钟
      case '1m': return 30 * 24 * 60;     // 1月 = 43200分钟
      case '6m': return 180 * 24 * 60;    // 6月 = 259200分钟
      case '1y': return 365 * 24 * 60;    // 1年 = 525600分钟
      case 'all': return 365 * 24 * 60;   // 历史 = 按1年计算
      default: return 60;                 // 未知时间框架按1小时计算
    }
  }

  /**
   * 解析breakthrough命令
   * 支持的格式:
   * - breakthrough BTC 1w
   * - breakthrough ETH all
   * - breakthrough all 1m (全币种监控)
   */
  private static parseBreakthroughCommand(args: string[]): ParsedAlertCommand {
    if (!args || args.length < 2) {
      throw new Error('突破警报参数不足。\n\n格式: /alert breakthrough <symbol> <timeframe>\n\n示例:\n• /alert breakthrough btc 1w\n• /alert breakthrough all 1m\n• /alert bt eth all\n\n支持时间框架: 1w, 1m, 6m, 1y, all');
    }

    const symbol = args[0].toLowerCase();
    const timeframe = args[1].toLowerCase();

    // 验证时间框架
    const validTimeframes = ['1w', '1m', '6m', '1y', 'all'];
    if (!validTimeframes.includes(timeframe)) {
      throw new Error(`无效的时间框架: ${timeframe}。支持: ${validTimeframes.join(', ')}`);
    }

    // 检查是否为全币种监控
    const watchAllSymbols = symbol === 'all';

    if (!watchAllSymbols) {
      // 验证单个币种符号
      if (!this.SYMBOL_PATTERN.test(symbol)) {
        throw new Error(`无效的交易对符号: ${symbol}`);
      }
    }

    // 确定警报类型
    const alertType = watchAllSymbols ? AlertType.MULTI_BREAKTHROUGH : AlertType.BREAKTHROUGH;
    const condition = timeframe === 'all' ? AlertCondition.BREAKS_HIGH : AlertCondition.BREAKS_TIMEFRAME_HIGH;

    return {
      symbol: watchAllSymbols ? 'ALL' : symbol.toUpperCase(),
      condition,
      value: 0, // breakthrough不需要具体数值
      type: alertType,
      priority: AlertPriority.CRITICAL, // 突破警报默认为关键级别
      timeframe,
      watchAllSymbols
    };
  }
}