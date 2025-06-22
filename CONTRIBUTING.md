# Contributing to PoppoBuilder Suite

Thank you for your interest in contributing to PoppoBuilder Suite! This project is unique because it's self-improving - PoppoBuilder can implement features for itself through the dogfooding system.

## 🚀 Quick Start for Contributors

### The Dogfooding Approach (Recommended)

The easiest way to contribute is through PoppoBuilder's dogfooding functionality:

1. **Create a Feature Request Issue**
```bash
gh issue create \
  --title "New Feature: Your Feature Name" \
  --body "Detailed description of the feature you'd like to see" \
  --label "task:dogfooding" \
  --repo medamap/PoppoBuilderSuite
```

2. **Let PoppoBuilder Implement It**
PoppoBuilder will automatically:
- Analyze the feature request
- Implement the code
- Update documentation
- Run tests
- Update the project status

3. **Review and Provide Feedback**
- Check the implementation in the issue comments
- Provide feedback or ask for modifications
- Once satisfied, thank PoppoBuilder to mark it complete

### Traditional Contributing

If you prefer manual contribution:

1. **Fork the Repository**
2. **Create a Feature Branch**
3. **Make Your Changes**
4. **Submit a Pull Request**

## 🎯 What to Contribute

### High-Priority Areas
- **Agent Development**: New agents for specialized tasks
- **Internationalization**: New language support
- **Testing**: Additional test coverage
- **Documentation**: Improvements and examples
- **Error Handling**: New error scenarios and recovery

### Ideas for Dogfooding Issues
- "Add support for GitLab Issues"
- "Implement Slack notification integration"
- "Create a web dashboard for monitoring"
- "Add support for custom Claude models"
- "Implement automatic dependency updates"

## 📝 Issue Guidelines

### For Dogfooding Issues (`task:dogfooding`)

**Good Issue Example:**
```markdown
## Feature Request: Multi-Project Dashboard

### Description
Create a web dashboard that can monitor multiple PoppoBuilder instances across different projects.

### Requirements
- Display status of all configured projects
- Show recent issue processing activity
- Provide controls to start/stop instances
- Real-time updates via WebSockets

### Technical Considerations
- Use Express.js for the backend
- WebSocket support for real-time updates
- Responsive design for mobile access
- Authentication for security
```

**What Makes a Good Dogfooding Issue:**
- Clear, specific requirements
- Technical context when helpful
- Examples of similar features
- Acceptance criteria
- Consider edge cases

### For Bug Reports

```markdown
## Bug Report: Issue Title

### Description
Clear description of the problem

### Steps to Reproduce
1. Step one
2. Step two
3. Step three

### Expected Behavior
What should happen

### Actual Behavior
What actually happens

### Environment
- PoppoBuilder version: x.x.x
- Node.js version: x.x.x
- Operating system: xxx
- Claude CLI version: x.x.x
```

## 🛠️ Development Guidelines

### Code Style
- Use ES6+ features
- Follow existing code patterns
- Include JSDoc comments for functions
- Use meaningful variable names
- Keep functions focused and small

### Internationalization
- Use the i18n system for all user-facing messages
- Add translations for both English and Japanese
- Use appropriate error codes from the error catalog
- Follow the existing translation key patterns

### Error Handling
- Use PoppoError for all error scenarios
- Choose appropriate error codes from the catalog
- Include helpful context in error messages
- Implement recovery strategies where possible

### Testing
- Write tests for new features
- Use the existing test patterns
- Include both unit and integration tests
- Test i18n functionality

### Documentation
- Update relevant documentation
- Include examples in your documentation
- Use clear, concise language
- Consider both English and Japanese users

## 🔧 Development Setup

### Prerequisites
- Node.js 14 or higher
- Claude CLI configured
- GitHub CLI authenticated
- Git

### Setup Steps
```bash
# Fork and clone your fork
git clone https://github.com/your-username/PoppoBuilderSuite.git
cd PoppoBuilderSuite

# Install dependencies
npm install

# Run setup wizard
npm run setup:wizard

# Run tests to ensure everything works
npm test
```

### Running Tests
```bash
# All tests
npm test

# Specific test suites
npm run test:i18n          # I18n system tests
npm run test:errors        # Error system tests
npm run test:integration   # Integration tests

# Dependency check
npm run deps:check
```

## 📋 Pull Request Process

