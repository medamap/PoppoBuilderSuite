#!/usr/bin/env node

/**
 * Issue #131: Production Deployment Script
 * 
 * Command-line interface for deployment operations:
 * - Deploy to environments
 * - Rollback deployments
 * - Check deployment status
 * - Manage services
 */

const path = require('path');
const { program } = require('commander');
const DeploymentManager = require('../lib/deployment/deployment-manager');
const ProductionLogger = require('../lib/utils/production-logger');

// Initialize logger
const logger = new ProductionLogger('DeploymentScript', {
  enableStructuredLogging: true
});

// Initialize deployment manager
const deploymentManager = new DeploymentManager({
  deploymentStrategy: 'rolling',
  healthCheckTimeout: 300000,
  rollbackTimeout: 180000,
  maxRetries: 3
});

// Set up event handlers
deploymentManager.on('deployment-started', (deployment) => {
  console.log(`🚀 Deployment started: ${deployment.id}`);
  console.log(`   Environment: ${deployment.environment}`);
  console.log(`   Strategy: ${deployment.strategy}`);
  console.log(`   Services: ${deployment.services.join(', ')}`);
});

deploymentManager.on('deployment-completed', (deployment) => {
  console.log(`✅ Deployment completed: ${deployment.id}`);
  console.log(`   Duration: ${Math.round(deployment.duration / 1000)}s`);
  console.log(`   Phases: ${deployment.phases.length}`);
});

deploymentManager.on('deployment-failed', (deployment) => {
  console.log(`❌ Deployment failed: ${deployment.id}`);
  console.log(`   Error: ${deployment.error}`);
});

/**
 * Deploy command
 */
program
  .command('deploy')
  .description('Deploy PoppoBuilder to an environment')
  .option('-e, --environment <env>', 'Target environment', 'development')
  .option('-v, --version <version>', 'Version to deploy', 'latest')
  .option('-s, --strategy <strategy>', 'Deployment strategy', 'rolling')
  .option('--services <services>', 'Comma-separated list of services to deploy')
  .option('--dry-run', 'Perform a dry run without making changes')
  .option('--skip-health-checks', 'Skip health checks after deployment')
  .action(async (options) => {
    try {
      console.log(`🚀 Starting deployment to ${options.environment}...`);
      
      const deployOptions = {
        environment: options.environment,
        version: options.version,
        strategy: options.strategy,
        dryRun: options.dryRun || false,
        skipHealthChecks: options.skipHealthChecks || false
      };
      
      if (options.services) {
        deployOptions.services = options.services.split(',').map(s => s.trim());
      }
      
      const result = await deploymentManager.deploy(deployOptions);
      
      if (result.success) {
        console.log('✅ Deployment completed successfully!');
        
        if (options.dryRun) {
          console.log('   (This was a dry run - no actual changes were made)');
        }
        
        // Display summary
        console.log('\n📊 Deployment Summary:');
        console.log(`   ID: ${result.deployment.id}`);
        console.log(`   Environment: ${result.deployment.environment}`);
        console.log(`   Strategy: ${result.deployment.strategy}`);
        console.log(`   Duration: ${Math.round(result.deployment.duration / 1000)}s`);
        console.log(`   Services: ${result.deployment.services.join(', ')}`);
        
        // Display phases
        if (result.deployment.phases.length > 0) {
          console.log('\n📋 Phases:');
          result.deployment.phases.forEach((phase, index) => {
            const duration = Math.round((phase.endTime - phase.startTime) / 1000);
            console.log(`   ${index + 1}. ${phase.name} (${duration}s) - ${phase.status}`);
          });
        }
      }
      
    } catch (error) {
      console.error('❌ Deployment failed:', error.message);
      process.exit(1);
    }
  });

/**
 * Rollback command
 */
program
  .command('rollback')
  .description('Rollback a deployment')
  .argument('<deployment-id>', 'Deployment ID to rollback')
  .option('--confirm', 'Confirm the rollback operation')
  .action(async (deploymentId, options) => {
    try {
      if (!options.confirm) {
        console.log('⚠️  Rollback requires confirmation. Use --confirm flag.');
        process.exit(1);
      }
      
      console.log(`🔄 Rolling back deployment: ${deploymentId}...`);
      
      const result = await deploymentManager.rollback(deploymentId);
      
      if (result.success) {
        console.log('✅ Rollback completed successfully!');
        
        console.log('\n📊 Rollback Summary:');
        console.log(`   Rollback ID: ${result.rollbackId}`);
        console.log(`   Original Deployment: ${deploymentId}`);
        console.log(`   Services: ${result.results.length}`);
        
        // Display service rollback results
        console.log('\n📋 Service Rollbacks:');
        result.results.forEach((serviceResult) => {
          const status = serviceResult.status === 'success' ? '✅' : '❌';
          console.log(`   ${status} ${serviceResult.service} - ${serviceResult.status}`);
          if (serviceResult.rolledBackTo) {
            console.log(`      Rolled back to: ${serviceResult.rolledBackTo}`);
          }
          if (serviceResult.error) {
            console.log(`      Error: ${serviceResult.error}`);
          }
        });
      }
      
    } catch (error) {
      console.error('❌ Rollback failed:', error.message);
      process.exit(1);
    }
  });

