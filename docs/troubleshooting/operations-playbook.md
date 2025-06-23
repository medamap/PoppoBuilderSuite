# PoppoBuilder Suite - Operations Troubleshooting Playbook

## Overview

This playbook provides step-by-step procedures for diagnosing and resolving common operational issues in PoppoBuilder Suite production environments.

## Quick Reference

### Emergency Contacts
- **On-call Engineer**: +1-555-0199
- **Team Lead**: +1-555-0188
- **DevOps Team**: +1-555-0177
- **Security Team**: +1-555-0166

### Critical Health Checks
```bash
# System health
curl -f http://localhost:3000/health || echo "CRITICAL: Service down"

# Database connectivity
curl -f http://localhost:3000/health/db || echo "CRITICAL: Database down"

# Queue status
curl -f http://localhost:3000/health/queue || echo "WARNING: Queue issues"
```

## Severity Levels

### P0 - Critical (Immediate Response)
- System completely down
- Data loss risk
- Security incident
- **Response Time**: < 15 minutes

### P1 - High (1 Hour Response)
- Significant performance degradation
- Partial service outage
- API errors affecting users
- **Response Time**: < 1 hour

### P2 - Medium (4 Hour Response)
- Minor performance issues
- Non-critical feature failures
- Monitoring alerts
- **Response Time**: < 4 hours

### P3 - Low (Next Business Day)
- Enhancement requests
- Non-urgent maintenance
- Documentation updates
- **Response Time**: < 24 hours

## Incident Response Procedures

### 1. Initial Assessment (First 5 minutes)

#### Triage Checklist
- [ ] Confirm the issue and gather basic information
- [ ] Determine severity level
- [ ] Check system health dashboard
- [ ] Review recent deployments or changes
- [ ] Notify stakeholders if P0/P1

#### Quick Diagnostics
```bash
# Check service status
docker-compose ps

# Check recent logs
docker-compose logs --tail=50 poppobuilder

# Check system resources
docker stats

# Check external dependencies
curl -I https://api.github.com/
curl -I https://api.anthropic.com/
```

### 2. Escalation Matrix

| Issue Type | First Contact | Escalate To | Timeline |
|------------|---------------|-------------|----------|
| Application crash | On-call engineer | Team lead | 15 min |
| Database issues | On-call engineer | DBA team | 30 min |
| Security incident | Security team | CISO | Immediate |
| Performance issues | On-call engineer | DevOps team | 1 hour |

## Common Issues and Solutions

### Issue 1: Service Won't Start

#### Symptoms
- Health check endpoints return connection errors
- Container exits immediately
- Application logs show startup errors

#### Diagnosis Steps
```bash
# Check container status
docker-compose ps

# Check startup logs
docker-compose logs poppobuilder

# Check environment variables
docker-compose exec poppobuilder env | grep -E "(GITHUB|CLAUDE|DATABASE)"

# Check port conflicts
netstat -tulpn | grep :3000
```

#### Common Causes & Solutions

**Database Connection Failed**
```bash
# Check database status
docker-compose ps postgres

# Test database connectivity
docker-compose exec poppobuilder pg_isready -h postgres -p 5432

# Solution: Restart database
docker-compose restart postgres
```

**Missing Environment Variables**
```bash
# Check required variables
docker-compose exec poppobuilder node -e "
console.log('GITHUB_TOKEN:', !!process.env.GITHUB_TOKEN);
console.log('CLAUDE_API_KEY:', !!process.env.CLAUDE_API_KEY);
"

# Solution: Update .env file and restart
nano .env.production
docker-compose restart poppobuilder
```

**Port Already in Use**
```bash
# Find process using port
lsof -i :3000

# Solution: Kill process or change port
kill -9 <PID>
# OR
echo "POPPO_PORT=3001" >> .env.production
```

### Issue 2: High CPU Usage

#### Symptoms
- CPU usage > 80% sustained
- Slow response times
- Request timeouts

#### Diagnosis Steps
```bash
# Check CPU usage per container
docker stats

# Check process details
docker exec poppobuilder top -n 1

# Check for CPU-intensive tasks
curl http://localhost:3000/api/tasks/running

# Check Node.js event loop lag
curl http://localhost:3000/metrics | grep eventloop
```

#### Solutions

**Scale Horizontally**
```bash
# Increase replicas
docker-compose up -d --scale poppobuilder=3

# Verify load distribution
curl http://localhost:3000/health
```

**Optimize Performance**
```bash
# Enable Node.js profiling
docker-compose exec -e NODE_OPTIONS="--prof" poppobuilder npm start

# Restart service
docker-compose restart poppobuilder

# Monitor for improvement
watch -n 5 'docker stats --no-stream'
```

### Issue 3: Memory Leaks

#### Symptoms
- Memory usage continuously increasing
- Out of Memory (OOM) errors
- Container restarts frequently

#### Diagnosis Steps
```bash
# Monitor memory usage over time
watch -n 10 'docker stats --no-stream poppobuilder'

# Check for memory leaks in Node.js
curl http://localhost:3000/metrics | grep -E "(heap|memory)"

# Generate heap dump
docker exec poppobuilder kill -USR2 1
```

