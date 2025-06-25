# Issue #275: Add process monitoring and alerting system

## Overview
Implemented a comprehensive process monitoring and alerting system to track system health, detect anomalies, and provide early warnings for potential issues.

## Implementation Details

### 1. ProcessMonitor Class (`src/process-monitor.js`)
Created a new monitoring system with the following features:
- Real-time metrics collection (process count, queue size, error rates, resource usage)
- Configurable thresholds for various metrics
- Alert generation with cooldown periods
- Historical data tracking for trend analysis
- Event-based architecture for integration

### 2. Metrics Tracked
- **Process Count**: Number of running processes
- **Queue Size**: Number of pending tasks
- **Lock Failure Rate**: Percentage of failed lock acquisitions
- **Error Rate**: Percentage of failed tasks
- **Memory Usage**: System memory utilization
- **CPU Usage**: System CPU utilization

### 3. Alert System
- Alerts generated when thresholds are exceeded
- Cooldown period to prevent alert flooding
- Automatic alert clearing when metrics return to normal
- Integration with NotificationManager

### 4. Integration Points

#### Task Queue Integration
- Added event emissions for lock attempts and failures
- ProcessMonitor listens to these events to track lock statistics

#### Dashboard Integration
- New `/api/monitoring/stats` endpoint for real-time monitoring data
- WebSocket broadcasting of monitoring events
- Real-time alerts pushed to connected clients

#### Main Process Integration
- Monitoring started automatically when enabled
- Task attempts and errors recorded
- Alert handlers configured to send notifications

### 5. Configuration
Added monitoring configuration to `config.example.json`:
```json
"monitoring": {
  "enabled": true,
  "checkInterval": 30000,
  "alertCooldown": 300000,
  "thresholds": {
    "processCount": 10,
    "queueSize": 50,
    "lockFailureRate": 0.3,
    "errorRate": 0.1,
    "memoryUsage": 0.8,
    "cpuUsage": 0.9
  }
}
```

### 6. Testing
Created comprehensive test suite (`test/process-monitor.test.js`) covering:
- Initialization and configuration
- Metrics recording
- Rate calculations
- Alert generation and cooldown
- Trend analysis
- Health check integration

## Benefits
1. **Early Problem Detection**: Identify issues before they become critical
2. **Performance Insights**: Track system performance over time
3. **Automatic Alerting**: Get notified of problems in real-time
4. **Historical Analysis**: Analyze trends to identify patterns
5. **Dashboard Integration**: Visual monitoring through web interface

## Usage
The monitoring system starts automatically when PoppoBuilder starts (if enabled). Alerts are sent through the configured notification channels and displayed in the dashboard.

## Future Enhancements
- Custom metric plugins
- Predictive alerting based on trends
- Metric export for external monitoring systems
- Performance optimization recommendations