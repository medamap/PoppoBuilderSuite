#!/usr/bin/env node

/**
 * Mock Claude CLI for testing
 * Simulates various Claude CLI behaviors without making actual API calls
 */

const fs = require('fs');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);
const command = args[0];

// Mock response storage
const mockResponsesFile = path.join(__dirname, 'mock-responses.json');
let mockResponses = {};

if (fs.existsSync(mockResponsesFile)) {
  mockResponses = JSON.parse(fs.readFileSync(mockResponsesFile, 'utf8'));
}

// Helper to simulate delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper to get mock response
function getMockResponse(scenario) {
  return mockResponses[scenario] || mockResponses.default || {
    success: true,
    output: 'Mock response'
  };
}

// Main command handler
async function handleCommand() {
  // Simulate processing delay
  await delay(100);

  // Check for rate limit simulation
  if (process.env.MOCK_RATE_LIMIT === 'true') {
    console.error('Error: Rate limit exceeded. Please wait before making another request.');
    process.exit(1);
  }

  // Check for session timeout simulation
  if (process.env.MOCK_SESSION_TIMEOUT === 'true') {
    console.error('Error: Invalid API key. Please run /login to authenticate.');
    process.exit(1);
  }

  // Check for error simulation
  if (process.env.MOCK_ERROR === 'true') {
    console.error('Error: An unexpected error occurred.');
    process.exit(1);
  }

  // Handle version command
  if (command === '--version') {
    console.log('Claude CLI v1.0.0 (mock)');
    process.exit(0);
  }

  // Handle login command
  if (command === 'login') {
    console.log('Successfully logged in to Claude (mock)');
    process.exit(0);
  }

  // Get scenario from environment or use default
  const scenario = process.env.MOCK_SCENARIO || 'default';
  const response = getMockResponse(scenario);

  // Output response
  if (response.success) {
    console.log(response.output);
    process.exit(0);
  } else {
    console.error(response.error || 'Mock error');
    process.exit(response.exitCode || 1);
  }
}

// Run the mock CLI
handleCommand().catch(err => {
  console.error('Mock CLI error:', err.message);
  process.exit(1);
});