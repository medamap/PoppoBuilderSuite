# PoppoBuilder Suite

An AI-powered autonomous software development system that leverages Claude Code for intelligent project building and maintenance.

## 🎯 Overview

PoppoBuilder Suite is a self-hosting development automation system designed to:
- Minimize Claude Code context window usage through focused, single-session tasks
- Provide GitHub Actions-like CI/CD functionality without the associated costs
- Enable autonomous project development through multiple specialized AI agents
- Support self-improvement through dogfooding

## 🏗️ Architecture

```
User Interface Layer:
Claude Code → MCP Interface → CCGM (General Manager)
                    ↓
            Poppo Repository (State Management)
                    ↑
Automation Layer:
Resident CICD → Agent Orchestra:
  - CCPM (Project Manager) - Task planning and instruction generation
  - CCAG (Agent) - Implementation and PR creation
  - CCRA (Review Agent) - Code review
  - CCTA (Test Agent) - Testing and validation
  - CCMA (Merge Agent) - PR merging
```

## 📁 Project Structure

```
PoppoBuilderSuite/
├── cicd/               # Resident CI/CD system
│   ├── scheduler/      # Job scheduling and management
│   ├── executor/       # Job execution engine
│   └── monitor/        # Process monitoring
├── mcp-interface/      # MCP server interface
│   └── tools/          # MCP tool implementations
├── agents/             # AI agent implementations
│   ├── ccgm/          # General Manager
│   ├── ccpm/          # Project Manager
│   ├── ccag/          # Implementation Agent
│   ├── ccra/          # Review Agent
│   ├── ccta/          # Test Agent
│   └── ccma/          # Merge Agent
├── poppo-repo/        # Project state and configuration
│   ├── config/        # System configuration
│   ├── projects/      # Managed projects
│   └── status/        # Runtime status
└── docs/              # Documentation
```

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ 
- Claude Code CLI
- Git

### Installation
```bash
# Clone the repository
git clone https://github.com/medamap/PoppoBuilderSuite.git
cd PoppoBuilderSuite

# Install dependencies (once package.json is created)
npm install

# Initialize Poppo Repository
npm run init
```

### Basic Usage
```bash
# Start a new project
claude "Hey Poppo, create a new Express API project"

# Check status
claude "Poppo, what's the current status?"

# Manual trigger
claude "Poppo, run pending tasks"
```

## 🔄 Development Workflow

1. **Feature Development**
   ```bash
   git checkout develop
   git checkout -b feature/your-feature
   # Make changes
   git commit -m "feat: your feature"
   git push origin feature/your-feature
   ```

2. **Self-Hosting Development**
   - PoppoBuilder can work on its own codebase
   - Create issues for self-improvement
   - Let agents implement enhancements

## 🤖 Agent Roles

### CCGM (General Manager)
- User interaction interface
- Project configuration management  
- Status reporting and monitoring

### CCPM (Project Manager)
- Task breakdown and planning
- Instruction document generation
- Dependency management

### CCAG (Implementation Agent)
- Code implementation
- PR creation
- Documentation updates

### CCRA (Review Agent)
- Code quality checks
- Best practices enforcement
- Security review

### CCTA (Test Agent)
- Test execution
- Coverage reporting
- Performance validation

### CCMA (Merge Agent)
- PR merge decisions
- Conflict resolution
- Branch management

## 📈 Roadmap

### Phase 1: Foundation (Week 1)
- [ ] Basic CICD scheduler
- [ ] MCP interface setup
- [ ] CCPM and CCAG implementation

### Phase 2: Self-Hosting (Week 2)
- [ ] PoppoBuilder working on itself
- [ ] Basic automation loop
- [ ] Status management

### Phase 3: Full Automation (Week 3+)
- [ ] All agents operational
- [ ] Complete CI/CD pipeline
- [ ] Advanced features

## 🤝 Contributing

This project is designed to be self-improving! Create issues for enhancements and let PoppoBuilder implement them.

## 📄 License

MIT License - see LICENSE file for details