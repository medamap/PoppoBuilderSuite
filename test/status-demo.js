/**
 * Demo script to test status command with mock data
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');

// Create mock project registry
async function createMockData() {
  const registryDir = path.join(os.homedir(), '.poppobuilder');
  const registryFile = path.join(registryDir, 'projects.json');
  
  // Ensure directory exists
  await fs.mkdir(registryDir, { recursive: true });
  
  // Create mock project registry
  const mockRegistry = {
    version: '1.0.0',
    projects: {
      'poppobuilder-suite-abc123': {
        path: '/Volumes/PoppoSSD2T/Projects/ClaudeCodeProjects/AIBuildSystem/PoppoBuilderSuite',
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        config: {},
        stats: {
          totalIssuesProcessed: 42,
          totalErrors: 3,
          averageProcessingTime: 1250
        }
      },
      'test-project-def456': {
        path: '/tmp/test-project',
        enabled: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        config: {},
        stats: {
          totalIssuesProcessed: 10,
          totalErrors: 1,
          averageProcessingTime: 800
        }
      }
    },
    metadata: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      totalProjects: 2
    }
  };
  
  await fs.writeFile(registryFile, JSON.stringify(mockRegistry, null, 2));
  console.log('Created mock project registry');
  
  // Create mock state for PoppoBuilderSuite
  const stateDir = path.join('/Volumes/PoppoSSD2T/Projects/ClaudeCodeProjects/AIBuildSystem/PoppoBuilderSuite', 'state');
  
  try {
    // Mock running tasks
    const runningTasks = [
      {
        id: 'task-1',
        type: 'claude-cli',
        status: 'running',
        startTime: new Date(Date.now() - 300000).toISOString(), // 5 minutes ago
        pid: 12345
      },
      {
        id: 'task-2',
        type: 'github-issue',
        status: 'pending',
        startTime: new Date().toISOString(),
        pid: 12346
      }
    ];
    
    await fs.writeFile(
      path.join(stateDir, 'running-tasks.json'),
      JSON.stringify(runningTasks, null, 2)
    );
    
    // Mock issue status
    const issueStatus = {
      '156': {
        status: 'processing',
        startTime: new Date().toISOString(),
        processId: 'task-1'
      },
      '155': {
        status: 'completed',
        endTime: new Date().toISOString()
      }
    };
    
    await fs.writeFile(
      path.join(stateDir, 'issue-status.json'),
      JSON.stringify(issueStatus, null, 2)
    );
    
    console.log('Created mock state files');
  } catch (error) {
    console.log('Could not create state files:', error.message);
  }
}

// Run status command
async function runStatus() {
  const StatusCommand = require('../lib/commands/status');
  const cmd = new StatusCommand();
  
  console.log('\n--- Global Status ---\n');
  await cmd.execute({});
  
  console.log('\n--- Global Status (JSON) ---\n');
  await cmd.execute({ json: true });
  
  console.log('\n--- Project Status ---\n');
  await cmd.execute({ projectId: 'poppobuilder-suite-abc123' });
}

// Main
async function main() {
  try {
    await createMockData();
    await runStatus();
  } catch (error) {
    console.error('Error:', error);
  }
}

main();