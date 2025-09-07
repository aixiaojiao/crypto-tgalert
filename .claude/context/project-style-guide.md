---
created: 2025-09-07T10:28:29Z
last_updated: 2025-09-07T10:28:29Z
version: 1.0
author: Claude Code PM System
---

# Project Style Guide

## Code Standards and Conventions

### General Principles

#### Clean Code Practices
- **Readability First:** Code should be self-documenting and clear
- **Single Responsibility:** Each function/class should have one clear purpose
- **DRY Principle:** Don't Repeat Yourself - reuse common functionality
- **KISS Principle:** Keep It Simple, Stupid - avoid unnecessary complexity

#### Error Handling Philosophy
- **Fail Fast:** Detect and report errors as early as possible
- **Graceful Degradation:** System continues operating with reduced functionality
- **User-Friendly Messages:** Error messages should be actionable for users
- **Comprehensive Logging:** All errors logged with sufficient context

### Naming Conventions

#### File and Directory Names
- **Files:** lowercase with hyphens (kebab-case)
  - Examples: `price-alert.js`, `user-manager.py`, `crypto-data.rs`
- **Directories:** lowercase with hyphens
  - Examples: `src/`, `alert-engine/`, `telegram-bot/`, `test-utils/`
- **Configuration Files:** Standard naming conventions
  - Examples: `package.json`, `requirements.txt`, `Cargo.toml`, `.env`

#### Code Naming (Language-Specific)

##### JavaScript/TypeScript
- **Variables:** camelCase (`userId`, `priceAlert`, `marketData`)
- **Functions:** camelCase (`calculatePercentage`, `sendNotification`)
- **Classes:** PascalCase (`AlertManager`, `TelegramBot`, `PriceMonitor`)
- **Constants:** UPPER_SNAKE_CASE (`MAX_ALERTS_PER_USER`, `DEFAULT_TIMEOUT`)
- **Files:** kebab-case (`alert-manager.js`, `telegram-client.ts`)

##### Python
- **Variables:** snake_case (`user_id`, `price_alert`, `market_data`)
- **Functions:** snake_case (`calculate_percentage`, `send_notification`)
- **Classes:** PascalCase (`AlertManager`, `TelegramBot`, `PriceMonitor`)
- **Constants:** UPPER_SNAKE_CASE (`MAX_ALERTS_PER_USER`, `DEFAULT_TIMEOUT`)
- **Modules:** snake_case (`alert_manager.py`, `telegram_client.py`)

### Code Organization

#### Directory Structure Patterns
```
src/
├── core/                   # Core business logic
│   ├── alert-engine/      # Alert processing logic
│   ├── data-sources/      # Market data integration
│   └── user-management/   # User account handling
├── integrations/          # External service integrations
│   ├── telegram/          # Telegram bot implementation
│   └── crypto-apis/       # Cryptocurrency API clients
├── utils/                 # Shared utility functions
├── config/                # Configuration management
└── types/                 # Type definitions (TypeScript) or models
```

#### Module Organization
- **Single Purpose Modules:** Each module handles one specific functionality
- **Clear Interfaces:** Well-defined public APIs with minimal surface area
- **Dependency Management:** Avoid circular dependencies, use dependency injection
- **Configuration Isolation:** Environment-specific config separate from code

### Documentation Standards

#### Code Comments
```javascript
/**
 * Calculates percentage change between two prices
 * @param {number} oldPrice - The original price
 * @param {number} newPrice - The new price
 * @returns {number} Percentage change (-100 to +∞)
 * @throws {Error} When prices are invalid or negative
 */
function calculatePercentageChange(oldPrice, newPrice) {
    // Implementation here
}
```

#### Inline Comments
- **Explain Why, Not What:** Focus on business logic and reasoning
- **Complex Algorithms:** Document algorithm choices and trade-offs
- **Workarounds:** Explain temporary solutions and their planned resolution
- **External Dependencies:** Document API limitations and assumptions

#### README Structure
```markdown
# Component Name

## Purpose
Brief description of what this component does

## Usage
Code examples showing how to use the component

## Configuration
Required environment variables and settings

## Dependencies
External services and libraries required

## Testing
How to run tests and verify functionality
```

