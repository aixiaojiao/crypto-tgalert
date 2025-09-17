import { AlertType, AlertCondition, AlertConfig, AlertPriority, NotificationChannel } from '../services/alerts/IAlertService';

export interface ParsedAlertCommand {
  symbol: string;
  condition: AlertCondition;
  value: number;
  type: AlertType;
  priority?: AlertPriority;
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
   */
  static parseAlertCommand(args: string[]): ParsedAlertCommand {
    if (!args || args.length < 3) {
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
  static toAlertConfig(
    parsed: ParsedAlertCommand,
    userId: string,
    chatId: number
  ): AlertConfig {
    const id = `${userId}-${parsed.symbol}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    return {
      id,
      symbol: parsed.symbol,
      type: parsed.type,
      condition: parsed.condition,
      thresholds: {
        value: parsed.value
      },
      enabled: true,
      notificationChannels: [NotificationChannel.TELEGRAM],
      cooldownMs: 5 * 60 * 1000, // 5分钟冷却时间
      maxRetries: 3,
      priority: parsed.priority || AlertPriority.MEDIUM,
      metadata: {
        userId,
        chatId,
        createdAt: new Date().toISOString()
      }
    };
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

      default:
        return `${symbol} ${conditionText} ${thresholds.value}`;
    }
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
      default:
        return '满足条件';
    }
  }
}