---
name: user-alerts
description: Real-time price and trading alerts system for crypto monitoring via Telegram
status: backlog
created: 2025-09-08T09:14:07Z
---

# PRD: User-Alerts

## Executive Summary

The User-Alerts system enables users to set up personalized notifications for cryptocurrency price movements, funding rates, and trading signals. Instead of manually checking prices, users receive real-time Telegram alerts when their specified conditions are met, allowing for timely trading decisions and market monitoring.

## Problem Statement

**Current Pain Points:**
- Users must manually query prices using `/price` commands
- No way to monitor markets 24/7 without constant manual checking
- Missing trading opportunities due to lack of real-time notifications
- No systematic way to track multiple price levels or trading signals

**Why Now:**
- Bot already has reliable Binance data integration
- Users are actively using price query features (indicating demand)
- Alert systems are fundamental for any serious crypto monitoring tool
- Foundation exists (DB, Telegram, API) - just need alert logic layer

## User Stories

### Primary Personas

**Active Day Trader (Alex)**
- Needs: Real-time price alerts for entry/exit points
- Behavior: Sets multiple price alerts across different timeframes
- Pain: Missing quick market movements while away from charts

**Long-term Investor (Bob)**
- Needs: Major price movement notifications
- Behavior: Sets wide price ranges, wants to know about significant changes
- Pain: FOMO on major dips or breakouts

**Arbitrage Trader (Carol)**
- Needs: Funding rate and OI alerts for arbitrage opportunities
- Behavior: Monitors negative funding rates and OI imbalances
- Pain: Manual checking of funding rates across many pairs

### Detailed User Journeys

**Journey 1: Setting Price Alert**
1. User types `/alert btc > 50000`
2. System validates input and confirms alert creation
3. System monitors BTC price in background
4. When BTC exceeds $50,000, user receives immediate notification
5. Alert expires or user manually removes it

**Journey 2: Managing Multiple Alerts**
1. User types `/alerts` to view all active alerts
2. System shows formatted list with IDs, conditions, and status
3. User can remove specific alerts with `/remove_alert 5`
4. User can modify alerts with `/modify_alert 5 btc > 55000`

**Journey 3: Advanced Alert Types**
1. User sets percentage change alert: `/alert eth -5%` (5% drop)
2. User sets funding rate alert: `/alert funding < -0.1%`
3. User sets OI alert: `/alert oi sol +20%`

## Requirements

### Functional Requirements

**Core Alert Types:**
1. **Price Threshold Alerts**
   - Support `>`, `<`, `>=`, `<=` operators
   - Multiple currency symbols (BTC, ETH, SOL, etc.)
   - Both absolute ($50000) and percentage (±5%) values

2. **Alert Management**
   - Create: `/alert SYMBOL OPERATOR VALUE`
   - List: `/alerts` 
   - Remove: `/remove_alert ID`
   - Modify: `/modify_alert ID NEW_CONDITION`

3. **Alert Delivery**
   - Instant Telegram notifications
   - Rich formatting with current price, change, and timestamp
   - Risk icons for blacklist/yellowlist tokens

4. **Advanced Features**
   - Funding rate alerts: `/alert funding SYMBOL < VALUE`
   - OI change alerts: `/alert oi SYMBOL > PERCENTAGE`
   - Time-based alerts: Alert only during specific hours

**User Experience:**
- Natural language parsing: "Alert me when BTC goes above 50k"
- Confirmation messages for all actions
- Error handling with helpful suggestions
- Alert history/log for debugging

### Non-Functional Requirements

**Performance:**
- Alert checking frequency: Every 30 seconds for price, 5 minutes for funding/OI
- Support up to 50 alerts per user
- Response time <2 seconds for alert management commands
- Background monitoring with minimal API usage

**Reliability:**
- 99.5% uptime for alert monitoring
- Alert persistence survives bot restarts
- Duplicate alert detection and prevention
- Graceful handling of API failures

**Security:**
- Alert access restricted to alert creator
- Rate limiting: Max 10 new alerts per hour per user
- Input validation to prevent malicious conditions
- No sensitive data exposure in alert notifications