### Before Submitting
1. **Test your changes** - Run all tests
2. **Update documentation** - Add/update relevant docs
3. **Follow code style** - Consistent with existing code
4. **Add i18n support** - For user-facing features
5. **Include tests** - For new functionality

### PR Title Format
- `feat: Add new feature description`
- `fix: Fix bug description`
- `docs: Update documentation`
- `test: Add tests for X`
- `refactor: Refactor X component`

### PR Description Template
```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation update
- [ ] Performance improvement
- [ ] Refactoring

## Testing
- [ ] Existing tests pass
- [ ] New tests added
- [ ] Manual testing completed

## Documentation
- [ ] Documentation updated
- [ ] I18n translations added
- [ ] Comments added to code

## Checklist
- [ ] Code follows project style guidelines
- [ ] Self-review completed
- [ ] Tests added/updated
- [ ] Documentation updated
```

## 🌐 Internationalization Contributions

### Adding New Languages
1. Create translation files in `locales/[language-code]/`
2. Translate all existing keys
3. Update the i18n system configuration
4. Add language option to configuration files
5. Test with the new language

### Improving Translations
- Fix mistranslations or unclear messages
- Add cultural context where appropriate
- Maintain technical accuracy
- Consider different skill levels

## 🤖 Agent Development

### Creating New Agents
Agents should follow the established patterns:

1. **Extend AgentBase** - Use the base agent class
2. **Implement Required Methods** - `processTask`, `getStatus`
3. **Add Error Handling** - Use PoppoError system
4. **Include Documentation** - Agent-specific guide
5. **Write Tests** - Comprehensive test coverage

### Agent Guidelines
- Single responsibility principle
- Clear communication protocols
- Robust error handling
- Performance considerations
- Security best practices

## 📊 Performance Considerations

### Optimization Guidelines
- Monitor memory usage
- Optimize API calls
- Use appropriate caching
- Consider rate limiting
- Profile performance bottlenecks

### Monitoring
- Use the built-in metrics system
- Add performance logging where appropriate
- Monitor resource usage
- Track error rates

## 🔒 Security Guidelines

### Security Best Practices
- Never commit secrets or API keys
- Validate all inputs
- Use secure communication protocols
- Implement proper authentication
- Follow principle of least privilege

### Sensitive Data
- Use environment variables for secrets
- Mask sensitive data in logs
- Implement proper access controls
- Regular security reviews

## 🧪 Testing Strategy

### Test Categories
- **Unit Tests**: Individual functions/methods
- **Integration Tests**: Component interactions
- **I18n Tests**: Translation functionality
- **Error Tests**: Error handling scenarios
- **Performance Tests**: Resource usage

### Test Requirements
- Tests must pass before merging
- New features require test coverage
- Bug fixes should include regression tests
- Performance tests for significant changes

## 📈 Release Process

### Version Management
- Follow semantic versioning (SemVer)
- Update version in package.json
- Create release notes
- Tag releases appropriately

### Release Checklist
- [ ] All tests passing
- [ ] Documentation updated
- [ ] Version numbers updated
- [ ] Release notes created
- [ ] Changelog updated

## 🆘 Getting Help

### Resources
- [Documentation](docs/README_en.md)
- [GitHub Issues](https://github.com/medamap/PoppoBuilderSuite/issues)
- [Installation Guide](docs/INSTALL_en.md)
- [Architecture Documentation](docs/architecture/)

### Communication
- Use GitHub Issues for bug reports and feature requests
- Use GitHub Discussions for questions and general discussion
- Be respectful and constructive in all interactions

### Debugging
- Check logs in the `logs/` directory
- Use the diagnostic command: `poppobuilder doctor`
- Enable debug logging: `DEBUG=* npm start`

## 🙏 Recognition

Contributors are recognized in:
- Release notes for significant contributions
- Documentation for major features
- Special recognition for dogfooding participants

## 📄 Code of Conduct

### Our Pledge
We are committed to providing a welcoming and inclusive environment for all contributors.

### Standards
- Use welcoming and inclusive language
- Be respectful of differing viewpoints
- Accept constructive criticism gracefully
- Focus on what's best for the community
- Show empathy towards other community members

### Enforcement
Unacceptable behavior may result in temporary or permanent ban from the project.

---

**Thank you for contributing to PoppoBuilder Suite!** 

Whether through dogfooding issues or traditional pull requests, your contributions help make PoppoBuilder better for everyone.