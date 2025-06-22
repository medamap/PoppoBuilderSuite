#!/usr/bin/env node

/**
 * Daemon Runner Script
 * デーモンプロセスを起動するためのランナースクリプト
 */

const path = require('path');
const fs = require('fs');

// Add lib directory to module search path
const libPath = path.join(__dirname, '..', 'lib');
if (!module.paths.includes(libPath)) {
  module.paths.unshift(libPath);
}

const DaemonManager = require('../lib/daemon/daemon-manager');

async function startDaemon() {
  try {
    console.log('Starting PoppoBuilder daemon...');
    
    const daemonManager = new DaemonManager();
    
    // Initialize and start daemon
    await daemonManager.initialize();
    await daemonManager.start();
    
    // Set up process event handlers
    process.on('SIGINT', async () => {
      console.log('Received SIGINT, shutting down gracefully...');
      await daemonManager.stop();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      console.log('Received SIGTERM, shutting down gracefully...');
      await daemonManager.stop();
      process.exit(0);
    });
    
    process.on('uncaughtException', (error) => {
      console.error('Uncaught exception:', error);
      daemonManager.stop().then(() => {
        process.exit(1);
      });
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      console.error('Unhandled rejection at:', promise, 'reason:', reason);
      daemonManager.stop().then(() => {
        process.exit(1);
      });
    });
    
    console.log('Daemon started successfully');
    
  } catch (error) {
    console.error('Failed to start daemon:', error);
    process.exit(1);
  }
}

// Start the daemon
startDaemon();