/**
 * Status command
 */
program
  .command('status')
  .description('Show deployment status')
  .option('-e, --environment <env>', 'Show status for specific environment')
  .option('--json', 'Output in JSON format')
  .action(async (options) => {
    try {
      const status = deploymentManager.getDeploymentStatus();
      
      if (options.json) {
        console.log(JSON.stringify(status, null, 2));
        return;
      }
      
      console.log('📊 Deployment Status\n');
      
      // Active deployments
      if (status.activeDeployments.length > 0) {
        console.log('🔄 Active Deployments:');
        status.activeDeployments.forEach(deployment => {
          const duration = Math.round((Date.now() - deployment.startTime) / 1000);
          console.log(`   ${deployment.id} - ${deployment.environment} (${duration}s)`);
          console.log(`      Strategy: ${deployment.strategy}`);
          console.log(`      Status: ${deployment.status}`);
          console.log(`      Services: ${deployment.services.join(', ')}`);
        });
        console.log();
      } else {
        console.log('✅ No active deployments\n');
      }
      
      // Environment status
      console.log('🌍 Environments:');
      for (const [envName, env] of Object.entries(status.environments)) {
        if (options.environment && envName !== options.environment) continue;
        
        console.log(`   ${envName}:`);
        console.log(`      Status: ${env.status}`);
        console.log(`      URL: ${env.url}`);
        console.log(`      Services: ${env.services.join(', ')}`);
        if (env.lastDeployment) {
          console.log(`      Last Deployment: ${new Date(env.lastDeployment).toISOString()}`);
        }
        if (env.version) {
          console.log(`      Version: ${env.version}`);
        }
      }
      console.log();
      
      // Service status
      console.log('🔧 Services:');
      for (const [serviceName, service] of Object.entries(status.services)) {
        console.log(`   ${serviceName}:`);
        console.log(`      Status: ${service.status}`);
        console.log(`      Type: ${service.type}`);
        console.log(`      Port: ${service.port || 'N/A'}`);
        if (service.version) {
          console.log(`      Version: ${service.version}`);
        }
        if (service.lastRestart) {
          console.log(`      Last Restart: ${new Date(service.lastRestart).toISOString()}`);
        }
      }
      console.log();
      
      // Recent deployments
      if (status.recentDeployments.length > 0) {
        console.log('📜 Recent Deployments:');
        status.recentDeployments.slice(0, 5).forEach(deployment => {
          const date = new Date(deployment.startTime).toISOString();
          const duration = deployment.duration ? `${Math.round(deployment.duration / 1000)}s` : 'N/A';
          const statusIcon = deployment.status === 'completed' ? '✅' : 
                           deployment.status === 'failed' ? '❌' : '🔄';
          
          console.log(`   ${statusIcon} ${deployment.id} - ${deployment.environment} (${duration})`);
          console.log(`      Date: ${date}`);
          console.log(`      Strategy: ${deployment.strategy}`);
          console.log(`      Services: ${deployment.services.join(', ')}`);
        });
      }
      
      console.log(`\n📈 Total Deployments: ${status.totalDeployments}`);
      
    } catch (error) {
      console.error('❌ Failed to get status:', error.message);
      process.exit(1);
    }
  });

/**
 * History command
 */
program
  .command('history')
  .description('Show deployment history')
  .option('-l, --limit <number>', 'Number of deployments to show', '20')
  .option('-e, --environment <env>', 'Filter by environment')
  .option('--json', 'Output in JSON format')
  .action(async (options) => {
    try {
      const limit = parseInt(options.limit);
      const history = deploymentManager.getDeploymentHistory(limit);
      
      let filteredHistory = history;
      if (options.environment) {
        filteredHistory = history.filter(d => d.environment === options.environment);
      }
      
      if (options.json) {
        console.log(JSON.stringify(filteredHistory, null, 2));
        return;
      }
      
      console.log('📜 Deployment History\n');
      
      if (filteredHistory.length === 0) {
        console.log('No deployments found.');
        return;
      }
      
      filteredHistory.forEach((deployment, index) => {
        const date = new Date(deployment.startTime).toISOString();
        const duration = deployment.duration ? `${Math.round(deployment.duration / 1000)}s` : 'N/A';
        const statusIcon = deployment.status === 'completed' ? '✅' : 
                         deployment.status === 'failed' ? '❌' : '🔄';
        
        console.log(`${index + 1}. ${statusIcon} ${deployment.id}`);
        console.log(`   Environment: ${deployment.environment}`);
        console.log(`   Strategy: ${deployment.strategy}`);
        console.log(`   Version: ${deployment.version}`);
        console.log(`   Date: ${date}`);
        console.log(`   Duration: ${duration}`);
        console.log(`   Services: ${deployment.services.join(', ')}`);
        console.log(`   Phases: ${deployment.phases.length}`);
        
        if (deployment.error) {
          console.log(`   Error: ${deployment.error}`);
        }
        
        console.log();
      });
      
    } catch (error) {
      console.error('❌ Failed to get history:', error.message);
      process.exit(1);
    }
  });