### Testing Conventions

#### Test Organization
```
tests/
├── unit/              # Unit tests for individual components
├── integration/       # Integration tests for component interaction
├── e2e/              # End-to-end tests for complete user flows
└── fixtures/         # Test data and mock configurations
```

#### Test Naming
- **Descriptive Names:** Test names should describe the scenario
- **Given-When-Then:** Structure test descriptions clearly
- **Edge Cases:** Include tests for boundary conditions and error states

#### Test Structure
```javascript
describe('AlertEngine', () => {
    describe('when processing price alerts', () => {
        it('should trigger alert when price exceeds threshold', () => {
            // Given: price alert set at $50,000
            // When: price reaches $50,001
            // Then: alert should be triggered
        });
    });
});
```

### Configuration Management

#### Environment Variables
- **Naming:** UPPER_SNAKE_CASE with prefixes
  - `CRYPTO_ALERT_DB_URL`
  - `CRYPTO_ALERT_TELEGRAM_TOKEN`
  - `CRYPTO_ALERT_API_KEY`
- **Documentation:** All environment variables documented in README
- **Defaults:** Sensible defaults for development environment
- **Validation:** Environment variables validated on startup

#### Configuration Files
- **Development:** `.env.development`
- **Testing:** `.env.test`
- **Production:** `.env.production`
- **Example:** `.env.example` with dummy values

### API Design Standards

#### REST API Conventions
- **Resource Names:** Plural nouns (`/alerts`, `/users`, `/portfolios`)
- **HTTP Methods:** Standard semantics (GET, POST, PUT, DELETE)
- **Status Codes:** Appropriate HTTP status codes
- **Response Format:** Consistent JSON structure

#### Error Response Format
```json
{
  "error": {
    "code": "INVALID_ALERT_THRESHOLD",
    "message": "Alert threshold must be a positive number",
    "details": {
      "field": "threshold",
      "value": -100,
      "constraint": "must be > 0"
    }
  }
}
```

### Version Control Standards

#### Commit Message Format
```
type(scope): brief description

More detailed explanation if needed

- List any breaking changes
- Reference any issues: #123
```

#### Commit Types
- **feat:** New feature
- **fix:** Bug fix
- **docs:** Documentation changes
- **style:** Code style changes (formatting, etc.)
- **refactor:** Code refactoring
- **test:** Adding or modifying tests
- **chore:** Maintenance tasks

#### Branch Naming
- **Feature branches:** `feature/alert-volume-spike`
- **Bug fixes:** `fix/telegram-rate-limiting`
- **Hotfixes:** `hotfix/critical-security-patch`
- **Releases:** `release/v1.2.0`

### Performance Guidelines

#### Code Performance
- **Avoid Premature Optimization:** Measure before optimizing
- **Database Queries:** Minimize N+1 queries, use appropriate indexing
- **Caching Strategy:** Cache frequently accessed data appropriately
- **Memory Management:** Prevent memory leaks, clean up resources

#### Alert Performance Requirements
- **Response Time:** Bot commands respond within 2 seconds
- **Alert Latency:** Market alerts delivered within 5 seconds
- **Throughput:** Handle 1000+ concurrent users
- **Reliability:** 99.9% uptime target

## CCPM Integration Standards

### Task Documentation
- **Clear Descriptions:** Tasks should have unambiguous descriptions
- **Acceptance Criteria:** Specific, measurable completion criteria
- **Dependencies:** Document task relationships and blockers
- **Effort Estimates:** Realistic time estimates for planning

### Agent Coordination
- **Specialized Agents:** Use appropriate agents for specific tasks
- **Context Preservation:** Maintain task context across agent handoffs
- **Progress Updates:** Regular status updates to GitHub issues
- **Completion Verification:** Validate task completion before marking done

### GitHub Integration
- **Issue Labels:** Use consistent labeling system
- **Issue Templates:** Standardized templates for different issue types
- **PR Reviews:** Code review checklist and approval process
- **Documentation Updates:** Keep documentation current with code changes