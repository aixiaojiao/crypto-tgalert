# Crypto-TGAlert Diagnostic System

A comprehensive monitoring and diagnostic system for the crypto-tgalert application that provides detailed logging, health monitoring, and issue reproduction capabilities without modifying existing business logic.

## Overview

The diagnostic system consists of several integrated components:

- **Diagnostic Service**: Core diagnostic engine and metrics collection
- **Price Query Monitor**: Monitors Binance API calls and failures
- **Alert System Monitor**: Tracks alert system health and operations
- **Data Accuracy Validator**: Validates price data accuracy across sources
- **Diagnostic Logger**: Structured logging with categorized log levels
- **CLI Tools**: Command-line interface for diagnostic operations

## Features

### 1. Price Query Failure Tracking
- **Detailed Logging**: Records all API failures with context
- **Error Classification**: Categorizes errors by type (network, rate limit, API, etc.)
- **Performance Metrics**: Tracks response times and success rates
- **Rate Limit Monitoring**: Monitors API rate limit usage

### 2. Alert System Health Monitoring
- **Operation Tracking**: Monitors alert creation, triggering, and deactivation
- **Health Status**: Real-time health assessment of alert system
- **Performance Metrics**: Tracks alert check duration and success rates
- **Issue Detection**: Automatic detection of alert system anomalies

### 3. Statistical Data Accuracy Checks
- **Cross-Validation**: Validates prices across multiple data sources
- **Deviation Detection**: Identifies price discrepancies beyond thresholds
- **Continuous Monitoring**: Ongoing accuracy validation
- **Metadata Collection**: Includes volume and market data for context

### 4. System Runtime Monitoring
- **System Metrics**: Memory, CPU, and uptime monitoring
- **Health Checks**: Database, API, and service health validation
- **Anomaly Detection**: Automatic detection of performance issues
- **Trend Analysis**: Historical data for trend identification

### 5. Diagnostic Commands and Reports
- **CLI Interface**: Easy-to-use command-line tools
- **Multiple Formats**: Console, JSON, and Markdown output
- **Time Range Filtering**: Historical data analysis
- **Interactive Reports**: Detailed diagnostic reports

### 6. Issue Reproduction and Debugging
- **Issue Recording**: Systematic recording of failures and anomalies
- **Reproduction Tools**: Replay historical conditions
- **Context Preservation**: Full context for debugging
- **Resolution Tracking**: Track issue resolution progress

## Quick Start

### 1. Integration into Existing Application

```typescript
import { createDiagnosticSystem } from './src/diagnostics';
import { BinanceClient } from './src/services/binance';
import { PriceMonitorService } from './src/services/priceMonitor';

// Initialize diagnostic system
const binanceClient = new BinanceClient();
const priceMonitor = new PriceMonitorService(binanceClient);
const diagnosticSystem = createDiagnosticSystem(binanceClient, priceMonitor);

// Initialize and start monitoring
await diagnosticSystem.initialize();
await diagnosticSystem.startMonitoring({
  diagnosticInterval: 60000,           // 1 minute
  accuracyValidationInterval: 300000,  // 5 minutes
  enableContinuousAccuracyValidation: true
});
```

### 2. Using CLI Commands

```bash
# Health check
npm run diagnostic health --verbose

# Run full diagnostic
npm run diagnostic diagnose --output file

# Generate detailed report
npm run diagnostic report --format markdown --output file

# Show recent issues
npm run diagnostic issues --start 2025-01-01 --end 2025-01-02

# Test price accuracy
npm run diagnostic accuracy --symbols BTCUSDT,ETHUSDT,ADAUSDT

# Start continuous monitoring
npm run diagnostic monitor --interval 30000

# Reproduce specific issue
npm run diagnostic reproduce --issue pqf_123456_abcdef
```

### 3. Adding to package.json

Add these scripts to your `package.json`:

```json
{
  "scripts": {
    "diagnostic": "npx ts-node src/cli/diagnostic-cli.ts",
    "diagnostic:health": "npm run diagnostic health",
    "diagnostic:monitor": "npm run diagnostic monitor",
    "diagnostic:report": "npm run diagnostic report --format markdown --output file"
  }
}
```