**Scalability:**
- Database design supports multiple users (future)
- Efficient batch processing of alerts
- Memory usage optimization for large alert sets

## Success Criteria

**Primary Metrics:**
- Alert accuracy: >99% of triggered alerts are correct
- Alert latency: <60 seconds from condition met to notification
- User engagement: 70% of users who create alerts continue using them after 1 week

**Secondary Metrics:**
- Average alerts per active user: 5-10
- Alert conversion rate: 80% of created alerts eventually trigger
- User retention: Alert users are 3x more likely to remain active

**User Feedback Indicators:**
- Positive feedback on alert timing and accuracy
- Requests for additional alert types
- Low false positive complaints (<5%)

## Constraints & Assumptions

**Technical Constraints:**
- Must work within existing bot architecture
- Limited to Binance API data sources
- Single authorized user for current version
- SQLite database storage limitations

**Resource Constraints:**
- Development time: 2-3 days for MVP (90% infrastructure exists)
- API rate limits: Existing BinanceClient already handles limits
- Memory usage: Minimal additional usage (reusing existing monitoring)

**Business Constraints:**
- Feature must not require external services initially
- No premium features for MVP
- Maintain backward compatibility with existing commands

**Assumptions:**
- User is familiar with basic trading terminology
- Telegram remains the primary interface
- Binance API reliability continues
- Single-user bot deployment model

## Out of Scope (MVP)

**Features NOT included in first version:**
- Multi-user support and user authentication
- Alert sharing between users  
- Complex conditional alerts (e.g., "BTC > 50k AND volume > 1M")
- Historical alert performance analytics
- SMS or email notifications (Telegram only)
- Voice/audio alerts
- Alert templates or presets
- Portfolio-based alerts (track total portfolio value)
- News-based or sentiment alerts
- Machine learning alert recommendations

**Future Considerations:**
- Mobile app integration
- Web dashboard for alert management
- Alert collaboration features
- Premium alert types (technical indicators)

## Dependencies

**Internal Dependencies:**
- Database service (SQLite → PostgreSQL future migration)
- Existing Binance API client and rate limiting
- Current Telegram bot infrastructure
- Risk classification system integration

**External Dependencies:**
- Binance API uptime and reliability
- Telegram Bot API service availability
- Server hosting stability for 24/7 monitoring

**Data Dependencies:**
- Real-time price data from Binance
- Funding rate data availability
- Open Interest historical data for change calculations

## Implementation Phases

**REVISED PLAN - Leveraging Existing Infrastructure**

**Phase 1 - Core Integration (Day 1, 4 hours)**
- Add alert commands to existing bot.ts (`/alert`, `/alerts`, `/remove_alert`)
- Connect existing PriceMonitorService to Telegram notifications
- Basic input validation using existing patterns

**Phase 2 - Enhanced UX (Day 2, 3 hours)**
- Rich notification formatting with risk icons
- Error handling and user feedback improvements
- Alert status and management features

**Phase 3 - Testing & Polish (Day 3, 2 hours)**
- Integration testing with existing database
- Performance validation of existing monitoring service
- Documentation updates

**EXISTING INFRASTRUCTURE TO LEVERAGE:**
- ✅ Complete SQLite database with price_alerts table
- ✅ PriceAlert model with CRUD operations  
- ✅ PriceMonitorService with real-time monitoring
- ✅ BinanceClient with all necessary APIs
- ✅ Telegram bot framework and command patterns

## Risk Assessment

**High Risk:**
- API rate limiting causing missed alerts
- Database corruption losing user alerts
- Background monitoring process failures

**Medium Risk:**
- False positive alerts due to price spikes
- User confusion with alert syntax
- Memory leaks in monitoring loops

**Low Risk:**
- Telegram delivery failures (handles retries)
- Minor UI/UX issues
- Non-critical feature requests

**Mitigation Strategies:**
- Robust error handling and logging
- Database backups and recovery procedures
- Comprehensive testing of edge cases
- User education and clear documentation