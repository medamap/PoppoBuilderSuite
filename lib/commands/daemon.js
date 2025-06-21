#!/usr/bin/env node

/**
 * PoppoBuilder Daemon Command
 * Manage PoppoBuilder daemon process
 */

const { program } = require('commander');
const chalk = require('chalk');
const DaemonManager = require('../daemon/daemon-manager');
const i18n = require('../i18n');

// Initialize i18n
i18n.init().then(() => {
  const daemonManager = new DaemonManager();

  // Helper to handle async commands
  const handleCommand = (fn) => {
    return async (...args) => {
      try {
        await daemonManager.initialize();
        await fn(...args);
        // Ensure process exits after command completion
        if (!args[0]?.foreground) {
          process.exit(0);
        }
      } catch (error) {
        console.error(chalk.red(i18n.t('errors.commandFailed')), error.message);
        process.exit(1);
      }
    };
  };

  program
    .name('poppobuilder daemon')
    .description(i18n.t('commands.daemon.description'))
    .version('1.0.0');

  // Start command
  program
    .command('start')
    .description(i18n.t('commands.daemon.start.description'))
    .option('-f, --foreground', i18n.t('commands.daemon.start.foreground'))
    .action(handleCommand(async (options) => {
      if (!options.foreground) {
        // Fork as daemon
        const { spawn } = require('child_process');
        const child = spawn(process.argv[0], [__filename, 'start', '--foreground'], {
          detached: true,
          stdio: 'ignore'
        });
        child.unref();
        console.log(chalk.green(i18n.t('commands.daemon.start.starting')));
        process.exit(0);
      } else {
        // Run in foreground
        await daemonManager.start();
        
        // Keep process running
        process.on('SIGTERM', () => {});
        process.on('SIGINT', () => {});
      }
    }));

  // Stop command
  program
    .command('stop')
    .description(i18n.t('commands.daemon.stop.description'))
    .action(handleCommand(async () => {
      const pid = await daemonManager.getPid();
      if (!pid) {
        console.log(chalk.yellow(i18n.t('commands.daemon.stop.notRunning')));
        return;
      }

      try {
        process.kill(pid, 'SIGTERM');
        console.log(chalk.green(i18n.t('commands.daemon.stop.stopping', { pid })));
        
        // Wait for daemon to stop
        let retries = 30;
        while (retries > 0 && await daemonManager.isRunning()) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          retries--;
        }
        
        if (await daemonManager.isRunning()) {
          console.log(chalk.red(i18n.t('commands.daemon.stop.timeout')));
          process.exit(1);
        }
        
        console.log(chalk.green(i18n.t('commands.daemon.stop.stopped')));
      } catch (error) {
        console.error(chalk.red(i18n.t('commands.daemon.stop.error')), error.message);
        process.exit(1);
      }
    }));

  // Restart command
  program
    .command('restart')
    .description(i18n.t('commands.daemon.restart.description'))
    .action(handleCommand(async () => {
      // Stop if running
      if (await daemonManager.isRunning()) {
        const pid = await daemonManager.getPid();
        process.kill(pid, 'SIGTERM');
        console.log(chalk.yellow(i18n.t('commands.daemon.restart.stopping')));
        
        // Wait for stop
        let retries = 30;
        while (retries > 0 && await daemonManager.isRunning()) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          retries--;
        }
      }
      
      // Start daemon
      const { spawn } = require('child_process');
      const child = spawn(process.argv[0], [__filename, 'start', '--foreground'], {
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
      console.log(chalk.green(i18n.t('commands.daemon.restart.started')));
    }));

  // Status command
  program
    .command('status')
    .description(i18n.t('commands.daemon.status.description'))
    .option('-j, --json', i18n.t('commands.daemon.status.json'))
    .action(handleCommand(async (options) => {
      const status = await daemonManager.getStatus();
      
      if (options.json) {
        console.log(JSON.stringify(status, null, 2));
      } else {
        if (status.running) {
          console.log(chalk.green(i18n.t('commands.daemon.status.running', { pid: status.pid })));
          
          if (status.workers && status.workers.length > 0) {
            console.log(chalk.bold(i18n.t('commands.daemon.status.workers')));
            for (const worker of status.workers) {
              const uptime = Math.floor(worker.uptime / 1000);
              console.log(`  Worker ${worker.id}: PID ${worker.pid}, Uptime: ${uptime}s, Restarts: ${worker.restarts}`);
            }
          }
        } else {
          console.log(chalk.yellow(i18n.t('commands.daemon.status.notRunning')));
        }
      }
    }));

  // Reload command
  program
    .command('reload')
    .description(i18n.t('commands.daemon.reload.description'))
    .action(handleCommand(async () => {
      const pid = await daemonManager.getPid();
      if (!pid) {
        console.log(chalk.yellow(i18n.t('commands.daemon.reload.notRunning')));
        return;
      }

      try {
        process.kill(pid, 'SIGHUP');
        console.log(chalk.green(i18n.t('commands.daemon.reload.sent')));
      } catch (error) {
        console.error(chalk.red(i18n.t('commands.daemon.reload.error')), error.message);
        process.exit(1);
      }
    }));

  program.parse(process.argv);
}).catch(error => {
  console.error(chalk.red('Failed to initialize:'), error);
  process.exit(1);
});