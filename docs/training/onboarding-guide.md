# PoppoBuilder Suite - Team Onboarding Guide

## Welcome to PoppoBuilder Suite! 🚀

This guide will help you get started with PoppoBuilder Suite, understand the system architecture, and become productive quickly.

## Table of Contents
1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Development Environment Setup](#development-environment-setup)
4. [System Architecture](#system-architecture)
5. [Core Concepts](#core-concepts)
6. [Development Workflow](#development-workflow)
7. [Testing](#testing)
8. [Deployment](#deployment)
9. [Troubleshooting](#troubleshooting)
10. [Resources](#resources)

## Overview

PoppoBuilder Suite is an AI-powered automation system that manages GitHub issues and tasks across multiple projects. It uses Claude AI for intelligent task processing and provides a comprehensive dashboard for monitoring and management.

### What does PoppoBuilder do?
- **Automated Issue Processing**: Intelligently processes GitHub issues
- **Task Management**: Manages complex task workflows
- **Multi-project Support**: Handles multiple GitHub repositories
- **Real-time Monitoring**: Provides live system monitoring
- **Security & Compliance**: Enterprise-grade security features

### Key Technologies
- **Backend**: Node.js, Express.js
- **Database**: PostgreSQL, Redis
- **AI Integration**: Claude API, GitHub API
- **Monitoring**: Prometheus, Grafana
- **Containerization**: Docker, Docker Compose
- **Orchestration**: Kubernetes (production)

## Prerequisites

Before you start, make sure you have:

### Required Software
- [ ] **Node.js** (v18 or higher)
- [ ] **npm** (v8 or higher)
- [ ] **Docker** and **Docker Compose**
- [ ] **Git**
- [ ] **VS Code** (recommended) or your preferred IDE

### Accounts & Access
- [ ] GitHub account with appropriate repository access
- [ ] Claude API key (Anthropic)
- [ ] Access to internal documentation systems
- [ ] VPN access (if required)

### Knowledge Requirements
- Basic understanding of JavaScript/Node.js
- Familiarity with Git and GitHub
- Basic understanding of Docker
- Knowledge of REST APIs
- Understanding of async/await patterns

## Development Environment Setup

### 1. Clone the Repository
```bash
git clone https://github.com/your-org/PoppoBuilderSuite.git
cd PoppoBuilderSuite
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Environment Configuration
```bash
# Copy environment template
cp .env.example .env

# Edit the .env file with your credentials
nano .env
```

Required environment variables:
```bash
# GitHub Integration
GITHUB_TOKEN=your_github_token_here

# Claude AI Integration
CLAUDE_API_KEY=your_claude_api_key_here

# Database Configuration
DATABASE_URL=postgresql://user:password@localhost:5432/poppobuilder
REDIS_URL=redis://localhost:6379

# Application Configuration
NODE_ENV=development
POPPO_PORT=3000
POPPO_LOG_LEVEL=debug
```

### 4. Start Development Services
```bash
# Start dependencies (PostgreSQL, Redis)
docker-compose up -d postgres redis

# Start the application
npm run dev
```

### 5. Verify Setup
```bash
# Check health endpoint
curl http://localhost:3000/health

# Check dashboard
open http://localhost:3001
```

## System Architecture

### High-Level Architecture
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   GitHub API    │────│  PoppoBuilder   │────│   Claude API    │
│                 │    │     Core        │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │
                       ┌────────┴────────┐
                       │                 │
              ┌─────────────────┐ ┌─────────────────┐
              │   PostgreSQL    │ │     Redis       │
              │   (Database)    │ │    (Cache)      │
              └─────────────────┘ └─────────────────┘
```

### Core Components

#### 1. Main Application (`src/minimal-poppo.js`)
- Entry point for the application
- Orchestrates all other components
- Handles issue processing lifecycle

#### 2. Daemon Architecture (`bin/poppo-daemon.js`)
- Production-ready daemon process
- Process management and monitoring
- Centralized project management

#### 3. Independent Process Manager (`src/independent-process-manager.js`)
- Manages concurrent task execution
- Resource allocation and monitoring
- Process isolation and recovery

#### 4. Agent System (`agents/`)
- **CCLA**: Error log collection and analysis
- **CCAG**: Documentation generation
- **CCPM**: Code review and refactoring
- **CCQA**: Quality assurance and testing
- **CCRA**: Automated code review
- **CCSP**: Claude Code integration

#### 5. Dashboard (`dashboard/`)
- Web-based monitoring interface
- Real-time metrics and logs
- Process control and management

#### 6. State Management (`src/status-manager.js`)
- JSON-based state persistence
- Issue status tracking
- Distributed state synchronization

## Core Concepts

### 1. Issue Processing Lifecycle
```
New Issue → Status Check → Processing → Claude Analysis → Action Execution → Completion
```

1. **Issue Detection**: GitHub webhook or polling detects new issues
2. **Status Check**: Verify issue hasn't been processed
3. **Processing**: Extract issue content and context
4. **AI Analysis**: Send to Claude for intelligent analysis
5. **Action Execution**: Execute recommended actions
6. **Completion**: Update issue status and log results

### 2. Task Types and Labels
Issues are categorized by labels:
- `task:dogfooding` - High priority dogfooding tasks
- `task:bug` - Bug fixes
- `task:feature` - New feature development
- `task:docs` - Documentation updates
- `task:quality` - Quality assurance tasks

### 3. Agent Coordination
Agents work together to provide comprehensive automation:
- **Primary agents** handle main task execution
- **Supporting agents** provide specialized services
- **Coordination layer** manages agent interactions

### 4. State Management
```json
{
  "issueNumber": 123,
  "status": "processing",
  "assignedAgent": "CCPM",
  "startTime": "2023-12-01T10:00:00Z",
  "progress": {
    "stage": "analysis",
    "completion": 0.6
  }
}
```

## Development Workflow

### 1. Feature Development

#### Planning Phase
1. Review requirements and create/update issues
2. Design solution architecture
3. Plan implementation steps
4. Estimate effort and timeline

#### Implementation Phase
```bash
# Create feature branch
git checkout -b feature/new-feature-name

# Implement feature
# ... development work ...

# Run tests
npm test

# Run linting
npm run lint

# Commit changes
git add .
git commit -m "feat: implement new feature

- Add new functionality
- Update documentation
- Add tests

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

#### Code Review Process
1. Create pull request
2. Automated tests run (CI/CD)
3. Code review by team members
4. Address feedback and make changes
5. Merge to main branch

### 2. Bug Fix Workflow
```bash
# Create bug fix branch
git checkout -b bugfix/issue-description

# Reproduce the bug
# Write test to verify fix
# Implement fix
# Verify fix resolves issue

# Test thoroughly
npm test
npm run test:integration

# Submit for review
```

### 3. Agent Development
When developing new agents:

1. **Create agent directory**: `agents/new-agent/`
2. **Implement agent class**: Extend `AgentBase`
3. **Add configuration**: Update agent coordinator
4. **Write tests**: Comprehensive test coverage
5. **Update documentation**: Document agent capabilities

Example agent structure:
```javascript
const AgentBase = require('../shared/agent-base');

class NewAgent extends AgentBase {
  constructor(options = {}) {
    super('NewAgent', options);
  }

  async processTask(task) {
    // Implementation here
    return result;
  }
}

module.exports = NewAgent;
```

## Testing

### Test Categories

#### 1. Unit Tests
```bash
# Run all unit tests
npm test

# Run specific test file
npm test test/agent-base.test.js

# Run tests with coverage
npm run test:coverage
```

#### 2. Integration Tests
```bash
# Run integration tests
npm run test:integration

# Test specific component
npm run test:integration -- --grep "Agent coordination"
```

#### 3. End-to-End Tests
```bash
# Run E2E tests
npm run test:e2e

# Run specific scenario
npm run test:e2e:grep "Issue processing"
```

#### 4. Performance Tests
```bash
# Run performance benchmarks
npm run test:performance

# Quick performance test
npm run test:performance:quick
```

### Writing Tests

#### Unit Test Example
```javascript
const { expect } = require('chai');
const AgentBase = require('../src/agents/shared/agent-base');

describe('AgentBase', () => {
  let agent;

  beforeEach(() => {
    agent = new AgentBase('TestAgent');
  });

  it('should initialize with correct name', () => {
    expect(agent.name).to.equal('TestAgent');
  });

  it('should process tasks', async () => {
    const task = { type: 'test', data: {} };
    const result = await agent.processTask(task);
    expect(result).to.exist;
  });
});
```

#### Integration Test Example
```javascript
describe('Issue Processing Integration', () => {
  it('should process issue end-to-end', async () => {
    // Create test issue
    const issue = await createTestIssue();
    
    // Process issue
    const result = await processIssue(issue);
    
    // Verify results
    expect(result.status).to.equal('completed');
    expect(result.actions).to.have.length.greaterThan(0);
  });
});
```

### Test Best Practices
- Write tests before implementing features (TDD)
- Use descriptive test names
- Test both success and error cases
- Mock external dependencies
- Keep tests isolated and independent

## Deployment

### Development Deployment
```bash
# Start all services locally
npm run dev

# Start with debugging
npm run dev:debug

# Start in watch mode
npm run dev:watch
```

### Staging Deployment
```bash
# Deploy to staging
npm run deploy:staging

# Run smoke tests
npm run test:smoke:staging
```

### Production Deployment
```bash
# Build production assets
npm run build

# Deploy using Docker
docker-compose -f docker-compose.prod.yml up -d

# Verify deployment
./scripts/health-check.sh
```

### Environment-Specific Configurations
- **Development**: Debug logging, hot reload, mock services
- **Staging**: Production-like setup, test data
- **Production**: Optimized performance, real data, monitoring

## Troubleshooting

### Common Issues

#### 1. Application Won't Start
```bash
# Check Node.js version
node --version  # Should be v18+

# Check dependencies
npm list --depth=0

# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm install
```

#### 2. Database Connection Issues
```bash
# Check database status
docker-compose ps postgres

# Check connection
psql $DATABASE_URL -c "SELECT 1;"

# Reset database
npm run db:reset
```

#### 3. API Rate Limits
```bash
# Check GitHub rate limit
curl -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/rate_limit

# Check Claude API usage
# (Monitor through dashboard)
```

#### 4. Agent Processing Issues
```bash
# Check agent status
curl http://localhost:3000/api/agents/status

# View agent logs
npm run logs:agents

# Restart specific agent
npm run agent:restart CCLA
```

### Debugging Tips

#### Enable Debug Logging
```bash
# Set debug environment
export DEBUG=*
npm run dev

# Debug specific component
export DEBUG=Agent:*
npm run dev
```

#### Monitor System Resources
```bash
# Check CPU and memory
htop

# Check disk space
df -h

# Check network connections
netstat -an | grep :3000
```

#### Database Queries
```sql
-- Check recent issues
SELECT * FROM issues ORDER BY created_at DESC LIMIT 10;

-- Check agent performance
SELECT agent_name, COUNT(*), AVG(duration_ms) 
FROM task_executions 
GROUP BY agent_name;
```

## Resources

### Documentation
- [Architecture Overview](../architecture/system-overview.md)
- [API Documentation](../api/README.md)
- [Agent Development Guide](../agents/development-guide.md)
- [Database Schema](../database/schema.md)
- [Security Guide](../security/security-guide.md)

### Tools and Utilities
- **Health Check**: `curl http://localhost:3000/health`
- **Metrics**: `curl http://localhost:3000/metrics`
- **Dashboard**: http://localhost:3001
- **Database Admin**: pgAdmin or similar
- **Log Viewer**: Built-in dashboard or `tail -f logs/*.log`

### Development Tools
- **VS Code Extensions**:
  - ESLint
  - Prettier
  - GitLens
  - Docker
  - REST Client

### Communication Channels
- **Team Chat**: #poppobuilder-dev
- **Alerts**: #poppobuilder-alerts
- **General**: #poppobuilder
- **Documentation**: Internal wiki

### Learning Resources
- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices)
- [GitHub API Documentation](https://docs.github.com/en/rest)
- [Claude API Documentation](https://docs.anthropic.com/)
- [Docker Documentation](https://docs.docker.com/)
- [Prometheus Documentation](https://prometheus.io/docs/)

## Next Steps

After completing this guide, you should:

1. **Complete a small task** - Pick up a beginner-friendly issue
2. **Review codebase** - Familiarize yourself with the code structure
3. **Join team meetings** - Participate in standups and planning
4. **Set up development workflow** - Configure your IDE and tools
5. **Read additional documentation** - Dive deeper into specific areas

### Suggested First Tasks
- Fix a documentation typo
- Add a simple utility function
- Write a unit test for existing code
- Improve logging in a component
- Add a new health check endpoint

### Questions?
Don't hesitate to ask questions! The team is here to help:
- Ask in #poppobuilder-dev for technical questions
- Schedule 1:1 with team lead for guidance
- Create issues for documentation improvements
- Suggest improvements to this onboarding guide

Welcome to the team! 🎉

---

*This guide is continuously updated based on feedback. Please contribute improvements and suggestions.*