/**
 * Service management commands
 */
const serviceCmd = program
  .command('service')
  .description('Manage individual services');

serviceCmd
  .command('start')
  .description('Start a service')
  .argument('<service>', 'Service name')
  .option('-e, --environment <env>', 'Target environment', 'development')
  .action(async (serviceName, options) => {
    try {
      console.log(`🚀 Starting service: ${serviceName} in ${options.environment}...`);
      
      const result = await deploymentManager.startService(options.environment, serviceName);
      
      if (result.success) {
        console.log('✅ Service started successfully!');
      }
      
    } catch (error) {
      console.error('❌ Failed to start service:', error.message);
      process.exit(1);
    }
  });

serviceCmd
  .command('stop')
  .description('Stop a service')
  .argument('<service>', 'Service name')
  .option('-e, --environment <env>', 'Target environment', 'development')
  .action(async (serviceName, options) => {
    try {
      console.log(`🛑 Stopping service: ${serviceName} in ${options.environment}...`);
      
      const result = await deploymentManager.stopService(options.environment, serviceName);
      
      if (result.success) {
        console.log('✅ Service stopped successfully!');
      }
      
    } catch (error) {
      console.error('❌ Failed to stop service:', error.message);
      process.exit(1);
    }
  });

serviceCmd
  .command('restart')
  .description('Restart a service')
  .argument('<service>', 'Service name')
  .option('-e, --environment <env>', 'Target environment', 'development')
  .action(async (serviceName, options) => {
    try {
      console.log(`🔄 Restarting service: ${serviceName} in ${options.environment}...`);
      
      // Stop service
      await deploymentManager.stopService(options.environment, serviceName);
      
      // Wait a moment
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Start service
      await deploymentManager.startService(options.environment, serviceName);
      
      // Wait for readiness
      await deploymentManager.waitForServiceReady(options.environment, serviceName);
      
      console.log('✅ Service restarted successfully!');
      
    } catch (error) {
      console.error('❌ Failed to restart service:', error.message);
      process.exit(1);
    }
  });

serviceCmd
  .command('health')
  .description('Check service health')
  .argument('<service>', 'Service name')
  .option('-e, --environment <env>', 'Target environment', 'development')
  .action(async (serviceName, options) => {
    try {
      console.log(`🔍 Checking health of ${serviceName} in ${options.environment}...`);
      
      const healthResult = await deploymentManager.performHealthCheck(options.environment, serviceName);
      
      if (healthResult.healthy) {
        console.log('✅ Service is healthy!');
        
        if (healthResult.responseTime) {
          console.log(`   Response time: ${Math.round(healthResult.responseTime)}ms`);
        }
        
        if (healthResult.status) {
          console.log(`   HTTP status: ${healthResult.status}`);
        }
        
        if (healthResult.url) {
          console.log(`   Health URL: ${healthResult.url}`);
        }
      } else {
        console.log('❌ Service is unhealthy!');
        
        if (healthResult.error) {
          console.log(`   Error: ${healthResult.error}`);
        }
        
        process.exit(1);
      }
      
    } catch (error) {
      console.error('❌ Health check failed:', error.message);
      process.exit(1);
    }
  });

/**
 * Configuration command
 */
program
  .command('config')
  .description('Show deployment configuration')
  .option('--json', 'Output in JSON format')
  .action(async (options) => {
    try {
      const config = {
        deploymentStrategy: deploymentManager.options.deploymentStrategy,
        healthCheckTimeout: deploymentManager.options.healthCheckTimeout,
        rollbackTimeout: deploymentManager.options.rollbackTimeout,
        maxRetries: deploymentManager.options.maxRetries,
        environments: deploymentManager.options.environments,
        defaultEnvironment: deploymentManager.options.defaultEnvironment
      };
      
      if (options.json) {
        console.log(JSON.stringify(config, null, 2));
        return;
      }
      
      console.log('⚙️  Deployment Configuration\n');
      console.log(`Default Strategy: ${config.deploymentStrategy}`);
      console.log(`Health Check Timeout: ${Math.round(config.healthCheckTimeout / 1000)}s`);
      console.log(`Rollback Timeout: ${Math.round(config.rollbackTimeout / 1000)}s`);
      console.log(`Max Retries: ${config.maxRetries}`);
      console.log(`Default Environment: ${config.defaultEnvironment}`);
      console.log(`Available Environments: ${config.environments.join(', ')}`);
      
    } catch (error) {
      console.error('❌ Failed to get configuration:', error.message);
      process.exit(1);
    }
  });

// Parse command line arguments
program
  .name('deploy')
  .description('PoppoBuilder Deployment Tool')
  .version('1.0.0');

program.parse();

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught exception:', error.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled rejection at:', promise, 'reason:', reason);
  process.exit(1);
});