## Monitoring Points

### 1. Price Query Monitoring

The system automatically wraps Binance API methods to monitor:

- **Request/Response Timing**: Tracks API response times
- **Error Classification**: Categorizes failures (network, rate limit, API errors)
- **Success Rates**: Calculates success/failure ratios
- **Rate Limit Usage**: Monitors API rate limit consumption
- **Slow Query Detection**: Identifies requests taking >5 seconds

**Monitored Methods:**
- `getPrice(symbol)`
- `getPrices(symbols)`
- `get24hrStats(symbol)`
- `getFuturesPrice(symbol)`
- `ping()`

### 2. Alert System Monitoring

Tracks alert system operations:

- **Alert Lifecycle**: Creation, triggering, deactivation
- **Check Operations**: Alert condition checking performance
- **Monitoring Sessions**: Start/stop of alert monitoring
- **Health Status**: Real-time system health assessment
- **Failed Operations**: Systematic failure tracking

### 3. Data Accuracy Validation

Validates price data accuracy:

- **Cross-Source Validation**: Compares spot vs futures vs 24hr stats
- **Deviation Thresholds**: Configurable accuracy thresholds
- **Continuous Monitoring**: Ongoing accuracy validation
- **Symbol-Specific Tracking**: Per-symbol accuracy metrics

### 4. System Health Metrics

Monitors overall system health:

- **Memory Usage**: Heap usage and memory pressure
- **CPU Load**: System load averages
- **Database Performance**: Connection and query performance
- **API Connectivity**: External service health
- **Uptime Tracking**: System availability metrics

## Log Format Specification

### Diagnostic Log Levels

1. **CRITICAL** (0): System-breaking issues requiring immediate attention
2. **ALERT** (1): Alert system issues affecting functionality
3. **API_ERROR** (2): API call failures and related issues
4. **PERFORMANCE** (3): Performance degradation and slow operations
5. **DATA_INTEGRITY** (4): Data accuracy and consistency issues
6. **DEBUG** (5): Diagnostic debug information

### Log Entry Structure

```
[TIMESTAMP] [LEVEL] [COMPONENT] MESSAGE {METADATA}
```

**Example:**
```
[2025-01-15 14:30:25.123] [API_ERROR    ] [PRICE_QUERY ] Price query failed for BTCUSDT: Rate limit exceeded {"symbol":"BTCUSDT","responseTime":5234,"errorCode":"429","retryCount":0}
```

### Log Files

- `logs/diagnostic-critical.log`: Critical system failures
- `logs/diagnostic-alerts.log`: Alert system issues
- `logs/diagnostic-api.log`: API call failures
- `logs/diagnostic-performance.log`: Performance issues
- `logs/diagnostic-all.log`: Comprehensive diagnostic log

## Diagnostic Commands

### health
Check current system health status.

```bash
npm run diagnostic health [--verbose]
```

**Output:**
- System health dashboard
- Component status indicators
- Key performance metrics
- Resource usage information

### diagnose
Run comprehensive system diagnostic.

```bash
npm run diagnostic diagnose [--verbose] [--output console|file|json]
```

**Output:**
- Complete system metrics
- API performance data
- Alert system status
- Database health
- Accuracy validation

### report
Generate detailed diagnostic report.

```bash
npm run diagnostic report [--format table|json|markdown] [--output console|file] [--start DATE] [--end DATE]
```

**Features:**
- Historical data analysis
- Trend identification
- Issue summaries
- Recommendations

### issues
Show recent system issues and failures.

```bash
npm run diagnostic issues [--start DATE] [--end DATE]
```

**Output:**
- Price query failures
- System anomalies
- Error trends
- Resolution recommendations

### accuracy
Test price accuracy across symbols.

```bash
npm run diagnostic accuracy [--symbols SYMBOL1,SYMBOL2] [--output console|file]
```

**Features:**
- Cross-source validation
- Deviation analysis
- Accuracy metrics
- Per-symbol results

### monitor
Start continuous monitoring mode.

```bash
npm run diagnostic monitor [--interval MS]
```

**Features:**
- Real-time monitoring
- Automatic issue detection
- Background logging
- Health status updates

