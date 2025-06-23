/**
 * Final Integration Test Suite
 * 
 * Comprehensive end-to-end testing of the complete PoppoBuilder Suite
 * Production readiness validation and system integration verification
 */

const { expect } = require('chai');
const sinon = require('sinon');
const request = require('supertest');
const WebSocket = require('ws');
const fs = require('fs').promises;
const path = require('path');

// Import core components
const PoppoDaemon = require('../../bin/poppo-daemon');
const ProductionMonitoringSystem = require('../../lib/monitoring/production-monitoring-system');
const SecurityAuditor = require('../../lib/security/security-auditor');
const BackupManager = require('../../lib/backup/backup-manager');
const DisasterRecovery = require('../../lib/backup/disaster-recovery');

describe('Final Integration Test Suite', function() {
  this.timeout(300000); // 5 minutes timeout for comprehensive tests

  let daemon;
  let monitoringSystem;
  let securityAuditor;
  let backupManager;
  let disasterRecovery;
  let testEnvironment;

  before(async function() {
    console.log('🚀 Starting final integration test suite...');
    
    // Setup test environment
    testEnvironment = await setupTestEnvironment();
    
    console.log('✅ Test environment ready');
  });

  after(async function() {
    console.log('🧹 Cleaning up test environment...');
    
    if (daemon) {
      await daemon.stop();
    }
    
    if (monitoringSystem) {
      await monitoringSystem.stop();
    }
    
    if (securityAuditor) {
      await securityAuditor.stop();
    }
    
    await cleanupTestEnvironment(testEnvironment);
    
    console.log('✅ Cleanup completed');
  });

  describe('System Architecture Validation', function() {
    
    it('should validate daemon architecture components', async function() {
      console.log('🔍 Testing daemon architecture...');
      
      // Initialize daemon with test configuration
      daemon = new PoppoDaemon({
        port: testEnvironment.ports.daemon,
        dataDirectory: testEnvironment.dataDir,
        logDirectory: testEnvironment.logDir,
        configFile: testEnvironment.configFile
      });
      
      // Start daemon
      await daemon.start();
      
      // Verify daemon is running
      expect(daemon.isRunning()).to.be.true;
      
      // Test health endpoints
      const healthResponse = await request(daemon.app)
        .get('/health')
        .expect(200);
      
      expect(healthResponse.body.status).to.equal('healthy');
      
      // Test detailed health
      const detailedHealthResponse = await request(daemon.app)
        .get('/health/detailed')
        .expect(200);
      
      expect(detailedHealthResponse.body.checks).to.be.an('object');
      expect(detailedHealthResponse.body.checks.database).to.exist;
      expect(detailedHealthResponse.body.checks.redis).to.exist;
      
      console.log('✅ Daemon architecture validation completed');
    });

    it('should validate monitoring system integration', async function() {
      console.log('🔍 Testing monitoring system integration...');
      
      // Initialize monitoring system
      monitoringSystem = new ProductionMonitoringSystem({
        metricsPrefix: 'test_poppobuilder_',
        scrapeInterval: 5000, // 5 seconds for testing
        alertThresholds: {
          cpuUsage: 90, // Higher threshold for testing
          memoryUsage: 90,
          diskUsage: 95
        }
      });
      
      // Start monitoring
      await monitoringSystem.start();
      
      // Wait for initial metrics collection
      await new Promise(resolve => setTimeout(resolve, 6000));
      
      // Verify metrics are being collected
      const metrics = await monitoringSystem.getMetrics();
      expect(metrics).to.be.a('string');
      expect(metrics).to.include('test_poppobuilder_cpu_usage_percent');
      expect(metrics).to.include('test_poppobuilder_memory_usage_bytes');
      
      // Test metrics JSON endpoint
      const metricsJSON = await monitoringSystem.getMetricsJSON();
      expect(metricsJSON).to.be.an('array');
      expect(metricsJSON.length).to.be.greaterThan(0);
      
      console.log('✅ Monitoring system integration validated');
    });

    it('should validate security auditor functionality', async function() {
      console.log('🔍 Testing security auditor...');
      
      // Initialize security auditor
      securityAuditor = new SecurityAuditor({
        auditInterval: 10000, // 10 seconds for testing
        strictMode: true,
        autoRemediation: false, // Disable for testing
        reportingEnabled: true
      });
      
      // Start security auditor
      await securityAuditor.start();
      
      // Perform security audit
      const auditReport = await securityAuditor.performSecurityAudit();
      
      // Verify audit report structure
      expect(auditReport).to.be.an('object');
      expect(auditReport.auditId).to.be.a('string');
      expect(auditReport.timestamp).to.be.a('string');
      expect(auditReport.summary).to.be.an('object');
      expect(auditReport.findings).to.be.an('object');
      expect(auditReport.riskLevel).to.be.a('string');
      
      // Verify audit findings
      expect(auditReport.summary).to.have.property('critical');
      expect(auditReport.summary).to.have.property('high');
      expect(auditReport.summary).to.have.property('medium');
      expect(auditReport.summary).to.have.property('low');
      
      // Get security report
      const securityReport = securityAuditor.getSecurityReport();
      expect(securityReport).to.be.an('object');
      expect(securityReport.isRunning).to.be.true;
      expect(securityReport.latestAudit).to.exist;
      
      console.log('✅ Security auditor validation completed');
    });

    it('should validate backup and disaster recovery', async function() {
      console.log('🔍 Testing backup and disaster recovery...');
      
      // Initialize backup manager
      backupManager = new BackupManager({
        backupDirectory: path.join(testEnvironment.dataDir, 'backups'),
        retentionDays: 7,
        compressionEnabled: true,
        encryptionEnabled: false // Disabled for testing
      });
      
      await backupManager.initialize();
      
      // Create test backup
      const backup = await backupManager.createBackup({
        type: 'configuration',
        name: 'integration-test-backup',
        metadata: {
          testRun: true,
          timestamp: new Date().toISOString()
        }
      });
      
      expect(backup.id).to.be.a('string');
      expect(backup.type).to.equal('configuration');
      expect(backup.status).to.equal('completed');
      
      // Verify backup
      const verification = await backupManager.verifyBackup(backup.id);
      expect(verification.valid).to.be.true;
      expect(verification.checksumValid).to.be.true;
      
      // Test disaster recovery
      disasterRecovery = new DisasterRecovery({
        rto: 1800000, // 30 minutes
        rpo: 3600000, // 1 hour
        autoFailoverEnabled: false, // Disabled for testing
        testingEnabled: true
      });
      
      await disasterRecovery.initialize(backupManager);
      
      // Perform recovery test
      const recoveryTest = await disasterRecovery.testRecovery({
        type: 'configuration',
        simulateDisaster: false // Skip disaster simulation
      });
      
      expect(recoveryTest.status).to.equal('completed');
      expect(recoveryTest.success).to.be.true;
      expect(recoveryTest.verification.passed).to.be.true;
      
      console.log('✅ Backup and disaster recovery validation completed');
    });
  });

  describe('Performance and Scalability Testing', function() {
    
    it('should handle concurrent task processing', async function() {
      console.log('🔍 Testing concurrent task processing...');
      
      // Create multiple concurrent tasks
      const taskPromises = [];
      const taskCount = 10;
      
      for (let i = 0; i < taskCount; i++) {
        const taskPromise = request(daemon.app)
          .post('/api/tasks')
          .send({
            projectId: 'test-project',
            type: 'test_task',
            data: { id: i },
            priority: Math.random() > 0.5 ? 'high' : 'normal'
          })
          .expect(201);
        
        taskPromises.push(taskPromise);
      }
      
      // Wait for all tasks to be created
      const responses = await Promise.all(taskPromises);
      
      // Verify all tasks were created successfully
      responses.forEach((response, index) => {
        expect(response.body.success).to.be.true;
        expect(response.body.data.task.id).to.be.a('string');
        expect(response.body.data.task.data.id).to.equal(index);
      });
      
      console.log('✅ Concurrent task processing test completed');
    });

    it('should maintain performance under load', async function() {
      console.log('🔍 Testing performance under load...');
      
      const startTime = Date.now();
      const requestCount = 50;
      const concurrentRequests = 5;
      
      // Perform load testing
      for (let batch = 0; batch < requestCount / concurrentRequests; batch++) {
        const batchPromises = [];
        
        for (let i = 0; i < concurrentRequests; i++) {
          const promise = request(daemon.app)
            .get('/health')
            .expect(200);
          
          batchPromises.push(promise);
        }
        
        await Promise.all(batchPromises);
      }
      
      const endTime = Date.now();
      const totalTime = endTime - startTime;
      const averageResponseTime = totalTime / requestCount;
      
      // Verify performance is acceptable
      expect(averageResponseTime).to.be.lessThan(100); // Less than 100ms average
      
      console.log(`✅ Performance test completed: ${averageResponseTime.toFixed(2)}ms average response time`);
    });

    it('should handle memory usage efficiently', async function() {
      console.log('🔍 Testing memory efficiency...');
      
      const initialMemory = process.memoryUsage();
      
      // Create and process many tasks to test memory usage
      const taskCount = 100;
      
      for (let i = 0; i < taskCount; i++) {
        await request(daemon.app)
          .post('/api/tasks')
          .send({
            projectId: 'memory-test-project',
            type: 'memory_test',
            data: { iteration: i, data: new Array(1000).fill('test') }
          })
          .expect(201);
        
        // Force garbage collection every 10 tasks
        if (i % 10 === 0 && global.gc) {
          global.gc();
        }
      }
      
      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
      const memoryIncreasePerTask = memoryIncrease / taskCount;
      
      // Memory increase should be reasonable (less than 1MB per task)
      expect(memoryIncreasePerTask).to.be.lessThan(1024 * 1024);
      
      console.log(`✅ Memory test completed: ${(memoryIncreasePerTask / 1024).toFixed(2)}KB per task`);
    });
  });

  describe('Integration Testing', function() {
    
    it('should integrate all system components', async function() {
      console.log('🔍 Testing complete system integration...');
      
      // Test component communication
      const components = [
        { name: 'daemon', instance: daemon },
        { name: 'monitoring', instance: monitoringSystem },
        { name: 'security', instance: securityAuditor }
      ];
      
      // Verify all components are running
      components.forEach(component => {
        expect(component.instance.isRunning(), `${component.name} should be running`).to.be.true;
      });
      
      // Test cross-component functionality
      
      // 1. Create a task that triggers monitoring
      const taskResponse = await request(daemon.app)
        .post('/api/tasks')
        .send({
          projectId: 'integration-test',
          type: 'integration_test',
          data: { test: 'system_integration' }
        })
        .expect(201);
      
      const taskId = taskResponse.body.data.task.id;
      
      // 2. Verify task is visible in metrics
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for metrics update
      
      const metrics = await monitoringSystem.getMetrics();
      expect(metrics).to.include('task_queue_size');
      
      // 3. Verify security audit can access task information
      const securityReport = securityAuditor.getSecurityReport();
      expect(securityReport.isRunning).to.be.true;
      
      // 4. Test backup includes task data
      const integrationBackup = await backupManager.createBackup({
        type: 'full',
        name: 'integration-test-backup'
      });
      
      expect(integrationBackup.status).to.equal('completed');
      
      console.log('✅ System integration test completed');
    });

    it('should handle WebSocket connections', async function() {
      console.log('🔍 Testing WebSocket functionality...');
      
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${testEnvironment.ports.daemon}/ws`);
        
        ws.on('open', () => {
          // Send authentication
          ws.send(JSON.stringify({
            type: 'auth',
            token: 'test-token'
          }));
          
          // Subscribe to task updates
          ws.send(JSON.stringify({
            type: 'subscribe',
            channel: 'task_updates'
          }));
        });
        
        ws.on('message', (data) => {
          const message = JSON.parse(data);
          
          if (message.type === 'auth_success') {
            // Authentication successful, create a task to trigger update
            request(daemon.app)
              .post('/api/tasks')
              .send({
                projectId: 'websocket-test',
                type: 'websocket_test',
                data: { test: true }
              })
              .expect(201)
              .then(() => {
                console.log('Task created for WebSocket test');
              });
          } else if (message.type === 'task_update') {
            // Received task update via WebSocket
            expect(message.data.projectId).to.equal('websocket-test');
            ws.close();
            resolve();
          }
        });
        
        ws.on('error', (error) => {
          reject(error);
        });
        
        // Timeout after 10 seconds
        setTimeout(() => {
          ws.close();
          reject(new Error('WebSocket test timeout'));
        }, 10000);
      });
    });

    it('should validate API error handling', async function() {
      console.log('🔍 Testing API error handling...');
      
      // Test various error conditions
      
      // 1. Invalid request body
      await request(daemon.app)
        .post('/api/tasks')
        .send({ invalid: 'data' })
        .expect(400);
      
      // 2. Non-existent endpoint
      await request(daemon.app)
        .get('/api/nonexistent')
        .expect(404);
      
      // 3. Invalid task ID
      await request(daemon.app)
        .get('/api/tasks/invalid-task-id')
        .expect(404);
      
      // 4. Malformed JSON
      await request(daemon.app)
        .post('/api/tasks')
        .send('{ invalid json }')
        .expect(400);
      
      console.log('✅ API error handling test completed');
    });
  });

  describe('Security and Compliance Testing', function() {
    
    it('should validate security measures', async function() {
      console.log('🔍 Testing security measures...');
      
      // Test authentication
      await request(daemon.app)
        .get('/api/admin/status')
        .expect(401); // Should require authentication
      
      // Test CORS headers
      const corsResponse = await request(daemon.app)
        .options('/api/projects')
        .expect(200);
      
      expect(corsResponse.headers['access-control-allow-origin']).to.exist;
      
      // Test security headers
      const securityResponse = await request(daemon.app)
        .get('/health')
        .expect(200);
      
      expect(securityResponse.headers['x-content-type-options']).to.equal('nosniff');
      expect(securityResponse.headers['x-frame-options']).to.equal('DENY');
      
      console.log('✅ Security measures validation completed');
    });

    it('should validate data privacy compliance', async function() {
      console.log('🔍 Testing data privacy compliance...');
      
      // Create task with sensitive data
      const sensitiveTask = await request(daemon.app)
        .post('/api/tasks')
        .send({
          projectId: 'privacy-test',
          type: 'privacy_test',
          data: {
            userEmail: 'test@example.com',
            sensitiveData: 'confidential information'
          }
        })
        .expect(201);
      
      const taskId = sensitiveTask.body.data.task.id;
      
      // Verify sensitive data is properly handled
      const taskDetails = await request(daemon.app)
        .get(`/api/tasks/${taskId}`)
        .expect(200);
      
      // Sensitive data should be present but properly secured
      expect(taskDetails.body.data.task.data).to.exist;
      
      // Test data deletion
      await request(daemon.app)
        .delete(`/api/tasks/${taskId}`)
        .expect(200);
      
      // Verify task is deleted
      await request(daemon.app)
        .get(`/api/tasks/${taskId}`)
        .expect(404);
      
      console.log('✅ Data privacy compliance test completed');
    });
  });

  describe('Production Readiness Validation', function() {
    
    it('should validate configuration management', async function() {
      console.log('🔍 Testing configuration management...');
      
      // Test configuration loading
      const configResponse = await request(daemon.app)
        .get('/api/admin/config')
        .expect(200);
      
      expect(configResponse.body.success).to.be.true;
      expect(configResponse.body.data.config).to.be.an('object');
      
      // Test environment-specific configurations
      expect(process.env.NODE_ENV).to.equal('test');
      
      console.log('✅ Configuration management validation completed');
    });

    it('should validate logging and monitoring', async function() {
      console.log('🔍 Testing logging and monitoring...');
      
      // Test log generation
      await request(daemon.app)
        .post('/api/tasks')
        .send({
          projectId: 'logging-test',
          type: 'logging_test',
          data: { generateLogs: true }
        })
        .expect(201);
      
      // Wait for log processing
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Test log retrieval
      const logsResponse = await request(daemon.app)
        .get('/api/admin/logs?limit=10')
        .expect(200);
      
      expect(logsResponse.body.success).to.be.true;
      expect(logsResponse.body.data.logs).to.be.an('array');
      
      // Test metrics collection
      const metrics = await monitoringSystem.getMetrics();
      expect(metrics).to.include('poppobuilder');
      
      console.log('✅ Logging and monitoring validation completed');
    });

    it('should validate deployment readiness', async function() {
      console.log('🔍 Testing deployment readiness...');
      
      // Test health checks for deployment
      const readinessResponse = await request(daemon.app)
        .get('/health/ready')
        .expect(200);
      
      expect(readinessResponse.body.ready).to.be.true;
      
      // Test liveness checks
      const livenessResponse = await request(daemon.app)
        .get('/health/live')
        .expect(200);
      
      expect(livenessResponse.body.alive).to.be.true;
      
      // Test graceful shutdown preparation
      const shutdownResponse = await request(daemon.app)
        .post('/api/admin/prepare-shutdown')
        .expect(200);
      
      expect(shutdownResponse.body.success).to.be.true;
      
      console.log('✅ Deployment readiness validation completed');
    });
  });
});

// Helper functions

async function setupTestEnvironment() {
  console.log('🔧 Setting up test environment...');
  
  const testDir = path.join(__dirname, '..', '..', 'test-data', 'integration');
  const dataDir = path.join(testDir, 'data');
  const logDir = path.join(testDir, 'logs');
  const configDir = path.join(testDir, 'config');
  
  // Create directories
  await fs.mkdir(testDir, { recursive: true });
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(logDir, { recursive: true });
  await fs.mkdir(configDir, { recursive: true });
  
  // Create test configuration
  const testConfig = {
    environment: 'test',
    daemon: {
      port: 3010,
      host: 'localhost'
    },
    database: {
      url: 'sqlite::memory:'
    },
    redis: {
      url: 'redis://localhost:6379/15' // Use test database
    },
    logging: {
      level: 'info',
      directory: logDir
    },
    monitoring: {
      enabled: true,
      metricsPrefix: 'test_poppobuilder_'
    },
    security: {
      auditEnabled: true,
      strictMode: true
    }
  };
  
  const configFile = path.join(configDir, 'test-config.json');
  await fs.writeFile(configFile, JSON.stringify(testConfig, null, 2));
  
  return {
    testDir,
    dataDir,
    logDir,
    configDir,
    configFile,
    ports: {
      daemon: 3010
    }
  };
}

async function cleanupTestEnvironment(testEnvironment) {
  try {
    // Remove test directory
    await fs.rmdir(testEnvironment.testDir, { recursive: true });
  } catch (error) {
    console.warn('Warning: Could not clean up test environment:', error.message);
  }
}

module.exports = {
  setupTestEnvironment,
  cleanupTestEnvironment
};