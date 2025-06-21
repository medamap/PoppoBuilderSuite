/**
 * Test the status command
 */

const path = require('path');
const { execSync } = require('child_process');

// Get the CLI path
const cliPath = path.join(__dirname, '..', 'bin', 'poppobuilder.js');

console.log('Testing PoppoBuilder status command...\n');

try {
  // Test 1: Global status
  console.log('Test 1: Global status');
  console.log('Running: poppobuilder status');
  const globalStatus = execSync(`node ${cliPath} status`, { encoding: 'utf8' });
  console.log(globalStatus);
  console.log('-'.repeat(50));

  // Test 2: Global status with JSON
  console.log('\nTest 2: Global status (JSON)');
  console.log('Running: poppobuilder status --json');
  const jsonStatus = execSync(`node ${cliPath} status --json`, { encoding: 'utf8' });
  const parsed = JSON.parse(jsonStatus);
  console.log('JSON output parsed successfully');
  console.log('Projects found:', Object.keys(parsed.projects || {}).length);
  console.log('-'.repeat(50));

  // Test 3: Specific project status (will fail if no projects registered)
  console.log('\nTest 3: Project-specific status');
  console.log('Running: poppobuilder status test-project');
  try {
    const projectStatus = execSync(`node ${cliPath} status test-project`, { encoding: 'utf8' });
    console.log(projectStatus);
  } catch (err) {
    console.log('Expected error (no test-project registered):', err.message.split('\n')[0]);
  }
  console.log('-'.repeat(50));

  console.log('\nAll tests completed!');
} catch (error) {
  console.error('Test failed:', error.message);
  process.exit(1);
}