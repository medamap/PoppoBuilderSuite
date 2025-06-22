#!/usr/bin/env node

/**
 * Issue #132: Start Monitoring System
 * 
 * Script to start the complete monitoring and alerting system
 */

const path = require('path');
const config = require('../config/config.json');
const MetricsCollector = require('../lib/monitoring/metrics-collector');
const AlertManager = require('../lib/monitoring/alert-manager');
const MonitoringDashboard = require('../lib/monitoring/monitoring-dashboard');
const ProductionLogger = require('../lib/utils/production-logger');

// Initialize logger
const logger = new ProductionLogger('MonitoringSystem', {
  enableStructuredLogging: true
});

// Create instances
const metricsCollector = new MetricsCollector({
  collectionInterval: 10000, // 10 seconds
  retentionPeriod: 86400000, // 24 hours
  enableSystemMetrics: true,
  enableApplicationMetrics: true,
  enableBusinessMetrics: true,
  prometheusEnabled: true
});

const alertManager = new AlertManager({
  evaluationInterval: 30000, // 30 seconds
  aggregationWindow: 300000, // 5 minutes
  cooldownPeriod: 3600000, // 1 hour
  maxAlertsPerRule: 10,
  enableNotifications: true
});

const monitoringDashboard = new MonitoringDashboard({
  port: config.monitoring?.dashboardPort || 3004,
  host: config.monitoring?.dashboardHost || 'localhost',
  updateInterval: 5000, // 5 seconds
  enableAuth: config.monitoring?.dashboardAuth || false,
  username: config.monitoring?.dashboardUsername || 'admin',
  password: config.monitoring?.dashboardPassword || 'changeme'
});

// Graceful shutdown
let isShuttingDown = false;

async function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  logger.info('Shutting down monitoring system...');
  
  try {
    // Stop components in reverse order
    await monitoringDashboard.stop();
    await alertManager.stop();
    await metricsCollector.stop();
    
    logger.info('Monitoring system shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', { error });
    process.exit(1);
  }
}

// Handle signals
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error });
  shutdown();
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection', { reason, promise });
  shutdown();
});

/**
 * Start monitoring system
 */
async function start() {
  try {
    logger.info('Starting monitoring system...');
    
    // Start metrics collector
    await metricsCollector.start();
    logger.info('Metrics collector started');
    
    // Start alert manager
    await alertManager.start(metricsCollector);
    logger.info('Alert manager started');
    
    // Start monitoring dashboard
    await monitoringDashboard.start(metricsCollector, alertManager);
    logger.info('Monitoring dashboard started');
    
    // Log access information
    console.log('\n✅ Monitoring system started successfully!\n');
    console.log(`📊 Dashboard: http://${monitoringDashboard.options.host}:${monitoringDashboard.options.port}`);
    console.log(`📈 Prometheus metrics: http://${monitoringDashboard.options.host}:${monitoringDashboard.options.port}/api/metrics/prometheus`);
    
    if (monitoringDashboard.options.enableAuth) {
      console.log(`\n🔐 Authentication enabled`);
      console.log(`   Username: ${monitoringDashboard.options.username}`);
      console.log(`   Password: ${monitoringDashboard.options.password}`);
    }
    
    console.log('\n📋 Available endpoints:');
    console.log('   GET  /api/health              - Health check');
    console.log('   GET  /api/metrics/current     - Current metrics');
    console.log('   GET  /api/metrics/history     - Historical metrics');
    console.log('   GET  /api/alerts/active       - Active alerts');
    console.log('   GET  /api/alerts/statistics   - Alert statistics');
    console.log('   POST /api/alerts/:id/suppress - Suppress alert');
    console.log('   GET  /api/export/metrics      - Export metrics');
    
    console.log('\n💡 Tips:');
    console.log('   - Use Ctrl+C to stop the monitoring system');
    console.log('   - Metrics are collected every 10 seconds');
    console.log('   - Alerts are evaluated every 30 seconds');
    console.log('   - Dashboard updates in real-time via WebSocket');
    
  } catch (error) {
    logger.error('Failed to start monitoring system', { error });
    process.exit(1);
  }
}

// Add some example custom metrics and alerts
function setupExampleMetrics() {
  // Example custom metrics
  metricsCollector.registerCounter('custom_events_total', 'Total custom events');
  metricsCollector.registerGauge('custom_active_users', 'Number of active users');
  metricsCollector.registerHistogram('custom_operation_duration', 'Custom operation duration');
  
  // Example custom alert
  alertManager.addAlertRule({
    id: 'custom_high_event_rate',
    name: 'High Custom Event Rate',
    condition: (metrics) => {
      const eventRate = metricsCollector.counters.get('custom_events_total')?.value || 0;
      return eventRate > 1000;
    },
    severity: 'warning',
    threshold: 1000,
    description: 'Custom event rate is above 1000',
    labels: {
      category: 'custom',
      metric: 'event_rate'
    }
  });
  
  // Simulate some metrics
  setInterval(() => {
    // Increment custom counter
    metricsCollector.incrementCounter('custom_events_total', Math.floor(Math.random() * 10));
    
    // Update custom gauge
    metricsCollector.setGauge('custom_active_users', Math.floor(Math.random() * 100));
    
    // Record custom histogram
    metricsCollector.observeHistogram('custom_operation_duration', Math.random() * 5);
  }, 5000);
}

// Run
if (require.main === module) {
  start().then(() => {
    // Setup example metrics after startup
    setupExampleMetrics();
  });
}