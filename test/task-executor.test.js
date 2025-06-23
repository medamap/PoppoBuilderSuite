/**
 * Test script for TaskExecutor
 */

const path = require('path');
const TaskExecutor = require('../lib/daemon/task-executor');

// Create a test executor
const executor = new TaskExecutor({
  workerId: 'test-worker',
  timeout: 30000
});

// Set up event listeners
executor.on('task-completed', ({ task, result, duration }) => {
  console.log(`✅ Task completed: ${task.id} in ${duration}ms`);
  console.log('Result:', result);
});

executor.on('task-failed', ({ task, error, duration }) => {
  console.error(`❌ Task failed: ${task.id} in ${duration}ms`);
  console.error('Error:', error.message);
});

executor.on('progress', ({ task, stage, message }) => {
  console.log(`📋 Progress [${task.id}]: ${stage} - ${message}`);
});

executor.on('error', (error) => {
  console.error('⚠️  Executor error:', error.message);
});

// Test cases
async function runTests() {
  console.log('🧪 Testing TaskExecutor...\n');
  
  // Test 1: Execute a test task with project context
  console.log('Test 1: Execute task with project context');
  try {
    const testTask = {
      id: 'test-task-1',
      type: 'claude-cli',
      projectId: 'poppobuilder',
      projectPath: path.resolve(__dirname, '..'),
      instructions: 'List the files in the current directory',
      taskContext: {
        purpose: 'Testing task executor'
      }
    };
    
    const result = await executor.execute(testTask);
    console.log('✅ Test 1 passed\n');
  } catch (error) {
    console.error('❌ Test 1 failed:', error.message, '\n');
  }
  
  // Test 2: Test custom command execution
  console.log('Test 2: Execute custom command');
  try {
    const commandTask = {
      id: 'test-task-2',
      type: 'custom-command',
      projectId: 'poppobuilder',
      projectPath: path.resolve(__dirname, '..'),
      command: 'ls',
      args: ['-la'],
      metadata: {
        description: 'List directory contents'
      }
    };
    
    const result = await executor.execute(commandTask);
    console.log('Output:', result.stdout.substring(0, 200) + '...');
    console.log('✅ Test 2 passed\n');
  } catch (error) {
    console.error('❌ Test 2 failed:', error.message, '\n');
  }
  
  // Test 3: Test invalid task
  console.log('Test 3: Test invalid task (should fail)');
  try {
    const invalidTask = {
      id: 'test-task-3',
      type: 'invalid-type',
      projectId: 'poppobuilder',
      projectPath: path.resolve(__dirname, '..')
    };
    
    await executor.execute(invalidTask);
    console.error('❌ Test 3 failed: Should have thrown an error\n');
  } catch (error) {
    console.log('✅ Test 3 passed: Got expected error:', error.message, '\n');
  }
  
  // Test 4: Test metrics
  console.log('Test 4: Check metrics');
  const metrics = executor.getMetrics();
  console.log('Metrics:', JSON.stringify(metrics, null, 2));
  console.log('✅ Test 4 passed\n');
  
  // Test 5: Register custom handler
  console.log('Test 5: Register and use custom handler');
  executor.registerTaskHandler('echo-test', async (task, context) => {
    return {
      success: true,
      message: `Echo from project ${context.projectId}: ${task.message}`,
      projectPath: context.projectPath
    };
  });
  
  try {
    const customTask = {
      id: 'test-task-5',
      type: 'echo-test',
      projectId: 'poppobuilder',
      projectPath: path.resolve(__dirname, '..'),
      message: 'Hello from custom handler!'
    };
    
    const result = await executor.execute(customTask);
    console.log('Result:', result);
    console.log('✅ Test 5 passed\n');
  } catch (error) {
    console.error('❌ Test 5 failed:', error.message, '\n');
  }
}

// Run tests
runTests().then(() => {
  console.log('🎉 All tests completed!');
  process.exit(0);
}).catch(error => {
  console.error('💥 Test suite failed:', error);
  process.exit(1);
});