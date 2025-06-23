/**
 * Test for daemon CLI commands
 */

const { expect } = require('chai');
const DaemonCommand = require('../../lib/cli/commands/daemon');
const StartCommand = require('../../lib/cli/commands/daemon/start');
const StopCommand = require('../../lib/cli/commands/daemon/stop');
const StatusCommand = require('../../lib/cli/commands/daemon/status');
const RestartCommand = require('../../lib/cli/commands/daemon/restart');
const ReloadCommand = require('../../lib/cli/commands/daemon/reload');

describe('Daemon CLI Commands', () => {
  describe('DaemonCommand', () => {
    it('should create daemon command group', () => {
      const command = DaemonCommand.create();
      expect(command.name()).to.equal('daemon');
      expect(command.alias()).to.equal('d');
      expect(command.commands).to.have.lengthOf(5);
    });
  });

  describe('StartCommand', () => {
    it('should create start command', () => {
      const command = StartCommand.create();
      expect(command.name()).to.equal('start');
      expect(command.description()).to.include('Start');
    });

    it('should have required options', () => {
      const command = StartCommand.create();
      const options = command.options;
      const optionNames = options.map(opt => opt.flags);
      
      expect(optionNames).to.include('-f, --foreground');
      expect(optionNames).to.include('-d, --debug');
      expect(optionNames).to.include('--log-level <level>');
      expect(optionNames).to.include('--json');
    });
  });

  describe('StopCommand', () => {
    it('should create stop command', () => {
      const command = StopCommand.create();
      expect(command.name()).to.equal('stop');
      expect(command.description()).to.include('Stop');
    });

    it('should have force option', () => {
      const command = StopCommand.create();
      const options = command.options;
      const optionNames = options.map(opt => opt.flags);
      
      expect(optionNames).to.include('-f, --force');
      expect(optionNames).to.include('--timeout <seconds>');
    });
  });

  describe('StatusCommand', () => {
    it('should create status command', () => {
      const command = StatusCommand.create();
      expect(command.name()).to.equal('status');
      expect(command.description()).to.include('status');
    });

    it('should have verbose and detail options', () => {
      const command = StatusCommand.create();
      const options = command.options;
      const optionNames = options.map(opt => opt.flags);
      
      expect(optionNames).to.include('-v, --verbose');
      expect(optionNames).to.include('-w, --workers');
      expect(optionNames).to.include('-q, --queues');
      expect(optionNames).to.include('-p, --projects');
    });
  });

  describe('RestartCommand', () => {
    it('should create restart command', () => {
      const command = RestartCommand.create();
      expect(command.name()).to.equal('restart');
      expect(command.description()).to.include('Restart');
    });

    it('should have graceful option', () => {
      const command = RestartCommand.create();
      const options = command.options;
      const optionNames = options.map(opt => opt.flags);
      
      expect(optionNames).to.include('-g, --graceful');
      expect(optionNames).to.include('--preserve-queue');
    });
  });

  describe('ReloadCommand', () => {
    it('should create reload command', () => {
      const command = ReloadCommand.create();
      expect(command.name()).to.equal('reload');
      expect(command.description()).to.include('Reload');
    });

    it('should have validation options', () => {
      const command = ReloadCommand.create();
      const options = command.options;
      const optionNames = options.map(opt => opt.flags);
      
      expect(optionNames).to.include('--validate-only');
      expect(optionNames).to.include('--show-diff');
    });
  });
});