#### Solutions

**Immediate Relief**
```bash
# Restart service
docker-compose restart poppobuilder

# Increase memory limits
echo "deploy:
  resources:
    limits:
      memory: 2G" >> docker-compose.prod.yml
```

**Long-term Fix**
```bash
# Enable garbage collection monitoring
docker-compose exec -e NODE_OPTIONS="--expose-gc --trace-gc" poppobuilder npm start

# Force garbage collection
docker exec poppobuilder node -e "if (global.gc) global.gc(); else console.log('GC not exposed');"
```

### Issue 4: Database Performance Issues

#### Symptoms
- Slow query responses
- Database connection timeouts
- High database CPU usage

#### Diagnosis Steps
```bash
# Check database connections
docker exec postgres psql -U postgres -c "SELECT count(*) FROM pg_stat_activity;"

# Check slow queries
docker exec postgres psql -U postgres -c "
SELECT query, calls, total_time, mean_time 
FROM pg_stat_statements 
ORDER BY mean_time DESC 
LIMIT 10;"

# Check database size
docker exec postgres psql -U postgres -c "
SELECT pg_database.datname, pg_size_pretty(pg_database_size(pg_database.datname)) AS size 
FROM pg_database;"
```

#### Solutions

**Optimize Queries**
```sql
-- Add missing indexes
CREATE INDEX CONCURRENTLY idx_issues_status ON issues(status);
CREATE INDEX CONCURRENTLY idx_tasks_created_at ON tasks(created_at);

-- Update table statistics
ANALYZE;
```

**Connection Pool Tuning**
```bash
# Update connection pool settings
echo "DATABASE_POOL_SIZE=20" >> .env.production
echo "DATABASE_POOL_TIMEOUT=30000" >> .env.production
docker-compose restart poppobuilder
```

### Issue 5: GitHub API Rate Limiting

#### Symptoms
- GitHub API errors (403 Forbidden)
- Task processing delays
- Rate limit exceeded messages

#### Diagnosis Steps
```bash
# Check current rate limit
curl -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/rate_limit

# Check rate limit metrics
curl http://localhost:3000/metrics | grep github_rate_limit

# Check GitHub API usage pattern
grep "GitHub API" logs/poppo-$(date +%Y-%m-%d).log | tail -20
```

#### Solutions

**Immediate Action**
```bash
# Check rate limit reset time
curl -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/rate_limit | jq '.rate.reset'

# Pause processing temporarily
curl -X POST http://localhost:3000/api/admin/pause-processing

# Resume after reset
sleep 3600  # Wait for reset
curl -X POST http://localhost:3000/api/admin/resume-processing
```

**Long-term Solutions**
```bash
# Implement request batching
echo "GITHUB_REQUEST_BATCH_SIZE=10" >> .env.production

# Add delays between requests
echo "GITHUB_REQUEST_DELAY=1000" >> .env.production

# Use multiple tokens (if available)
echo "GITHUB_TOKENS=token1,token2,token3" >> .env.production
```

### Issue 6: Claude API Issues

#### Symptoms
- Claude API timeouts
- Authentication errors
- Quota exceeded errors

#### Diagnosis Steps
```bash
# Check Claude API status
curl -H "x-api-key: $CLAUDE_API_KEY" https://api.anthropic.com/v1/messages

# Check API usage metrics
curl http://localhost:3000/metrics | grep claude_api

# Check recent Claude API calls
grep "Claude API" logs/poppo-$(date +%Y-%m-%d).log | tail -10
```

#### Solutions

**API Key Issues**
```bash
# Verify API key format
echo $CLAUDE_API_KEY | grep -E "^sk-"

# Test with simple request
curl -X POST https://api.anthropic.com/v1/messages \
  -H "x-api-key: $CLAUDE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-3-sonnet-20240229","max_tokens":10,"messages":[{"role":"user","content":"Hi"}]}'
```

**Quota Management**
```bash
# Implement request queuing
echo "CLAUDE_MAX_CONCURRENT=2" >> .env.production

# Add backoff strategy
echo "CLAUDE_RETRY_DELAY=5000" >> .env.production
echo "CLAUDE_MAX_RETRIES=3" >> .env.production
```

### Issue 7: Disk Space Issues

#### Symptoms
- Disk usage > 90%
- Write operations failing
- Log rotation errors

#### Diagnosis Steps
```bash
# Check disk usage
df -h

# Check large files/directories
du -sh /* | sort -rh | head -10

# Check log sizes
du -sh logs/*

# Check Docker disk usage
docker system df
```

#### Solutions

**Immediate Cleanup**
```bash
# Clean Docker resources
docker system prune -a -f

# Rotate logs manually
./scripts/log-rotate.sh

# Clean old backups
find backups/ -name "*.tar.gz" -mtime +7 -delete

# Clean temporary files
rm -rf /tmp/poppo-*
```

**Long-term Solutions**
```bash
# Set up automatic log rotation
crontab -e
# Add: 0 0 * * * /path/to/log-rotate.sh

# Configure log retention
echo "LOG_RETENTION_DAYS=7" >> .env.production

# Monitor disk usage
echo "DISK_USAGE_ALERT_THRESHOLD=80" >> .env.production
```

