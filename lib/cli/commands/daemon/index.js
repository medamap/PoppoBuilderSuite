/**
 * Daemon Command Group
 * Main entry point for daemon-related commands
 */

const { Command } = require('commander');
const StartCommand = require('./start');
const StopCommand = require('./stop');
const StatusCommand = require('./status');
const RestartCommand = require('./restart');
const ReloadCommand = require('./reload');

class DaemonCommand {
  /**
   * Create the daemon command group
   * @returns {Command} The daemon command
   */
  static create() {
    const daemon = new Command('daemon');
    
    daemon
      .description('Manage the PoppoBuilder daemon process')
      .alias('d');

    // Add subcommands
    daemon.addCommand(StartCommand.create());
    daemon.addCommand(StopCommand.create());
    daemon.addCommand(StatusCommand.create());
    daemon.addCommand(RestartCommand.create());
    daemon.addCommand(ReloadCommand.create());

    // Default action - show status
    daemon.action(async () => {
      const statusCmd = new StatusCommand();
      await statusCmd.execute({});
    });

    return daemon;
  }
}

module.exports = DaemonCommand;