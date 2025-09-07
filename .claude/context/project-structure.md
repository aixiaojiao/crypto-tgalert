---
created: 2025-09-07T10:28:29Z
last_updated: 2025-09-07T10:28:29Z
version: 1.0
author: Claude Code PM System
---

# Project Structure

## Current Directory Structure

```
crypto-tgalert/
├── .claude/                    # CCPM system files
│   ├── CLAUDE.md              # System configuration template
│   ├── agents/                # Task-oriented agents
│   ├── commands/              # Command definitions
│   │   ├── context/           # Context management commands
│   │   ├── pm/                # Project management commands
│   │   └── testing/           # Testing commands
│   ├── context/               # Project context files (current directory)
│   ├── epics/                 # Epic workspace (local, gitignored)
│   ├── prds/                  # Product Requirements Documents
│   ├── rules/                 # Rule files
│   ├── scripts/               # Utility scripts
│   └── settings.local.json    # Local settings
├── .git/                      # Git repository data
└── CLAUDE.md                  # Project-specific Claude Code rules
```

## Planned Project Structure

Based on the crypto-tgalert project name, the following structure is anticipated:

```
crypto-tgalert/
├── src/                       # Source code
│   ├── bot/                   # Telegram bot implementation
│   ├── alerts/                # Alert system logic
│   ├── crypto/                # Cryptocurrency data handling
│   ├── config/                # Configuration management
│   └── utils/                 # Utility functions
├── tests/                     # Test files
├── docs/                      # Documentation
├── config/                    # Configuration files
├── scripts/                   # Build and deployment scripts
└── README.md                  # Project documentation
```

## File Organization Patterns

### Naming Conventions
- **Files:** lowercase with hyphens (kebab-case)
- **Directories:** lowercase with hyphens
- **Configuration:** Standard names (package.json, requirements.txt, etc.)

### Module Organization
- Modular approach with clear separation of concerns
- Each feature in its own directory/module
- Shared utilities in common utils directory
- Configuration centralized in config directory

## Key Integration Points

### CCPM Integration
- `.claude/` directory contains project management system
- Commands available via `/pm:*` and `/context:*` format
- Epic and task tracking through GitHub issues

### Development Workflow
- Context files maintain project state
- Sub-agents handle specialized tasks
- Automated progress tracking and updates

## Future Expansion Areas
- API integrations for cryptocurrency data
- Database layer for alert storage
- User management system
- Dashboard/web interface