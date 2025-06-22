# Setup Wizard Dependency Check Feature

## Overview

The PoppoBuilder Setup Wizard now includes comprehensive dependency checking to ensure all required tools are installed and properly configured before proceeding with the setup process.

## Features

### Automatic Dependency Detection

The setup wizard automatically checks for the following dependencies:

1. **Node.js** (v14.0.0 or higher)
   - Required for running PoppoBuilder
   - Version compatibility check included

2. **npm** (v6.0.0 or higher)
   - Package manager for Node.js
   - Comes bundled with Node.js

3. **Git** (v2.0.0 or higher)
   - Version control system
   - Required for repository management

4. **Yarn** (optional)
   - Alternative package manager
   - Detected but not required

5. **Claude CLI**
   - Anthropic's Claude command-line interface
   - Used for interactive setup guidance

### Version Comparison

The dependency checker includes a sophisticated version comparison system that:
- Parses version strings correctly
- Compares major, minor, and patch versions
- Handles different version formats (e.g., "14", "14.0", "14.0.0")

### Installation Guides

When dependencies are missing or outdated, the wizard provides platform-specific installation instructions:

- **macOS**: Homebrew commands
- **Ubuntu/Linux**: apt-get or official installation scripts
- **Windows**: winget commands or direct downloads

### Integration with Setup Flow

The dependency check is the first step in the setup process:

1. System dependencies are checked
2. Missing or outdated dependencies are reported
3. Installation guides are provided
4. User can retry after installing dependencies
5. Setup continues only when all dependencies are satisfied

## Usage

The dependency check runs automatically when starting the setup wizard:

```bash
# Run the setup wizard
poppobuilder setup

# Or run directly
node lib/commands/setup-wizard.js
```

## Example Output

```
🚀 PoppoBuilder Initial Setup Wizard

Checking system dependencies...

✓ Node.js: 16.14.0
✓ npm: 8.3.0
✓ Git: 2.30.0
ℹ Yarn (optional): Not installed
✓ Claude CLI detected

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 Dependency Check
   Checking required dependencies and tools
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✓ Dependency Check is already configured
```

## Testing

To test the dependency check functionality:

```bash
# Run the test script
node test/test-dependency-check.js

# Run unit tests
npx mocha test/setup-wizard.test.js
```

## API Reference

### checkSystemDependencies()

Checks all system dependencies and returns a detailed report.

**Returns:**
```javascript
{
  results: [
    {
      name: 'Node.js',
      command: 'node --version',
      minVersion: '14.0.0',
      installed: true,
      version: '16.14.0',
      isValid: true
    },
    // ... more dependencies
  ],
  allPassed: true
}
```

### compareVersions(version1, version2)

Compares two version strings.

**Parameters:**
- `version1`: First version string
- `version2`: Second version string

**Returns:**
- `1` if version1 > version2
- `-1` if version1 < version2
- `0` if versions are equal

### validateDependencies()

Validates that all required dependencies are installed and meet minimum version requirements.

**Returns:** `boolean` - true if all dependencies are valid

## Troubleshooting

### Common Issues

1. **Node.js version too old**
   - Update Node.js using nvm or download from nodejs.org

2. **Git not found**
   - Install Git from git-scm.com or use package manager

3. **Claude CLI not detected**
   - Install from https://console.anthropic.com/download
   - Run `claude login` after installation

### Platform-Specific Notes

- **macOS**: Ensure Homebrew is installed for easier dependency management
- **Linux**: May need sudo permissions for system-wide installations
- **Windows**: Consider using Windows Terminal for better CLI experience