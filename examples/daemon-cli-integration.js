#!/usr/bin/env node

/**
 * Example: Integrating daemon commands into a CLI application
 */

const { Command } = require('commander');
const DaemonCommand = require('../lib/cli/commands/daemon');

// Create main program
const program = new Command();

program
  .name('poppo')
  .description('PoppoBuilder CLI')
  .version('1.0.0');

// Add daemon command group
program.addCommand(DaemonCommand.create());

// Parse command line arguments
program.parse(process.argv);

// Examples of usage:
// node examples/daemon-cli-integration.js daemon status
// node examples/daemon-cli-integration.js daemon start
// node examples/daemon-cli-integration.js daemon stop
// node examples/daemon-cli-integration.js daemon restart --graceful
// node examples/daemon-cli-integration.js daemon reload --show-diff