/**
 * IPC Module for PoppoBuilder Daemon
 * Exports all IPC components
 */

module.exports = {
  IPCServer: require('./ipc-server'),
  IPCClient: require('./ipc-client'),
  Protocol: require('./protocol'),
  Commands: require('./commands')
};