#!/usr/bin/env node

/**
 * IPC Demo - Demonstrates IPC communication between client and server
 */

const { IPCServer, IPCClient } = require('../lib/daemon/ipc');
const path = require('path');

// Demo configuration
const SOCKET_PATH = process.platform === 'win32' 
  ? '\\\\.\\pipe\\poppo-demo'
  : path.join(process.env.TMPDIR || '/tmp', 'poppo-demo.sock');
const AUTH_TOKEN = 'demo-auth-token';

async function startServer() {
  console.log('Starting IPC Server...');
  
  const server = new IPCServer({
    socketPath: SOCKET_PATH,
    authToken: AUTH_TOKEN,
    logger: {
      info: (...args) => console.log('[SERVER]', ...args),
      error: (...args) => console.error('[SERVER]', ...args),
      debug: (...args) => console.debug('[SERVER]', ...args)
    }
  });
  
  // Mock daemon object
  server.daemon = {
    version: '1.0.0',
    configPath: '/path/to/config',
    getStatus: async () => ({ status: 'running' }),
    projectManager: {
      listProjects: async () => [
        { id: '1', name: 'Demo Project', path: '/demo', status: 'active', enabled: true }
      ],
      getProjectStatus: async (id) => ({
        id,
        status: 'active',
        stats: { processed: 10, pending: 5 }
      })
    },
    queueManager: {
      getStatus: async () => ({
        queues: {
          default: { waiting: 5, active: 2, completed: 100 }
        }
      })
    },
    workerPool: {
      getStatus: async () => ({
        total: 4,
        active: 3,
        idle: 1,
        workers: []
      })
    }
  };
  
  server.on('listening', (path) => {
    console.log(`[SERVER] Listening on ${path}`);
  });
  
  server.on('client-authenticated', (clientId) => {
    console.log(`[SERVER] Client ${clientId} authenticated`);
    
    // Send a test event after authentication
    setTimeout(() => {
      server.sendToClient(clientId, {
        type: 'event',
        event: 'test-event',
        data: { message: 'Hello from server!' }
      });
    }, 1000);
  });
  
  await server.start();
  
  return server;
}

async function startClient() {
  console.log('\nStarting IPC Client...');
  
  const client = new IPCClient({
    socketPath: SOCKET_PATH,
    authToken: AUTH_TOKEN,
    logger: {
      info: (...args) => console.log('[CLIENT]', ...args),
      error: (...args) => console.error('[CLIENT]', ...args),
      debug: (...args) => console.debug('[CLIENT]', ...args)
    }
  });
  
  client.on('connected', () => {
    console.log('[CLIENT] Connected to daemon');
  });
  
  client.on('authenticated', () => {
    console.log('[CLIENT] Authenticated successfully');
  });
  
  client.on('daemon-event', (event, data) => {
    console.log('[CLIENT] Received event:', event, data);
  });
  
  await client.connect();
  
  return client;
}

async function runDemo() {
  let server, client;
  
  try {
    // Start server
    server = await startServer();
    
    // Wait a moment
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Start client
    client = await startClient();
    
    // Wait for authentication
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Send some commands
    console.log('\n--- Sending Commands ---');
    
    // Get daemon status
    console.log('\n1. Getting daemon status...');
    const status = await client.sendCommand('daemon.status');
    console.log('[CLIENT] Daemon status:', JSON.stringify(status, null, 2));
    
    // List projects
    console.log('\n2. Listing projects...');
    const projects = await client.sendCommand('project.list');
    console.log('[CLIENT] Projects:', JSON.stringify(projects, null, 2));
    
    // Get queue status
    console.log('\n3. Getting queue status...');
    const queueStatus = await client.sendCommand('queue.status');
    console.log('[CLIENT] Queue status:', JSON.stringify(queueStatus, null, 2));
    
    // Get worker status
    console.log('\n4. Getting worker status...');
    const workerStatus = await client.sendCommand('worker.status');
    console.log('[CLIENT] Worker status:', JSON.stringify(workerStatus, null, 2));
    
    // Try an invalid command
    console.log('\n5. Trying invalid command...');
    try {
      await client.sendCommand('invalid.command');
    } catch (error) {
      console.log('[CLIENT] Expected error:', error.message);
    }
    
    // Wait for any events
    console.log('\n--- Waiting for events ---');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
  } catch (error) {
    console.error('Demo error:', error);
  } finally {
    // Cleanup
    console.log('\n--- Cleaning up ---');
    
    if (client) {
      await client.disconnect();
      console.log('[CLIENT] Disconnected');
    }
    
    if (server) {
      await server.stop();
      console.log('[SERVER] Stopped');
    }
  }
}

// Run the demo
if (require.main === module) {
  runDemo().catch(console.error);
}