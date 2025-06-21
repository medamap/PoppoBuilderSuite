/**
 * Test script for enable/disable commands
 */

const { spawn } = require('child_process');
const path = require('path');

const poppobuilderPath = path.join(__dirname, '..', 'bin', 'poppobuilder.js');

// Test helper function
function runCommand(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [poppobuilderPath, ...args], {
      cwd: path.join(__dirname, '..'),
      env: process.env
    });
    
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    proc.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
    
    proc.on('error', reject);
  });
}

async function runTests() {
  console.log('Testing enable/disable commands...\n');
  
  // Test 1: Check if enable command exists
  console.log('Test 1: Check enable command help');
  const helpResult = await runCommand(['enable', '--help']);
  console.log('Output:', helpResult.stdout);
  console.log('Exit code:', helpResult.code);
  
  // Test 2: Check if disable command exists  
  console.log('\nTest 2: Check disable command help');
  const disableHelpResult = await runCommand(['disable', '--help']);
  console.log('Output:', disableHelpResult.stdout);
  console.log('Exit code:', disableHelpResult.code);
  
  // Test 3: Check if 'on' alias works
  console.log('\nTest 3: Check "on" alias');
  const onResult = await runCommand(['on', '--help']);
  console.log('Output:', onResult.stdout);
  console.log('Exit code:', onResult.code);
  
  // Test 4: Check if 'off' alias works
  console.log('\nTest 4: Check "off" alias');
  const offResult = await runCommand(['off', '--help']);
  console.log('Output:', offResult.stdout);
  console.log('Exit code:', offResult.code);
  
  // Test 5: Try to enable a non-existent project
  console.log('\nTest 5: Enable non-existent project');
  const enableNonExistent = await runCommand(['enable', 'non-existent-project']);
  console.log('Output:', enableNonExistent.stdout);
  console.log('Error:', enableNonExistent.stderr);
  console.log('Exit code:', enableNonExistent.code);
  
  console.log('\nAll tests completed!');
}

// Run tests
runTests().catch(console.error);