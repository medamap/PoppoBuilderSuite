# PoppoBuilder Suite - Production Deployment Guide

## Overview

This guide provides comprehensive instructions for deploying PoppoBuilder Suite to production environments. It covers all deployment methods, configuration requirements, and best practices for enterprise-grade deployments.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Deployment Architecture](#deployment-architecture)
3. [Environment Preparation](#environment-preparation)
4. [Docker Compose Deployment](#docker-compose-deployment)
5. [Kubernetes Deployment](#kubernetes-deployment)
6. [Cloud Provider Deployments](#cloud-provider-deployments)
7. [Configuration Management](#configuration-management)
8. [Security Configuration](#security-configuration)
9. [Monitoring Setup](#monitoring-setup)
10. [Backup Configuration](#backup-configuration)
11. [Performance Tuning](#performance-tuning)
12. [Troubleshooting](#troubleshooting)
13. [Post-Deployment Validation](#post-deployment-validation)

## Prerequisites

### System Requirements

#### Minimum Requirements
- **CPU**: 4 cores
- **Memory**: 8GB RAM
- **Storage**: 100GB SSD
- **Network**: 100 Mbps
- **OS**: Linux (Ubuntu 20.04+), CentOS 8+, or RHEL 8+

#### Recommended Requirements
- **CPU**: 8+ cores
- **Memory**: 16GB+ RAM
- **Storage**: 500GB+ SSD (NVMe preferred)
- **Network**: 1 Gbps
- **OS**: Ubuntu 22.04 LTS

#### High Availability Requirements
- **Nodes**: 3+ application nodes
- **Load Balancer**: HAProxy, Nginx, or cloud load balancer
- **Database**: PostgreSQL cluster or managed database
- **Cache**: Redis cluster or managed cache
- **Storage**: Shared storage (NFS, cloud storage, or distributed filesystem)

### Software Prerequisites

```bash
# Install Docker and Docker Compose
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/download/v2.21.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Install Kubernetes tools (if using K8s)
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
sudo install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl

# Install Helm (for K8s deployments)
curl https://baltocdn.com/helm/signing.asc | gpg --dearmor | sudo tee /usr/share/keyrings/helm.gpg > /dev/null
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/helm.gpg] https://baltocdn.com/helm/stable/debian/ all main" | sudo tee /etc/apt/sources.list.d/helm-stable-debian.list
sudo apt-get update
sudo apt-get install helm
```

### External Services

#### Required Services
- **GitHub**: Organization access and API tokens
- **Claude API**: Anthropic API key with sufficient quota
- **Email**: SMTP server for notifications
- **DNS**: Domain name and DNS management

#### Optional Services
- **Slack**: Webhook URL for notifications
- **Discord**: Webhook URL for notifications
- **PagerDuty**: Integration for critical alerts
- **Datadog/New Relic**: Additional monitoring

## Deployment Architecture

### Single Server Deployment
```
┌─────────────────────────────────────┐
│           Production Server         │
│  ┌─────────────┐ ┌─────────────────┐│
│  │   Nginx     │ │  PoppoBuilder   ││
│  │ (Reverse    │ │     Suite       ││
│  │  Proxy)     │ │                 ││
│  └─────────────┘ └─────────────────┘│
│  ┌─────────────┐ ┌─────────────────┐│
│  │ PostgreSQL  │ │     Redis       ││
│  │             │ │                 ││
│  └─────────────┘ └─────────────────┘│
│  ┌─────────────┐ ┌─────────────────┐│
│  │ Prometheus  │ │    Grafana      ││
│  │             │ │                 ││
│  └─────────────┘ └─────────────────┘│
└─────────────────────────────────────┘
```

### High Availability Deployment
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Load Balancer │    │   Load Balancer │    │   Load Balancer │
│    (Primary)    │    │   (Secondary)   │    │   (Tertiary)    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
    ┌────────────────────────────┼────────────────────────────┐
    │                            │                            │
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│PoppoBuilder │         │PoppoBuilder │         │PoppoBuilder │
│   Node 1    │         │   Node 2    │         │   Node 3    │
└─────────────┘         └─────────────┘         └─────────────┘
    │                            │                            │
    └────────────────────────────┼────────────────────────────┘
                                 │
        ┌────────────────────────┼────────────────────────────┐
        │                        │                            │
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│ PostgreSQL  │         │    Redis    │         │ Monitoring  │
│  Cluster    │         │   Cluster   │         │   Stack     │
└─────────────┘         └─────────────┘         └─────────────┘
```

## Environment Preparation

### 1. Create Production User

```bash
# Create dedicated user for PoppoBuilder
sudo useradd -m -s /bin/bash poppobuilder
sudo usermod -aG docker poppobuilder

# Create application directories
sudo mkdir -p /opt/poppobuilder/{data,logs,config,backups}
sudo chown -R poppobuilder:poppobuilder /opt/poppobuilder
sudo chmod 755 /opt/poppobuilder
```

### 2. Configure Firewall

```bash
# Configure UFW (Ubuntu)
sudo ufw enable
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow from 10.0.0.0/8 to any port 3000  # Internal access
sudo ufw allow from 10.0.0.0/8 to any port 5432  # PostgreSQL
sudo ufw allow from 10.0.0.0/8 to any port 6379  # Redis
sudo ufw allow from 10.0.0.0/8 to any port 9090  # Prometheus

# Or configure iptables directly
sudo iptables -A INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 443 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 3000 -s 10.0.0.0/8 -j ACCEPT
```

### 3. Configure System Limits

```bash
# Increase file descriptor limits
echo "poppobuilder soft nofile 65536" | sudo tee -a /etc/security/limits.conf
echo "poppobuilder hard nofile 65536" | sudo tee -a /etc/security/limits.conf

# Configure systemd limits
sudo mkdir -p /etc/systemd/system/docker.service.d
cat << EOF | sudo tee /etc/systemd/system/docker.service.d/override.conf
[Service]
LimitNOFILE=65536
LimitNPROC=65536
EOF

sudo systemctl daemon-reload
sudo systemctl restart docker
```

### 4. Configure Log Rotation

```bash
# Create logrotate configuration
cat << EOF | sudo tee /etc/logrotate.d/poppobuilder
/opt/poppobuilder/logs/*.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    create 644 poppobuilder poppobuilder
    postrotate
        docker kill -s USR1 \$(docker ps -q --filter "name=poppobuilder") 2>/dev/null || true
    endscript
}
EOF
```

## Docker Compose Deployment

### 1. Prepare Deployment Directory

```bash
# Switch to poppobuilder user
sudo su - poppobuilder

# Clone repository
git clone https://github.com/your-org/PoppoBuilderSuite.git
cd PoppoBuilderSuite

# Copy production configuration
cp docker-compose.prod.yml docker-compose.yml
cp .env.example .env.production
```

### 2. Configure Environment Variables

```bash
# Edit production environment file
nano .env.production
```

**Required Environment Variables:**
```bash
# Application Configuration
NODE_ENV=production
POPPO_PORT=3000
POPPO_LOG_LEVEL=info

# Database Configuration
DATABASE_URL=postgresql://poppo_user:secure_password@postgres:5432/poppobuilder
POSTGRES_USER=poppo_user
POSTGRES_PASSWORD=secure_password
POSTGRES_DB=poppobuilder

# Cache Configuration
REDIS_URL=redis://redis:6379/0
REDIS_PASSWORD=secure_redis_password

# API Keys
GITHUB_TOKEN=ghp_your_github_token_here
CLAUDE_API_KEY=sk-your_claude_api_key_here

# Security
JWT_SECRET=your_jwt_secret_here_minimum_32_characters
ENCRYPTION_KEY=your_encryption_key_here_32_chars

# Dashboard Authentication
DASHBOARD_USERNAME=admin
DASHBOARD_PASSWORD=secure_dashboard_password

# Email Configuration
SMTP_HOST=smtp.your-domain.com
SMTP_PORT=587
SMTP_USER=notifications@your-domain.com
SMTP_PASSWORD=your_smtp_password
SMTP_FROM=PoppoBuilder <notifications@your-domain.com>

# Monitoring
PROMETHEUS_RETENTION=30d
GRAFANA_ADMIN_PASSWORD=secure_grafana_password

# Backup Configuration
BACKUP_ENCRYPTION_KEY=your_backup_encryption_key_here
BACKUP_RETENTION_DAYS=30

# SSL Configuration (if using Let's Encrypt)
LETSENCRYPT_EMAIL=admin@your-domain.com
DOMAIN_NAME=poppobuilder.your-domain.com
```

### 3. Configure SSL/TLS

#### Option A: Let's Encrypt (Recommended)

```bash
# Update docker-compose.yml to include Certbot
cat << 'EOF' >> docker-compose.yml

  certbot:
    image: certbot/certbot:latest
    container_name: certbot
    volumes:
      - ./certbot/conf:/etc/letsencrypt
      - ./certbot/www:/var/www/certbot
    command: certonly --webroot --webroot-path=/var/www/certbot --email ${LETSENCRYPT_EMAIL} --agree-tos --no-eff-email -d ${DOMAIN_NAME}
EOF

# Create initial certificate
docker-compose run --rm certbot

# Update nginx configuration for SSL
```

#### Option B: Custom SSL Certificate

```bash
# Create SSL directory
mkdir -p ssl/

# Copy your SSL certificates
cp your-domain.crt ssl/
cp your-domain.key ssl/
cp your-ca-bundle.crt ssl/

# Update nginx configuration
```

### 4. Deploy Services

```bash
# Create external network
docker network create poppobuilder-network

# Start services
docker-compose up -d

# Verify deployment
docker-compose ps
docker-compose logs -f poppobuilder
```

### 5. Initialize Database

```bash
# Run database migrations
docker-compose exec poppobuilder npm run db:migrate

# Create initial admin user
docker-compose exec poppobuilder npm run admin:create-user -- \
  --email admin@your-domain.com \
  --password secure_admin_password \
  --role admin
```

### 6. Configure Backup Schedule

```bash
# Add backup cron job
crontab -e

# Add the following line for daily backups at 2 AM
0 2 * * * cd /home/poppobuilder/PoppoBuilderSuite && ./scripts/backup-restore.sh backup --type full --compress --encrypt >> /opt/poppobuilder/logs/backup.log 2>&1
```

## Kubernetes Deployment

### 1. Prepare Kubernetes Cluster

```bash
# Verify cluster access
kubectl cluster-info
kubectl get nodes

# Create namespace
kubectl create namespace poppobuilder

# Set default namespace
kubectl config set-context --current --namespace=poppobuilder
```

### 2. Create Secrets

```bash
# Create database secret
kubectl create secret generic database-credentials \
  --from-literal=username=poppo_user \
  --from-literal=password=secure_password \
  --from-literal=database=poppobuilder

# Create API keys secret
kubectl create secret generic api-keys \
  --from-literal=github-token=ghp_your_github_token_here \
  --from-literal=claude-api-key=sk_your_claude_api_key_here

# Create application secrets
kubectl create secret generic app-secrets \
  --from-literal=jwt-secret=your_jwt_secret_here \
  --from-literal=encryption-key=your_encryption_key_here

# Create email configuration secret
kubectl create secret generic email-config \
  --from-literal=smtp-host=smtp.your-domain.com \
  --from-literal=smtp-port=587 \
  --from-literal=smtp-user=notifications@your-domain.com \
  --from-literal=smtp-password=your_smtp_password
```

### 3. Configure Storage

```bash
# Create persistent volume claims
kubectl apply -f - << EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: postgres-pvc
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 100Gi
  storageClassName: fast-ssd
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: redis-pvc
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 10Gi
  storageClassName: fast-ssd
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: poppobuilder-data-pvc
spec:
  accessModes:
    - ReadWriteMany
  resources:
    requests:
      storage: 50Gi
  storageClassName: shared-storage
EOF
```

### 4. Deploy Using Helm

```bash
# Add PoppoBuilder Helm repository
helm repo add poppobuilder https://helm.poppobuilder.com
helm repo update

# Create values file
cat << EOF > values.yaml
image:
  tag: "3.0.0"

resources:
  limits:
    cpu: 2000m
    memory: 4Gi
  requests:
    cpu: 1000m
    memory: 2Gi

autoscaling:
  enabled: true
  minReplicas: 3
  maxReplicas: 10
  targetCPUUtilizationPercentage: 70

ingress:
  enabled: true
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
  hosts:
    - host: poppobuilder.your-domain.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: poppobuilder-tls
      hosts:
        - poppobuilder.your-domain.com

postgresql:
  enabled: true
  primary:
    persistence:
      size: 100Gi
  auth:
    existingSecret: database-credentials

redis:
  enabled: true
  auth:
    enabled: true
    existingSecret: redis-credentials
  master:
    persistence:
      size: 10Gi

monitoring:
  prometheus:
    enabled: true
  grafana:
    enabled: true
    ingress:
      enabled: true
      hosts:
        - grafana.your-domain.com

backup:
  enabled: true
  schedule: "0 2 * * *"
  retention: 30
EOF

# Deploy with Helm
helm install poppobuilder poppobuilder/poppobuilder -f values.yaml
```

### 5. Verify Deployment

```bash
# Check pod status
kubectl get pods

# Check services
kubectl get svc

# Check ingress
kubectl get ingress

# View logs
kubectl logs -f deployment/poppobuilder

# Port forward for testing
kubectl port-forward svc/poppobuilder 8080:3000
```

## Cloud Provider Deployments

### AWS Deployment with ECS

#### 1. Create ECS Cluster

```bash
# Create cluster
aws ecs create-cluster --cluster-name poppobuilder-prod

# Create task definition
aws ecs register-task-definition --cli-input-json file://task-definition.json

# Create service
aws ecs create-service \
  --cluster poppobuilder-prod \
  --service-name poppobuilder \
  --task-definition poppobuilder:1 \
  --desired-count 3 \
  --load-balancers targetGroupArn=arn:aws:elasticloadbalancing:region:account:targetgroup/poppobuilder/xxx,containerName=poppobuilder,containerPort=3000
```

#### 2. Configure RDS and ElastiCache

```bash
# Create RDS instance
aws rds create-db-instance \
  --db-instance-identifier poppobuilder-db \
  --db-instance-class db.t3.large \
  --engine postgres \
  --master-username poppo_user \
  --master-user-password secure_password \
  --allocated-storage 100 \
  --vpc-security-group-ids sg-xxxxxxxxx

# Create ElastiCache cluster
aws elasticache create-cache-cluster \
  --cache-cluster-id poppobuilder-redis \
  --cache-node-type cache.t3.medium \
  --engine redis \
  --num-cache-nodes 1
```

### Google Cloud Platform Deployment

#### 1. Create GKE Cluster

```bash
# Create cluster
gcloud container clusters create poppobuilder-prod \
  --num-nodes=3 \
  --machine-type=n1-standard-4 \
  --zone=us-central1-a \
  --enable-autoscaling \
  --min-nodes=3 \
  --max-nodes=10

# Get credentials
gcloud container clusters get-credentials poppobuilder-prod --zone=us-central1-a
```

#### 2. Configure Cloud SQL and Memorystore

```bash
# Create Cloud SQL instance
gcloud sql instances create poppobuilder-db \
  --database-version=POSTGRES_14 \
  --tier=db-n1-standard-4 \
  --region=us-central1

# Create Redis instance
gcloud redis instances create poppobuilder-redis \
  --size=1 \
  --region=us-central1 \
  --redis-version=redis_6_x
```

### Azure Deployment

#### 1. Create AKS Cluster

```bash
# Create resource group
az group create --name poppobuilder-rg --location eastus

# Create AKS cluster
az aks create \
  --resource-group poppobuilder-rg \
  --name poppobuilder-aks \
  --node-count 3 \
  --node-vm-size Standard_D4s_v3 \
  --enable-addons monitoring \
  --generate-ssh-keys

# Get credentials
az aks get-credentials --resource-group poppobuilder-rg --name poppobuilder-aks
```

#### 2. Configure Azure Database and Cache

```bash
# Create PostgreSQL server
az postgres server create \
  --resource-group poppobuilder-rg \
  --name poppobuilder-db \
  --location eastus \
  --admin-user poppo_user \
  --admin-password secure_password \
  --sku-name GP_Gen5_4

# Create Redis cache
az redis create \
  --location eastus \
  --name poppobuilder-redis \
  --resource-group poppobuilder-rg \
  --sku Standard \
  --vm-size c1
```

## Configuration Management

### 1. Environment-Specific Configurations

Create separate configuration files for each environment:

```bash
# Production configuration
config/
├── production.json
├── staging.json
├── development.json
└── base.json
```

**base.json**:
```json
{
  "application": {
    "name": "PoppoBuilder Suite",
    "version": "3.0.0"
  },
  "server": {
    "host": "0.0.0.0",
    "port": 3000
  },
  "database": {
    "pool": {
      "min": 5,
      "max": 20
    }
  },
  "redis": {
    "retryDelayOnFailover": 100,
    "maxRetriesPerRequest": 3
  }
}
```

**production.json**:
```json
{
  "extends": "base.json",
  "logging": {
    "level": "info",
    "enableStructuredLogging": true,
    "enableErrorCorrelation": true
  },
  "monitoring": {
    "enabled": true,
    "metricsInterval": 30000
  },
  "security": {
    "strictMode": true,
    "auditEnabled": true,
    "rateLimiting": {
      "windowMs": 900000,
      "max": 1000
    }
  },
  "performance": {
    "clustering": true,
    "workers": "auto",
    "compression": true
  }
}
```

### 2. Secret Management

#### Using HashiCorp Vault

```bash
# Store secrets in Vault
vault kv put secret/poppobuilder/prod \
  github_token="ghp_your_token" \
  claude_api_key="sk_your_key" \
  database_password="secure_password"

# Configure Vault agent for automatic secret injection
```

#### Using Kubernetes Secrets with External Secrets Operator

```yaml
apiVersion: external-secrets.io/v1beta1
kind: SecretStore
metadata:
  name: vault-backend
spec:
  provider:
    vault:
      server: "https://vault.your-domain.com"
      path: "secret"
      version: "v2"
      auth:
        kubernetes:
          mountPath: "kubernetes"
          role: "poppobuilder"
---
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: poppobuilder-secrets
spec:
  refreshInterval: 5m
  secretStoreRef:
    name: vault-backend
    kind: SecretStore
  target:
    name: poppobuilder-secrets
    creationPolicy: Owner
  data:
  - secretKey: github-token
    remoteRef:
      key: poppobuilder/prod
      property: github_token
  - secretKey: claude-api-key
    remoteRef:
      key: poppobuilder/prod
      property: claude_api_key
```

## Security Configuration

### 1. Network Security

#### Firewall Rules

```bash
# Allow only necessary ports
# HTTP/HTTPS
iptables -A INPUT -p tcp --dport 80 -j ACCEPT
iptables -A INPUT -p tcp --dport 443 -j ACCEPT

# SSH (restrict to management networks)
iptables -A INPUT -p tcp --dport 22 -s 10.0.1.0/24 -j ACCEPT

# Application port (internal only)
iptables -A INPUT -p tcp --dport 3000 -s 10.0.0.0/8 -j ACCEPT

# Database (internal only)
iptables -A INPUT -p tcp --dport 5432 -s 10.0.0.0/8 -j ACCEPT

# Redis (internal only)
iptables -A INPUT -p tcp --dport 6379 -s 10.0.0.0/8 -j ACCEPT

# Drop all other traffic
iptables -A INPUT -j DROP
```

#### Network Policies (Kubernetes)

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: poppobuilder-network-policy
spec:
  podSelector:
    matchLabels:
      app: poppobuilder
  policyTypes:
  - Ingress
  - Egress
  ingress:
  - from:
    - namespaceSelector:
        matchLabels:
          name: ingress-nginx
    ports:
    - protocol: TCP
      port: 3000
  - from:
    - podSelector:
        matchLabels:
          app: prometheus
    ports:
    - protocol: TCP
      port: 9090
  egress:
  - to:
    - podSelector:
        matchLabels:
          app: postgresql
    ports:
    - protocol: TCP
      port: 5432
  - to:
    - podSelector:
        matchLabels:
          app: redis
    ports:
    - protocol: TCP
      port: 6379
  - to: []
    ports:
    - protocol: TCP
      port: 443
```

### 2. Application Security

#### Security Headers Configuration

```nginx
# Nginx security headers
add_header X-Frame-Options "DENY" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
```

#### API Rate Limiting

```json
{
  "rateLimiting": {
    "global": {
      "windowMs": 900000,
      "max": 1000
    },
    "api": {
      "windowMs": 900000,
      "max": 500
    },
    "auth": {
      "windowMs": 900000,
      "max": 10
    }
  }
}
```

### 3. Certificate Management

#### Let's Encrypt with Cert-Manager

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: admin@your-domain.com
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
    - http01:
        ingress:
          class: nginx
```

## Monitoring Setup

### 1. Prometheus Configuration

```yaml
# prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

rule_files:
  - "alert_rules.yml"

scrape_configs:
  - job_name: 'poppobuilder'
    static_configs:
      - targets: ['poppobuilder:3000']
    metrics_path: '/metrics'
    scrape_interval: 15s

  - job_name: 'postgres'
    static_configs:
      - targets: ['postgres-exporter:9187']

  - job_name: 'redis'
    static_configs:
      - targets: ['redis-exporter:9121']

  - job_name: 'node'
    static_configs:
      - targets: ['node-exporter:9100']

alerting:
  alertmanagers:
    - static_configs:
        - targets:
          - alertmanager:9093
```

### 2. Grafana Dashboard Import

```bash
# Import pre-built dashboards
curl -X POST \
  http://admin:password@grafana:3000/api/dashboards/db \
  -H 'Content-Type: application/json' \
  -d @dashboards/poppobuilder-overview.json

curl -X POST \
  http://admin:password@grafana:3000/api/dashboards/db \
  -H 'Content-Type: application/json' \
  -d @dashboards/system-metrics.json
```

### 3. Alert Rules

```yaml
# alert_rules.yml
groups:
- name: poppobuilder.rules
  rules:
  - alert: HighCPUUsage
    expr: poppobuilder_cpu_usage_percent > 80
    for: 5m
    labels:
      severity: warning
    annotations:
      summary: "High CPU usage detected"
      description: "CPU usage is {{ $value }}% for more than 5 minutes"

  - alert: HighMemoryUsage
    expr: poppobuilder_memory_usage_percent > 85
    for: 5m
    labels:
      severity: warning
    annotations:
      summary: "High memory usage detected"
      description: "Memory usage is {{ $value }}% for more than 5 minutes"

  - alert: ServiceDown
    expr: up{job="poppobuilder"} == 0
    for: 1m
    labels:
      severity: critical
    annotations:
      summary: "PoppoBuilder service is down"
      description: "PoppoBuilder service has been down for more than 1 minute"

  - alert: HighErrorRate
    expr: rate(poppobuilder_errors_total[5m]) > 0.05
    for: 5m
    labels:
      severity: critical
    annotations:
      summary: "High error rate detected"
      description: "Error rate is {{ $value }} errors per second"
```

## Backup Configuration

### 1. Automated Backup Strategy

```bash
#!/bin/bash
# /opt/poppobuilder/scripts/backup.sh

BACKUP_DIR="/opt/poppobuilder/backups"
DATE=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS=30

# Create backup
./scripts/backup-restore.sh backup \
  --type full \
  --name "automated_${DATE}" \
  --compress \
  --encrypt

# Clean old backups
find ${BACKUP_DIR} -name "automated_*.tar.gz.gpg" -mtime +${RETENTION_DAYS} -delete

# Upload to cloud storage
aws s3 sync ${BACKUP_DIR} s3://your-backup-bucket/poppobuilder/

# Send notification
curl -X POST https://your-webhook-url \
  -H 'Content-Type: application/json' \
  -d "{\"text\": \"PoppoBuilder backup completed: automated_${DATE}\"}"
```

### 2. Database Backup

```bash
#!/bin/bash
# Database-specific backup

DB_BACKUP_DIR="/opt/poppobuilder/backups/database"
mkdir -p ${DB_BACKUP_DIR}

# PostgreSQL backup
docker exec postgres pg_dump -U poppo_user poppobuilder | gzip > ${DB_BACKUP_DIR}/postgres_${DATE}.sql.gz

# Redis backup
docker exec redis redis-cli BGSAVE
docker cp redis:/data/dump.rdb ${DB_BACKUP_DIR}/redis_${DATE}.rdb
```

### 3. Backup Verification

```bash
#!/bin/bash
# Verify backup integrity

for backup in ${BACKUP_DIR}/*.tar.gz.gpg; do
  echo "Verifying: $backup"
  ./scripts/backup-restore.sh verify --file $(basename $backup)
  if [ $? -ne 0 ]; then
    echo "ALERT: Backup verification failed for $backup"
    # Send alert
  fi
done
```

## Performance Tuning

### 1. Application Performance

#### Node.js Optimization

```bash
# Set Node.js production optimizations
export NODE_ENV=production
export NODE_OPTIONS="--max-old-space-size=4096 --optimize-for-size"

# Enable clustering
export CLUSTER_MODE=true
export WORKERS=auto
```

#### Database Connection Pool

```json
{
  "database": {
    "pool": {
      "min": 10,
      "max": 50,
      "acquireTimeoutMillis": 30000,
      "idleTimeoutMillis": 30000
    }
  }
}
```

### 2. Database Performance

#### PostgreSQL Tuning

```sql
-- postgresql.conf optimizations
shared_buffers = 1GB
effective_cache_size = 3GB
maintenance_work_mem = 256MB
checkpoint_completion_target = 0.9
wal_buffers = 16MB
default_statistics_target = 100
random_page_cost = 1.1
effective_io_concurrency = 200

-- Create indexes
CREATE INDEX CONCURRENTLY idx_issues_status ON issues(status);
CREATE INDEX CONCURRENTLY idx_issues_created_at ON issues(created_at);
CREATE INDEX CONCURRENTLY idx_tasks_project_id ON tasks(project_id);
CREATE INDEX CONCURRENTLY idx_tasks_status ON tasks(status);
```

#### Redis Optimization

```conf
# redis.conf optimizations
maxmemory 2gb
maxmemory-policy allkeys-lru
save 900 1
save 300 10
save 60 10000
tcp-keepalive 300
```

### 3. System Performance

#### Kernel Tuning

```bash
# /etc/sysctl.conf
net.core.somaxconn = 1024
net.core.netdev_max_backlog = 5000
net.core.rmem_default = 262144
net.core.rmem_max = 16777216
net.core.wmem_default = 262144
net.core.wmem_max = 16777216
net.ipv4.tcp_wmem = 4096 12582912 16777216
net.ipv4.tcp_rmem = 4096 12582912 16777216
vm.swappiness = 10
fs.file-max = 65536

# Apply changes
sysctl -p
```

## Post-Deployment Validation

### 1. Health Check Validation

```bash
#!/bin/bash
# comprehensive-health-check.sh

echo "🔍 Running post-deployment validation..."

# Basic health check
echo "Checking basic health endpoint..."
curl -f http://localhost/health || { echo "❌ Basic health check failed"; exit 1; }

# Detailed health check
echo "Checking detailed health endpoint..."
curl -f http://localhost/health/detailed || { echo "❌ Detailed health check failed"; exit 1; }

# Database connectivity
echo "Checking database connectivity..."
curl -f http://localhost/health/db || { echo "❌ Database health check failed"; exit 1; }

# Cache connectivity
echo "Checking cache connectivity..."
curl -f http://localhost/health/redis || { echo "❌ Redis health check failed"; exit 1; }

# API functionality
echo "Checking API functionality..."
curl -f -H "Authorization: Bearer $API_TOKEN" http://localhost/api/projects || { echo "❌ API check failed"; exit 1; }

# Metrics endpoint
echo "Checking metrics endpoint..."
curl -f http://localhost/metrics | grep "poppobuilder_" || { echo "❌ Metrics check failed"; exit 1; }

echo "✅ All health checks passed!"
```

### 2. Performance Validation

```bash
#!/bin/bash
# performance-validation.sh

echo "🚀 Running performance validation..."

# Load test
echo "Running load test..."
ab -n 1000 -c 10 http://localhost/health > loadtest_results.txt

# Check response times
avg_response=$(cat loadtest_results.txt | grep "Time per request" | head -1 | awk '{print $4}')
if (( $(echo "$avg_response > 100" | bc -l) )); then
  echo "❌ Average response time too high: ${avg_response}ms"
  exit 1
fi

# Check error rate
failed_requests=$(cat loadtest_results.txt | grep "Failed requests" | awk '{print $3}')
if [ "$failed_requests" -gt 0 ]; then
  echo "❌ Failed requests detected: $failed_requests"
  exit 1
fi

echo "✅ Performance validation passed!"
```

### 3. Security Validation

```bash
#!/bin/bash
# security-validation.sh

echo "🔒 Running security validation..."

# Check SSL configuration
echo "Checking SSL configuration..."
curl -I https://poppobuilder.your-domain.com | grep "Strict-Transport-Security" || { echo "❌ HSTS header missing"; exit 1; }

# Check security headers
echo "Checking security headers..."
curl -I https://poppobuilder.your-domain.com | grep "X-Frame-Options" || { echo "❌ X-Frame-Options header missing"; exit 1; }

# Run security audit
echo "Running security audit..."
./scripts/security-audit.sh --production || { echo "❌ Security audit failed"; exit 1; }

# Check for exposed secrets
echo "Checking for exposed secrets..."
grep -r "ghp_\|sk-" /opt/poppobuilder/ --exclude-dir=.git && { echo "❌ Potential secrets found in files"; exit 1; }

echo "✅ Security validation passed!"
```

### 4. Monitoring Validation

```bash
#!/bin/bash
# monitoring-validation.sh

echo "📊 Validating monitoring setup..."

# Check Prometheus targets
echo "Checking Prometheus targets..."
curl -s http://prometheus:9090/api/v1/targets | jq '.data.activeTargets[] | select(.health != "up")' | wc -l | grep -q "^0$" || { echo "❌ Some Prometheus targets are down"; exit 1; }

# Check Grafana dashboards
echo "Checking Grafana dashboards..."
curl -f http://admin:$GRAFANA_PASSWORD@grafana:3000/api/dashboards/home || { echo "❌ Grafana not accessible"; exit 1; }

# Check AlertManager
echo "Checking AlertManager..."
curl -f http://alertmanager:9093/api/v1/status || { echo "❌ AlertManager not accessible"; exit 1; }

echo "✅ Monitoring validation passed!"
```

## Troubleshooting

### Common Deployment Issues

#### 1. Container Won't Start
```bash
# Check container logs
docker logs poppobuilder

# Common fixes
docker-compose restart poppobuilder
docker-compose down && docker-compose up -d
```

#### 2. Database Connection Issues
```bash
# Check database status
docker exec postgres pg_isready

# Check connection from app
docker exec poppobuilder pg_isready -h postgres -p 5432

# Reset database connection
docker-compose restart postgres
```

#### 3. SSL Certificate Issues
```bash
# Check certificate validity
openssl x509 -in ssl/your-domain.crt -text -noout

# Renew Let's Encrypt certificate
docker-compose run --rm certbot renew

# Test SSL configuration
curl -I https://poppobuilder.your-domain.com
```

#### 4. Performance Issues
```bash
# Check resource usage
docker stats

# Check database performance
docker exec postgres psql -U poppo_user -d poppobuilder -c "SELECT * FROM pg_stat_activity;"

# Check Redis performance
docker exec redis redis-cli info stats
```

### Log Analysis

```bash
# Application logs
tail -f /opt/poppobuilder/logs/app.log

# Database logs
docker logs postgres

# Nginx logs
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log

# System logs
journalctl -u docker -f
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

### Update Procedures

```bash
#!/bin/bash
# update-deployment.sh

# 1. Backup current version
./scripts/backup-restore.sh backup --name "pre-update-$(date +%Y%m%d)"

# 2. Pull new image
docker-compose pull

# 3. Update with zero downtime
docker-compose up -d --no-deps poppobuilder

# 4. Verify deployment
./scripts/health-check.sh

# 5. Clean up old images
docker image prune -f
```

---

This deployment guide provides comprehensive instructions for production deployment of PoppoBuilder Suite. For additional support or specific deployment scenarios, please consult the operations team or create a support ticket.

**Remember**: Always test deployments in a staging environment before applying to production!