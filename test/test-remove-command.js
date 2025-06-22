#!/usr/bin/env node

/**
 * Test script for the remove command
 */

const { spawn } = require('child_process');
const path = require('path');

const poppobuilderPath = path.join(__dirname, '..', 'bin', 'poppobuilder.js');

console.log('Testing poppobuilder remove command...\n');

// Test 1: Remove without force (should prompt)
console.log('Test 1: Remove without force flag');
const test1 = spawn('node', [poppobuilderPath, 'remove', 'test-project'], {
  stdio: 'inherit'
});

test1.on('close', (code) => {
  console.log(`\nTest 1 completed with code ${code}\n`);
  
  // Test 2: Remove with force flag
  console.log('Test 2: Remove with force flag');
  const test2 = spawn('node', [poppobuilderPath, 'remove', 'test-project', '--force'], {
    stdio: 'inherit'
  });
  
  test2.on('close', (code) => {
    console.log(`\nTest 2 completed with code ${code}\n`);
    
    // Test 3: Remove with clean flag
    console.log('Test 3: Remove with force and clean flags');
    const test3 = spawn('node', [poppobuilderPath, 'remove', 'test-project', '--force', '--clean'], {
      stdio: 'inherit'
    });
    
    test3.on('close', (code) => {
      console.log(`\nTest 3 completed with code ${code}\n`);
      console.log('All tests completed!');
    });
  });
});