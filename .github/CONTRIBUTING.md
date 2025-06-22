# Contributing to PoppoBuilder Suite

Thank you for your interest in contributing to PoppoBuilder Suite! We welcome contributions from everyone.

## Code of Conduct

By participating in this project, you agree to abide by our Code of Conduct. Please be respectful and considerate in all interactions.

## How to Contribute

### Reporting Bugs

1. Check if the bug has already been reported in [Issues](https://github.com/medamap/PoppoBuilderSuite/issues)
2. If not, create a new issue using the bug report template
3. Include as much detail as possible:
   - Steps to reproduce
   - Expected vs actual behavior
   - Environment details
   - Error messages/logs

### Suggesting Features

1. Check existing feature requests in [Issues](https://github.com/medamap/PoppoBuilderSuite/issues)
2. Create a new issue using the feature request template
3. Explain the use case and potential implementation

### Submitting Code

1. **Fork the repository**
   ```bash
   git clone https://github.com/medamap/PoppoBuilderSuite.git
   cd PoppoBuilderSuite
   ```

2. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

3. **Make your changes**
   - Follow the coding standards
   - Add tests for new functionality
   - Update documentation as needed

4. **Commit your changes**
   ```bash
   git commit -m "feat: Add your feature description"
   ```
   Follow our [commit message conventions](#commit-message-format)

5. **Push to your fork**
   ```bash
   git push origin feature/your-feature-name
   ```

6. **Create a Pull Request**
   - Use the PR template
   - Link related issues
   - Ensure all tests pass

## Development Setup

1. **Prerequisites**
   - Node.js 16.x or higher
   - npm or yarn
   - Git

2. **Installation**
   ```bash
   npm install
   ```

3. **Running tests**
   ```bash
   npm test
   ```

4. **Running locally**
   ```bash
   npm start
   ```

## Coding Standards

### JavaScript Style
- Use ES6+ features
- 2 spaces for indentation
- Use meaningful variable names
- Add JSDoc comments for functions

### File Organization
```
src/          # Main source code
lib/          # Library modules
agents/       # Agent implementations
test/         # Test files
docs/         # Documentation
```

### Testing
- Write unit tests for new features
- Maintain test coverage above 80%
- Use descriptive test names

## Commit Message Format

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes
- `refactor`: Code refactoring
- `test`: Test additions/changes
- `chore`: Build/tool changes

### Examples
```
feat: Add language detection for comments
fix: Resolve memory leak in task queue
docs: Update installation guide
```

## Language Guidelines

### Code and Comments
- All code comments should be in English
- Variable and function names in English
- Error messages in English (with i18n support)

### GitHub Outputs
- Commit messages: English
- PR titles/descriptions: English
- Issue titles/descriptions: English

### User Interaction
- Detect user's language preference
- Respond in user's language when possible
- Maintain multilingual documentation

## Pull Request Process

1. Update documentation for any API changes
2. Add tests for new functionality
3. Ensure all tests pass locally
4. Update the README.md if needed
5. Request review from maintainers

## Agent Development

When creating new agents:
1. Follow the agent base class structure
2. Implement required methods
3. Add comprehensive error handling
4. Document the agent's purpose and usage
5. Add integration tests

## Questions?

- Check our [documentation](https://github.com/medamap/PoppoBuilderSuite/wiki)
- Ask in [Discussions](https://github.com/medamap/PoppoBuilderSuite/discussions)
- Contact maintainers through issues

## Recognition

Contributors will be recognized in:
- The README.md contributors section
- Release notes
- The project website (when available)

Thank you for contributing to PoppoBuilder Suite! 🚂