# PoppoBuilder Suite - Production Operations Guide

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Deployment](#deployment)
4. [Monitoring](#monitoring)
5. [Backup & Recovery](#backup--recovery)
6. [Security](#security)
7. [Troubleshooting](#troubleshooting)
8. [Maintenance](#maintenance)

## Overview

PoppoBuilder Suite is a production-ready AI-powered task automation system designed for enterprise environments. This guide covers all aspects of production operations including deployment, monitoring, maintenance, and troubleshooting.

### Key Features
- **Daemon Architecture**: Centralized management of multiple projects
- **High Availability**: Automatic failover and recovery
- **Comprehensive Monitoring**: Prometheus metrics and alerting
- **Security**: Multi-layer security with auditing and compliance
- **Scalability**: Horizontal scaling support with load balancing

### System Requirements
- **CPU**: 4+ cores recommended
- **Memory**: 8GB+ RAM
- **Storage**: 100GB+ SSD storage
- **Network**: Stable internet connection
- **OS**: Linux (Ubuntu 20.04+ recommended), macOS, Windows

## Architecture

### Component Overview
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  Load Balancer  │────│  PoppoBuilder   │────│   PostgreSQL    │
│    (Nginx)      │    │     Daemon      │    │    Database     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │              ┌─────────────────┐              │
         └──────────────│     Redis       │──────────────┘
                        │    (Cache)      │
                        └─────────────────┘
                                 │
                        ┌─────────────────┐
                        │   Monitoring    │
                        │   (Prometheus)  │
                        └─────────────────┘
```

### Service Components
- **PoppoBuilder Daemon**: Main application service
- **PostgreSQL**: Primary database for persistent data
- **Redis**: Caching and session management
- **Prometheus**: Metrics collection
- **Grafana**: Metrics visualization
- **AlertManager**: Alert routing and notifications
- **Nginx**: Load balancing and reverse proxy

## Deployment

### Production Deployment with Docker Compose

1. **Clone Repository**
   ```bash
   git clone https://github.com/your-org/PoppoBuilderSuite.git
   cd PoppoBuilderSuite
   ```

2. **Configure Environment**
   ```bash
   cp .env.example .env.production
   # Edit .env.production with your settings
   ```

3. **Deploy Services**
   ```bash
   docker-compose -f docker-compose.prod.yml up -d
   ```

4. **Verify Deployment**
   ```bash
   # Check service health
   docker-compose -f docker-compose.prod.yml ps
   
   # Check logs
   docker-compose -f docker-compose.prod.yml logs poppobuilder
   ```

### Kubernetes Deployment

1. **Apply Configurations**
   ```bash
   kubectl apply -f k8s/namespace.yaml
   kubectl apply -f k8s/
   ```

2. **Verify Deployment**
   ```bash
   kubectl get pods -n poppobuilder
   kubectl get services -n poppobuilder
   ```

### Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `NODE_ENV` | Environment mode | production | Yes |
| `DATABASE_URL` | PostgreSQL connection string | - | Yes |
| `REDIS_URL` | Redis connection string | - | Yes |
| `GITHUB_TOKEN` | GitHub API token | - | Yes |
| `CLAUDE_API_KEY` | Claude API key | - | Yes |
| `POPPO_PORT` | Application port | 3000 | No |
| `POPPO_LOG_LEVEL` | Log level | info | No |

## Monitoring

### Health Checks

The system provides multiple health check endpoints:

- **Basic Health**: `GET /health`
- **Detailed Health**: `GET /health/detailed`
- **Readiness**: `GET /health/ready`
- **Liveness**: `GET /health/live`

### Metrics

Key metrics to monitor:

#### System Metrics
- CPU usage percentage
- Memory usage (heap and system)
- Disk usage percentage
- Network I/O

#### Application Metrics
- HTTP request rate and latency
- Task queue size and processing rate
- Error rate and error types
- GitHub API rate limit usage
- Claude API usage and token consumption

#### Database Metrics
- Connection pool usage
- Query performance
- Database size and growth

### Prometheus Configuration

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'poppobuilder'
    static_configs:
      - targets: ['poppobuilder:3000']
    metrics_path: '/metrics'
    scrape_interval: 15s
```

### Grafana Dashboards

Import the provided dashboards:
- **System Overview**: Overall system health and performance
- **Application Metrics**: Task processing and API usage
- **Database Performance**: Database metrics and query analysis
- **Security Dashboard**: Security events and audit information

### Alerting Rules

Critical alerts are configured for:
- High CPU usage (>80% for 5 minutes)
- High memory usage (>85% for 5 minutes)
- Disk space critical (>90%)
- Service down or unhealthy
- High error rate (>5% for 5 minutes)
- GitHub rate limit low (<100 requests)
- Database connection issues

## Backup & Recovery

### Automated Backups

The system automatically creates backups:
- **Full backups**: Daily at 2 AM
- **Configuration backups**: Before each deployment
- **Database backups**: Every 6 hours
- **Retention**: 30 days (configurable)

### Manual Backup

```bash
# Create full backup
./scripts/backup-restore.sh backup --type full --compress --encrypt

# Create database-only backup
./scripts/backup-restore.sh backup --type database

# List available backups
./scripts/backup-restore.sh list
```

### Disaster Recovery

1. **Assess the Situation**
   - Determine the scope of the failure
   - Identify the last known good state

2. **Select Recovery Point**
   ```bash
   # List available backups
   ./scripts/backup-restore.sh list
   
   # Verify backup integrity
   ./scripts/backup-restore.sh verify --file backup-20231201-120000.tar.gz
   ```

3. **Execute Recovery**
   ```bash
   # Stop services
   docker-compose -f docker-compose.prod.yml down
   
   # Restore from backup
   ./scripts/backup-restore.sh restore --file backup-20231201-120000.tar.gz
   
   # Start services
   docker-compose -f docker-compose.prod.yml up -d
   ```

4. **Verify Recovery**
   - Check service health endpoints
   - Verify data integrity
   - Run smoke tests

### Recovery Time Objectives (RTO)
- **Database failure**: < 30 minutes
- **Application failure**: < 15 minutes
- **Complete system failure**: < 2 hours

### Recovery Point Objectives (RPO)
- **Configuration data**: < 1 hour
- **Application data**: < 6 hours
- **Logs and metrics**: < 24 hours

## Security

### Security Monitoring

The system continuously monitors for:
- **Vulnerability scanning**: Dependencies and system packages
- **Access control violations**: Unauthorized access attempts
- **Configuration drift**: Changes to security settings
- **Threat indicators**: Suspicious activity patterns

### Security Audits

Automated security audits run every hour and check:
- File permissions and ownership
- Dependency vulnerabilities
- Configuration security
- API key exposure
- Network security
- Container security

### Access Control

- **Multi-factor authentication**: Required for admin access
- **Role-based access control**: Granular permissions
- **API authentication**: Token-based with rotation
- **Audit logging**: Complete access trail

### Compliance

The system supports compliance with:
- **SOC 2**: Security and availability controls
- **GDPR**: Data protection and privacy
- **HIPAA**: Healthcare data security (when applicable)
- **PCI DSS**: Payment card data security (when applicable)

## Troubleshooting

### Common Issues

#### High CPU Usage
```bash
# Check process resource usage
docker exec poppobuilder top -p 1

# Check for CPU-intensive tasks
curl http://localhost:3000/api/tasks/running

# Scale horizontally if needed
docker-compose -f docker-compose.prod.yml up -d --scale poppobuilder=3
```

#### Memory Leaks
```bash
# Monitor memory usage
curl http://localhost:3000/metrics | grep memory

# Generate heap dump for analysis
docker exec poppobuilder kill -USR2 1

# Restart service if critical
docker-compose -f docker-compose.prod.yml restart poppobuilder
```

#### Database Connection Issues
```bash
# Check database connectivity
docker exec poppobuilder pg_isready -h postgres -p 5432

# Check connection pool status
curl http://localhost:3000/health/detailed

# Restart database if needed
docker-compose -f docker-compose.prod.yml restart postgres
```

#### GitHub API Rate Limits
```bash
# Check current rate limit status
curl -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/rate_limit

# Monitor rate limit metrics
curl http://localhost:3000/metrics | grep github_rate_limit

# Implement request batching or delay processing
```

### Performance Optimization

#### Database Optimization
- Monitor slow queries
- Optimize indexes
- Configure connection pooling
- Implement query caching

#### Application Optimization
- Profile CPU and memory usage
- Optimize task processing algorithms
- Implement caching strategies
- Use database read replicas

#### Infrastructure Optimization
- Scale services horizontally
- Optimize container resource limits
- Use CDN for static assets
- Implement load balancing

### Log Analysis

#### Log Locations
- **Application logs**: `/var/log/poppobuilder/`
- **System logs**: `/var/log/syslog`
- **Container logs**: `docker logs <container>`

#### Log Levels
- **ERROR**: Critical errors requiring immediate attention
- **WARN**: Warning conditions that should be monitored
- **INFO**: Normal operational messages
- **DEBUG**: Detailed debugging information

#### Structured Logging
```json
{
  "timestamp": "2023-12-01T12:00:00Z",
  "level": "INFO",
  "component": "TaskProcessor",
  "message": "Task completed successfully",
  "taskId": "task-123",
  "duration": 1500,
  "correlationId": "req-456"
}
```

## Maintenance

### Regular Maintenance Tasks

#### Daily
- [ ] Check system health dashboard
- [ ] Review error logs
- [ ] Verify backup completion
- [ ] Monitor resource usage

#### Weekly
- [ ] Review security audit reports
- [ ] Update dependencies (if needed)
- [ ] Clean up old logs and temporary files
- [ ] Performance review and optimization

#### Monthly
- [ ] Full system security audit
- [ ] Disaster recovery testing
- [ ] Capacity planning review
- [ ] Update documentation

#### Quarterly
- [ ] Major dependency updates
- [ ] Infrastructure review and optimization
- [ ] Security policy review
- [ ] Performance benchmarking

### Update Procedures

#### Application Updates
1. **Preparation**
   - Review changelog and breaking changes
   - Create backup
   - Schedule maintenance window

2. **Testing**
   - Deploy to staging environment
   - Run integration tests
   - Perform manual testing

3. **Production Deployment**
   - Deploy using rolling update strategy
   - Monitor health checks
   - Verify functionality

4. **Rollback Plan**
   - Keep previous version containers
   - Monitor for issues
   - Execute rollback if necessary

#### Security Updates
- **Critical security updates**: Apply immediately
- **Non-critical updates**: Apply during next maintenance window
- **Test all updates** in staging environment first

### Capacity Planning

#### Monitoring Growth Trends
- Task processing volume
- Database size growth
- API usage patterns
- Resource utilization trends

#### Scaling Indicators
- CPU usage > 70% sustained
- Memory usage > 80% sustained
- Disk usage > 75%
- Response time > 2 seconds
- Queue backlog > 1000 tasks

#### Scaling Strategies
- **Vertical scaling**: Increase resource limits
- **Horizontal scaling**: Add more service instances
- **Database scaling**: Read replicas and sharding
- **Caching**: Implement additional caching layers

### Best Practices

1. **Always test changes** in staging before production
2. **Monitor continuously** and set up proper alerting
3. **Document everything** including procedures and decisions
4. **Regular backups** and test recovery procedures
5. **Security-first approach** with regular audits
6. **Automate routine tasks** to reduce human error
7. **Keep dependencies updated** for security and performance
8. **Plan for growth** with proper capacity planning

## Support and Escalation

### Support Tiers
- **Level 1**: Basic operational issues
- **Level 2**: Application and integration issues
- **Level 3**: Architecture and performance issues

### Escalation Procedures
1. **Immediate**: Critical system down (< 15 minutes)
2. **High**: Performance degradation (< 2 hours)
3. **Medium**: Non-critical functionality issues (< 24 hours)
4. **Low**: Enhancement requests (< 1 week)

### Contact Information
- **Operations Team**: ops@example.com
- **Development Team**: dev@example.com
- **Security Team**: security@example.com
- **Emergency**: +1-555-0123

---

*This guide is continuously updated. Last updated: December 2023*