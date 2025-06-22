/**
 * Test script to verify CCSP WebSocket connection
 */

const io = require('socket.io-client');

console.log('Testing CCSP WebSocket connection...');

const socket = io('http://localhost:3001/ccsp', {
  timeout: 5000,
  forceNew: true
});

socket.on('connect', () => {
  console.log('✅ Successfully connected to CCSP namespace');
  console.log('Socket ID:', socket.id);
  
  // Subscribe to stats
  socket.emit('subscribeStats', 5000);
  console.log('📊 Subscribed to stats updates');
});

socket.on('initialState', (data) => {
  console.log('📥 Received initial state:');
  console.log('- Queue total size:', data.queue.totalQueueSize);
  console.log('- Usage requests:', data.usage.currentWindow.requests);
});

socket.on('usageUpdate', (data) => {
  console.log('📈 Usage update:');
  console.log('- Requests per minute:', data.currentWindow.requestsPerMinute.toFixed(2));
  console.log('- Success rate:', (data.currentWindow.successRate * 100).toFixed(1) + '%');
});

socket.on('queueUpdate', (data) => {
  console.log('📋 Queue update:');
  console.log('- Total queue size:', data.totalQueueSize);
});

socket.on('connect_error', (error) => {
  console.error('❌ Connection error:', error.message);
});

socket.on('disconnect', () => {
  console.log('🔌 Disconnected from server');
});

// Disconnect after 15 seconds
setTimeout(() => {
  socket.emit('unsubscribeStats');
  socket.disconnect();
  console.log('Test completed');
  process.exit(0);
}, 15000);