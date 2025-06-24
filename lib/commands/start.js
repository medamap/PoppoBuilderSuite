/**
 * Start Command
 * Starts PoppoBuilder service
 */

const { handleStart } = require('../cli/commands/start');

class StartCommand {
  async execute(options) {
    // Delegate to the actual implementation
    return await handleStart(options);
  }
}

module.exports = StartCommand;