### Issue 8: Network Connectivity Issues

#### Symptoms
- External API calls failing
- Intermittent connection errors
- DNS resolution failures

#### Diagnosis Steps
```bash
# Test external connectivity
docker exec poppobuilder ping -c 3 google.com

# Test specific APIs
docker exec poppobuilder curl -I https://api.github.com/
docker exec poppobuilder curl -I https://api.anthropic.com/

# Check DNS resolution
docker exec poppobuilder nslookup api.github.com

# Check network configuration
docker network ls
docker network inspect poppobuilder_default
```

#### Solutions

**DNS Issues**
```bash
# Use different DNS servers
echo "DNS=8.8.8.8 8.8.4.4" >> /etc/systemd/resolved.conf
systemctl restart systemd-resolved

# Or configure in Docker
echo "networks:
  default:
    driver: bridge
    driver_opts:
      com.docker.network.bridge.default_bridge: \"true\"
      com.docker.network.driver.mtu: \"1500\"" >> docker-compose.yml
```

**Proxy Configuration**
```bash
# Configure HTTP proxy
echo "HTTP_PROXY=http://proxy.company.com:8080" >> .env.production
echo "HTTPS_PROXY=http://proxy.company.com:8080" >> .env.production
echo "NO_PROXY=localhost,127.0.0.1" >> .env.production
```

## Monitoring and Alerting

### Key Metrics to Monitor

#### System Metrics
- CPU usage (alert at >80%)
- Memory usage (alert at >85%)
- Disk usage (alert at >75%)
- Network I/O

#### Application Metrics
- Request rate and latency
- Error rate (alert at >5%)
- Queue depth (alert at >1000)
- Active connections

#### External Dependencies
- GitHub API rate limit (alert at <100)
- Claude API response time
- Database connection pool usage

### Alert Routing

#### Critical Alerts (P0)
- Service down → Immediate page
- Database down → Immediate page
- Security incident → Immediate page

#### High Priority Alerts (P1)
- High error rate → Team chat + email
- Performance degradation → Team chat
- API limits reached → Team chat

#### Medium Priority Alerts (P2)
- Resource usage warnings → Email
- Monitoring issues → Email
- Backup failures → Email

### Dashboard Setup

Access the monitoring dashboard at: http://localhost:3001

Key dashboard panels:
1. **System Overview**: CPU, memory, disk, network
2. **Application Health**: Response times, error rates, throughput
3. **Queue Status**: Task counts, processing rates, backlogs
4. **External APIs**: Rate limits, response times, errors
5. **Security Events**: Failed logins, suspicious activity

## Recovery Procedures

### Service Recovery
```bash
# Quick restart
docker-compose restart poppobuilder

# Full restart with cleanup
docker-compose down
docker-compose up -d

# Rolling restart (zero downtime)
docker-compose up -d --scale poppobuilder=2
docker-compose restart poppobuilder
docker-compose up -d --scale poppobuilder=1
```

### Database Recovery
```bash
# Check database status
docker-compose exec postgres pg_isready

# Restart database
docker-compose restart postgres

# Restore from backup (if needed)
./scripts/backup-restore.sh restore --file latest-backup.tar.gz
```

### Disaster Recovery
```bash
# Full system restore
./scripts/disaster-recovery.sh restore --backup-id latest

# Verify system health
./scripts/health-check.sh --full
```

## Maintenance Procedures

### Planned Maintenance
1. **Pre-maintenance**
   - [ ] Notify stakeholders
   - [ ] Create backup
   - [ ] Prepare rollback plan

2. **During maintenance**
   - [ ] Put system in maintenance mode
   - [ ] Perform updates
   - [ ] Test functionality
   - [ ] Monitor for issues

3. **Post-maintenance**
   - [ ] Remove maintenance mode
   - [ ] Verify all services
   - [ ] Monitor performance
   - [ ] Update documentation

### Emergency Maintenance
```bash
# Enable maintenance mode
curl -X POST http://localhost:3000/api/admin/maintenance-mode

# Perform emergency fixes
# ...

# Disable maintenance mode
curl -X DELETE http://localhost:3000/api/admin/maintenance-mode
```

## Escalation Procedures

### When to Escalate
- Unable to resolve issue within SLA
- Issue requires specialized knowledge
- Security implications
- Data integrity concerns
- Multiple system failures

### Escalation Contacts
1. **Technical Escalation**: Team Lead → Senior Engineer → Architect
2. **Management Escalation**: Manager → Director → VP Engineering
3. **Security Escalation**: Security Team → CISO → Legal
4. **External Escalation**: Vendor Support → Account Manager → Executive Sponsor

### Documentation Required
- Issue description and timeline
- Steps taken to resolve
- Current system state
- Business impact assessment
- Recommended next actions

---

Remember: When in doubt, escalate early. It's better to involve additional resources than to let an issue impact customers.

*This playbook is regularly updated based on operational experience. Please contribute improvements and new scenarios.*