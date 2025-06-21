const { expect } = require('chai');
const sinon = require('sinon');
const PRCommand = require('../lib/commands/pr');
const { execSync } = require('child_process');

describe('PR Command', () => {
  let prCommand;
  let execSyncStub;
  let consoleLogStub;
  let consoleErrorStub;

  beforeEach(() => {
    prCommand = new PRCommand();
    execSyncStub = sinon.stub(require('child_process'), 'execSync');
    consoleLogStub = sinon.stub(console, 'log');
    consoleErrorStub = sinon.stub(console, 'error');
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('checkPrerequisites', () => {
    it('should check if in git repository', async () => {
      execSyncStub.withArgs('git rev-parse --git-dir').throws(new Error('not a git repo'));
      
      try {
        await prCommand.checkPrerequisites();
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Not in a git repository');
      }
    });

    it('should check if gh CLI is available', async () => {
      execSyncStub.withArgs('git rev-parse --git-dir').returns('');
      execSyncStub.withArgs('gh --version').throws(new Error('gh not found'));
      
      try {
        await prCommand.checkPrerequisites();
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('GitHub CLI (gh) is not installed');
      }
    });

    it('should check if gh is authenticated', async () => {
      execSyncStub.withArgs('git rev-parse --git-dir').returns('');
      execSyncStub.withArgs('gh --version').returns('gh version 2.0.0');
      execSyncStub.withArgs('gh auth status').throws(new Error('not authenticated'));
      
      try {
        await prCommand.checkPrerequisites();
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('GitHub CLI is not authenticated');
      }
    });

    it('should detect Claude CLI availability', async () => {
      execSyncStub.withArgs('git rev-parse --git-dir').returns('');
      execSyncStub.withArgs('gh --version').returns('gh version 2.0.0');
      execSyncStub.withArgs('gh auth status').returns('');
      execSyncStub.withArgs('claude --version').returns('claude version 1.0.0');
      execSyncStub.withArgs('git branch --show-current').returns('feature-branch\n');
      execSyncStub.withArgs('git status --porcelain').returns('');
      execSyncStub.withArgs('git log origin/feature-branch..HEAD --oneline').returns('');
      
      await prCommand.checkPrerequisites();
      expect(prCommand.claudeAvailable).to.be.true;
    });

    it('should proceed without Claude if not available', async () => {
      execSyncStub.withArgs('git rev-parse --git-dir').returns('');
      execSyncStub.withArgs('gh --version').returns('gh version 2.0.0');
      execSyncStub.withArgs('gh auth status').returns('');
      execSyncStub.withArgs('claude --version').throws(new Error('claude not found'));
      execSyncStub.withArgs('git branch --show-current').returns('feature-branch\n');
      execSyncStub.withArgs('git status --porcelain').returns('');
      execSyncStub.withArgs('git log origin/feature-branch..HEAD --oneline').returns('');
      
      await prCommand.checkPrerequisites();
      expect(prCommand.claudeAvailable).to.be.false;
    });

    it('should detect current branch', async () => {
      execSyncStub.withArgs('git rev-parse --git-dir').returns('');
      execSyncStub.withArgs('gh --version').returns('gh version 2.0.0');
      execSyncStub.withArgs('gh auth status').returns('');
      execSyncStub.withArgs('claude --version').returns('claude version 1.0.0');
      execSyncStub.withArgs('git branch --show-current').returns('my-feature-branch\n');
      execSyncStub.withArgs('git status --porcelain').returns('');
      execSyncStub.withArgs('git log origin/my-feature-branch..HEAD --oneline').returns('');
      
      await prCommand.checkPrerequisites();
      expect(prCommand.currentBranch).to.equal('my-feature-branch');
    });

    it('should detect uncommitted changes', async () => {
      execSyncStub.withArgs('git rev-parse --git-dir').returns('');
      execSyncStub.withArgs('gh --version').returns('gh version 2.0.0');
      execSyncStub.withArgs('gh auth status').returns('');
      execSyncStub.withArgs('claude --version').returns('claude version 1.0.0');
      execSyncStub.withArgs('git branch --show-current').returns('feature-branch\n');
      execSyncStub.withArgs('git status --porcelain').returns('M  file1.js\nA  file2.js\n');
      execSyncStub.withArgs('git log origin/feature-branch..HEAD --oneline').returns('');
      
      await prCommand.checkPrerequisites();
      expect(prCommand.hasUncommittedChanges).to.be.true;
    });

    it('should detect unpushed commits', async () => {
      execSyncStub.withArgs('git rev-parse --git-dir').returns('');
      execSyncStub.withArgs('gh --version').returns('gh version 2.0.0');
      execSyncStub.withArgs('gh auth status').returns('');
      execSyncStub.withArgs('claude --version').returns('claude version 1.0.0');
      execSyncStub.withArgs('git branch --show-current').returns('feature-branch\n');
      execSyncStub.withArgs('git status --porcelain').returns('');
      execSyncStub.withArgs('git log origin/feature-branch..HEAD --oneline').returns('abc123 Add feature\ndef456 Fix bug\n');
      
      await prCommand.checkPrerequisites();
      expect(prCommand.hasUnpushedCommits).to.be.true;
    });
  });

  describe('parseClaudeResponse', () => {
    it('should extract markdown from code blocks', () => {
      const response = `Here's the improved PR description:

\`\`\`markdown
## Summary
This PR adds a new feature...

## Type of Change
- [x] New feature
\`\`\`

I hope this helps!`;

      const result = prCommand.parseClaudeResponse(response);
      expect(result).to.include('## Summary');
      expect(result).to.include('This PR adds a new feature');
      expect(result).not.to.include('```');
    });

    it('should handle plain markdown response', () => {
      const response = `## Summary
This PR adds a new feature...

## Type of Change
- [x] New feature`;

      const result = prCommand.parseClaudeResponse(response);
      expect(result).to.equal(response.trim());
    });

    it('should remove leading artifacts', () => {
      const response = `Sure, I can help with that. Here's an improved description:

## Summary
This PR adds a new feature...`;

      const result = prCommand.parseClaudeResponse(response);
      expect(result).to.start.with('## Summary');
      expect(result).not.to.include('Sure, I can help');
    });
  });

  describe('getCommandDefinition', () => {
    it('should return proper command definition', () => {
      const def = PRCommand.getCommandDefinition();
      
      expect(def.command).to.equal('pr');
      expect(def.description).to.include('pull request');
      expect(def.options).to.be.an('array');
      expect(def.options).to.have.length.greaterThan(0);
      expect(def.action).to.be.a('function');
    });

    it('should include all expected options', () => {
      const def = PRCommand.getCommandDefinition();
      const optionFlags = def.options.map(opt => opt[0]);
      
      expect(optionFlags).to.include('--no-claude');
      expect(optionFlags).to.include('--draft');
      expect(optionFlags).to.include('--base <branch>');
    });
  });
});