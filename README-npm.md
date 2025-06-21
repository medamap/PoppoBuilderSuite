# PoppoBuilder 🚂

AI-powered autonomous GitHub issue processor using Claude API. Automatically processes issues, creates implementations, and manages your development workflow.

[![npm version](https://badge.fury.io/js/poppobuilder.svg)](https://www.npmjs.com/package/poppobuilder)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## ✨ Features

- 🤖 **AI-Powered Issue Processing** - Automatically processes GitHub issues using Claude API
- 🔄 **Continuous Integration** - Monitors and responds to issue updates and comments
- 🌍 **Multi-language Support** - Built-in support for Japanese and English
- 🚀 **Easy Setup** - Simple CLI commands to get started in minutes
- 🛡️ **Robust Error Handling** - Automatic retry and error recovery
- 📊 **Real-time Monitoring** - Built-in dashboard for tracking progress
- 🧩 **Extensible Architecture** - Plugin system for custom agents

## 🚀 Quick Start

### Installation

```bash
# Global installation
npm install -g poppobuilder

# Or as a dev dependency
npm install --save-dev poppobuilder
```

### Initialize Your Project

```bash
cd your-github-project
poppobuilder init
```

This will create a `.poppobuilder/` directory with your configuration.

### Configuration

Set up your environment variables:

```bash
export GITHUB_TOKEN=your_github_token
export CLAUDE_API_KEY=your_claude_api_key
```

Or add them to `.poppobuilder/.env.local`:

```
GITHUB_TOKEN=your_github_token
CLAUDE_API_KEY=your_claude_api_key
```

### Start Processing

```bash
# Start PoppoBuilder
poppobuilder start

# Run as a daemon
poppobuilder start --daemon

# Check status
poppobuilder status
```

## 📖 How It Works

1. **Label Your Issues** - Add labels like `task:misc`, `task:feature`, or `task:bug` to your GitHub issues
2. **PoppoBuilder Monitors** - The system continuously monitors for labeled issues
3. **AI Processing** - Claude API analyzes the issue and generates appropriate code/responses
4. **Automatic Updates** - Results are posted back to the issue as comments
5. **Interactive Dialogue** - Continue the conversation by adding comments

### Example Issue

```markdown
Title: Add user authentication

Labels: task:feature

Description:
Implement JWT-based authentication with the following requirements:
- User registration with email/password
- Login endpoint returning JWT token
- Protected routes middleware
- Password reset functionality
```

PoppoBuilder will automatically:
1. Analyze the requirements
2. Generate implementation code
3. Create necessary files
4. Post the results back to the issue

## 🛠️ Commands

### Basic Commands

```bash
poppobuilder --help              # Show help
poppobuilder --version           # Show version
poppobuilder init               # Initialize project
poppobuilder start              # Start processing
poppobuilder stop               # Stop processing
poppobuilder status             # Show status
poppobuilder logs               # View logs
```

### Advanced Commands

```bash
poppobuilder config --list      # List configuration
poppobuilder config --edit      # Edit configuration
poppobuilder doctor             # Diagnose issues
poppobuilder upgrade            # Upgrade to latest version
```

## ⚙️ Configuration

Configuration file: `.poppobuilder/config.json`

```json
{
  "project": {
    "name": "my-project"
  },
  "language": {
    "primary": "en",
    "fallback": "ja"
  },
  "github": {
    "owner": "your-username",
    "repo": "your-repo"
  },
  "claude": {
    "maxConcurrent": 5,
    "timeout": 300000
  },
  "tasks": {
    "labels": ["task:misc", "task:feature", "task:bug"],
    "priorityLabels": {
      "high": ["priority:high", "urgent"],
      "medium": ["priority:medium"],
      "low": ["priority:low"]
    }
  }
}
```

## 🔌 Advanced Features

### AI Agents

Enable specialized AI agents for enhanced functionality:

```bash
poppobuilder start --agents
```

Available agents:
- **CCLA** - Error log collection and auto-fix
- **CCAG** - Documentation generation
- **CCPM** - Code review and refactoring
- **CCQA** - Quality assurance and testing
- **CCRA** - Automated code reviews

### Custom Labels

Configure custom labels in your `config.json`:

```json
{
  "tasks": {
    "labels": ["task:custom", "ai:process", "bot:handle"]
  }
}
```

### Monitoring Dashboard

Access the built-in monitoring dashboard:

```bash
# Default port: 3001
http://localhost:3001
```

## 🐛 Troubleshooting

### Common Issues

**Issue: PoppoBuilder not detecting issues**
- Ensure your issues have the correct labels
- Check GitHub token permissions
- Verify repository access

**Issue: Claude API errors**
- Verify your Claude API key
- Check rate limits
- Ensure network connectivity

### Debug Mode

Run with verbose logging:

```bash
poppobuilder start --verbose
```

### Health Check

```bash
poppobuilder doctor
```

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guide](https://github.com/medamap/PoppoBuilderSuite/blob/main/CONTRIBUTING.md) for details.

### Development Setup

```bash
# Clone the repository
git clone https://github.com/medamap/PoppoBuilderSuite.git
cd PoppoBuilderSuite

# Install dependencies
npm install

# Run tests
npm test

# Start development
npm run dev
```

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built with [Claude API](https://www.anthropic.com/api) by Anthropic
- GitHub integration powered by [Octokit](https://github.com/octokit/octokit.js)
- Inspired by autonomous development workflows

## 📞 Support

- **Documentation**: [Full Documentation](https://github.com/medamap/PoppoBuilderSuite/wiki)
- **Issues**: [GitHub Issues](https://github.com/medamap/PoppoBuilderSuite/issues)
- **Discussions**: [GitHub Discussions](https://github.com/medamap/PoppoBuilderSuite/discussions)

---

Made with ❤️ by the PoppoBuilder community