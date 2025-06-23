#!/usr/bin/env node

/**
 * Test script for PoppoBuilder Worker
 */

const path = require('path');
const { fork } = require('child_process');

console.log('Testing PoppoBuilder Worker...\n');

// Fork the worker process
const worker = fork(path.join(__dirname, '../lib/daemon/worker.js'), [], {
  env: {
    ...process.env,
    POPPOBUILDER_WORKER_ID: 'test-worker-001',
    POPPOBUILDER_DAEMON: 'true'
  },
  silent: false
});

console.log('Worker process started, PID:', worker.pid);

// Handle worker messages
worker.on('message', (message) => {
  console.log('Received from worker:', message);
  
  if (message.type === 'ready') {
    console.log('\n✅ Worker initialized successfully!');
    
    // Test ping
    console.log('\nSending ping...');
    worker.send({ type: 'ping' });
    
    // Schedule shutdown
    setTimeout(() => {
      console.log('\nSending shutdown signal...');
      worker.send({ type: 'shutdown' });
    }, 2000);
  }
  
  if (message.type === 'pong') {
    console.log('✅ Ping successful!');
  }
});

// Handle worker exit
worker.on('exit', (code, signal) => {
  console.log(`\nWorker exited with code ${code}, signal ${signal}`);
  process.exit(0);
});

// Handle worker errors
worker.on('error', (error) => {
  console.error('Worker error:', error);
  process.exit(1);
});

// Handle parent process termination
process.on('SIGINT', () => {
  console.log('\nTerminating worker...');
  worker.kill('SIGTERM');
});