### reproduce
Reproduce specific issue by ID.

```bash
npm run diagnostic reproduce --issue ISSUE_ID [--output console|file]
```

**Features:**
- Issue replay
- Context reconstruction
- Step-by-step reproduction
- Results analysis

## Configuration

### Diagnostic Service Configuration

```typescript
const diagnosticService = new DiagnosticService(binanceClient, priceMonitor);

// Configure automatic monitoring
await diagnosticService.startMonitoring(60000); // Check every 60 seconds
```

### Price Query Monitor Configuration

```typescript
const priceQueryMonitor = new PriceQueryMonitor(binanceClient, diagnosticService);

// Monitor automatically wraps API calls
// No additional configuration needed
```

### Alert System Monitor Configuration

```typescript
const alertSystemMonitor = new AlertSystemMonitor(priceMonitor, diagnosticService);

// Monitor alert operations
alertSystemMonitor.monitorAlertCreation(alert, userId);
alertSystemMonitor.monitorAlertDeactivation(alertId, reason);
```

### Data Accuracy Validator Configuration

```typescript
const validator = new DataAccuracyValidator(binanceClient, {
  deviationThreshold: 0.5,  // 0.5% threshold
  timeoutMs: 10000,         // 10 second timeout
  retryAttempts: 3,         // Retry failed calls 3 times
  symbols: ['BTCUSDT', 'ETHUSDT'], // Symbols to validate
});

// Start continuous validation
await validator.startContinuousValidation(300000); // Every 5 minutes
```

## File Structure

```
src/
├── diagnostics/
│   └── index.ts                    # Main diagnostic system integration
├── services/
│   ├── diagnosticService.ts        # Core diagnostic service
│   └── dataAccuracyValidator.ts    # Price accuracy validation
├── monitoring/
│   ├── priceQueryMonitor.ts        # API call monitoring
│   └── alertSystemMonitor.ts       # Alert system monitoring
├── commands/
│   └── diagnosticCommands.ts       # CLI command implementations
├── cli/
│   └── diagnostic-cli.ts           # CLI entry point
└── utils/
    └── diagnosticLogger.ts         # Structured diagnostic logging

logs/
├── diagnostics/
│   ├── metrics.json               # Historical metrics
│   ├── price-failures.json       # Price query failures
│   └── anomalies.json            # System anomalies
├── diagnostic-critical.log        # Critical issues
├── diagnostic-alerts.log          # Alert system issues
├── diagnostic-api.log             # API failures
├── diagnostic-performance.log     # Performance issues
└── diagnostic-all.log             # All diagnostic logs
```

## Issue Reproduction Strategy

### 1. Automatic Issue Recording

The system automatically records:
- **Price Query Failures**: Full context including symbol, error type, response time
- **System Anomalies**: Performance issues, resource constraints, API problems
- **Alert System Issues**: Failed checks, monitoring problems, trigger failures

### 2. Context Preservation

Each issue record includes:
- **Timestamp**: Exact time of occurrence
- **System State**: Memory usage, CPU load, active connections
- **Request Context**: API parameters, rate limit status, network conditions
- **Error Details**: Full error messages, stack traces, response codes

### 3. Reproduction Process

```typescript
// Reproduce an issue by ID
const result = await diagnosticService.reproduceIssue('pqf_123456_abcdef');

console.log('Reproduction Result:', result.reproduced);
console.log('Steps:', result.steps);
console.log('Results:', result.results);
```

### 4. Debugging Tools

- **Step-by-step Reproduction**: Replay exact conditions
- **Environment Simulation**: Recreate system state
- **Comparative Analysis**: Compare current vs historical behavior
- **Resolution Tracking**: Monitor fix effectiveness

## Best Practices

### 1. Integration Guidelines

- **Non-Intrusive**: System monitors existing services without modification
- **Performance Aware**: Minimal overhead on business operations
- **Configurable**: Adjustable monitoring intervals and thresholds
- **Graceful Degradation**: Continues operation even if monitoring fails

### 2. Monitoring Strategy

