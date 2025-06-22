# Security Policy

## Supported Versions

We release patches for security vulnerabilities. Which versions are eligible for receiving such patches depends on the CVSS v3.0 Rating:

| Version | Supported          |
| ------- | ------------------ |
| 3.x.x   | :white_check_mark: |
| 2.x.x   | :x:                |
| 1.x.x   | :x:                |

## Reporting a Vulnerability

We take the security of PoppoBuilder Suite seriously. If you have discovered a security vulnerability, please follow these steps:

### 1. Do NOT Create a Public Issue

Security vulnerabilities should not be reported through public GitHub issues.

### 2. Email the Maintainers

Send details to: [security@example.com] (replace with actual security email)

Include:
- Type of vulnerability
- Full paths of source file(s) related to the vulnerability
- Location of the affected source code (tag/branch/commit or direct URL)
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the issue

### 3. Response Timeline

- **Initial Response**: Within 48 hours
- **Status Update**: Within 5 business days
- **Resolution Timeline**: Depends on severity
  - Critical: 7 days
  - High: 14 days
  - Medium: 30 days
  - Low: 60 days

## Security Best Practices

When using PoppoBuilder Suite:

### API Keys and Tokens
- Never commit API keys or tokens to the repository
- Use environment variables for sensitive data
- Rotate credentials regularly

### Dependencies
- Keep all dependencies up to date
- Run `npm audit` regularly
- Review and fix vulnerabilities promptly

### Code Practices
- Validate all user inputs
- Use parameterized queries for database operations
- Implement proper error handling without exposing sensitive information
- Follow the principle of least privilege

## Security Features

PoppoBuilder Suite includes several security features:

1. **Authentication**: Role-based access control for agents
2. **Encryption**: Sensitive data encryption at rest
3. **Audit Logging**: Comprehensive audit trails
4. **Rate Limiting**: API rate limiting to prevent abuse
5. **Input Validation**: Strict input validation and sanitization

## Vulnerability Disclosure

After a security vulnerability is fixed:

1. We will publish a security advisory
2. Credit will be given to the reporter (unless anonymity is requested)
3. Details will be shared to help users assess the impact

## Contact

For any security-related questions, contact:
- Email: [security@example.com]
- GPG Key: [link to public key]

Thank you for helping keep PoppoBuilder Suite and its users safe!