- **Layered Approach**: Multiple monitoring levels (API, system, application)
- **Threshold-Based Alerts**: Configurable thresholds for different severity levels
- **Historical Tracking**: Maintain metrics for trend analysis
- **Proactive Detection**: Identify issues before they impact users

### 3. Data Management

- **Log Rotation**: Automatic log file rotation to prevent disk space issues
- **Data Retention**: Configurable retention periods for different data types
- **Compression**: Compress historical data to save space
- **Export Capabilities**: Export data for external analysis

### 4. Performance Considerations

- **Batched Operations**: Group operations to reduce overhead
- **Async Processing**: Non-blocking monitoring operations
- **Resource Limits**: Configurable limits on memory and CPU usage
- **Rate Limiting**: Respect API rate limits during monitoring

## Troubleshooting

### Common Issues

1. **High Memory Usage**
   - **Symptom**: Memory usage consistently above 80%
   - **Diagnosis**: Check metrics.system.memory in diagnostic logs
   - **Solution**: Restart application or increase memory limit

2. **API Rate Limits**
   - **Symptom**: Frequent rate limit errors in API logs
   - **Diagnosis**: Check rateLimitStatus in price query failures
   - **Solution**: Increase request intervals or implement request queuing

3. **Slow Alert Checks**
   - **Symptom**: Alert check duration > 30 seconds
   - **Diagnosis**: Check avgCheckDuration in alert system health
   - **Solution**: Optimize database queries or reduce check frequency

4. **Price Accuracy Issues**
   - **Symptom**: Accuracy below 95%
   - **Diagnosis**: Check discrepancies in accuracy reports
   - **Solution**: Investigate data sources and network connectivity

### Diagnostic Commands for Troubleshooting

```bash
# Quick health check
npm run diagnostic health

# Detailed system analysis
npm run diagnostic diagnose --verbose --output file

# Check recent failures
npm run diagnostic issues --start $(date -d '1 hour ago' --iso-8601)

# Monitor in real-time
npm run diagnostic monitor --interval 10000
```

## Advanced Usage

### Custom Monitoring

```typescript
// Create custom diagnostic service with specific configuration
const customDiagnostic = new DiagnosticService(binanceClient, priceMonitor);

// Custom anomaly detection
await customDiagnostic.recordAnomaly({
  type: 'custom',
  severity: 'medium',
  description: 'Custom business logic issue detected',
  metrics: { customMetric: 123 },
  impact: 'Business process affected',
  suggested_action: 'Review custom logic implementation',
  auto_resolved: false
});
```

### Integration with External Monitoring

```typescript
// Export metrics to external monitoring systems
const metrics = await diagnosticSystem.getDiagnosticService().performDiagnostic();

// Send to external service (Prometheus, DataDog, etc.)
await sendToExternalMonitoring({
  timestamp: metrics.timestamp,
  systemHealth: metrics.system,
  apiHealth: metrics.binanceApi,
  alertHealth: metrics.alertSystem
});
```

### Custom Validation Rules

```typescript
// Custom price accuracy validation
const customValidator = new DataAccuracyValidator(binanceClient, {
  deviationThreshold: 0.1,  // Stricter threshold
  symbols: ['BTCUSDT'],     // Specific symbols
});

// Run custom validation
const result = await customValidator.validateSymbols(['BTCUSDT']);
console.log('Custom validation result:', result);
```

## API Reference

See the TypeScript interfaces and classes in the source code for detailed API documentation:

- `DiagnosticService`: Core diagnostic functionality
- `PriceQueryMonitor`: API monitoring wrapper
- `AlertSystemMonitor`: Alert system monitoring
- `DataAccuracyValidator`: Price accuracy validation
- `DiagnosticCommands`: CLI command implementations

## Contributing

When adding new monitoring capabilities:

1. Follow the existing pattern of non-intrusive monitoring
2. Add appropriate diagnostic logging
3. Include relevant metrics in system reports
4. Add CLI commands for new functionality
5. Update documentation with examples

## Support

For issues with the diagnostic system:

1. Check the diagnostic logs in `logs/diagnostic-*.log`
2. Run `npm run diagnostic health` for quick status
3. Generate a comprehensive report with `npm run diagnostic report`
4. Review the troubleshooting section above