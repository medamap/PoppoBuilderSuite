#!/bin/bash

#
# Issue #131: Production Setup Script
#
# Automated production environment setup with:
# - System dependencies installation
# - Environment configuration
# - Security hardening
# - Service configuration
# - Monitoring setup
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
LOG_FILE="/var/log/poppo-setup.log"
USER="poppo"
GROUP="poppo"
DATA_DIR="/opt/poppobuilder"
CONFIG_DIR="/etc/poppobuilder"

# Functions
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $*${NC}"
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"
}

warn() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING: $*${NC}"
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] WARNING: $*" >> "$LOG_FILE"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: $*${NC}"
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: $*" >> "$LOG_FILE"
}

info() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')] $*${NC}"
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"
}

check_root() {
    if [[ $EUID -ne 0 ]]; then
        error "This script must be run as root"
        exit 1
    fi
}

detect_os() {
    if [[ -f /etc/os-release ]]; then
        . /etc/os-release
        OS=$NAME
        VER=$VERSION_ID
    else
        error "Cannot detect operating system"
        exit 1
    fi
    
    log "Detected OS: $OS $VER"
}

install_dependencies() {
    log "Installing system dependencies..."
    
    case "$OS" in
        "Ubuntu"*|"Debian"*)
            apt-get update
            apt-get install -y \
                curl \
                wget \
                git \
                build-essential \
                python3 \
                python3-pip \
                nginx \
                redis-server \
                postgresql \
                postgresql-contrib \
                fail2ban \
                ufw \
                htop \
                jq \
                supervisor \
                logrotate \
                cron
            ;;
        "CentOS"*|"Red Hat"*|"Rocky"*|"AlmaLinux"*)
            yum update -y
            yum install -y \
                curl \
                wget \
                git \
                gcc \
                gcc-c++ \
                make \
                python3 \
                python3-pip \
                nginx \
                redis \
                postgresql-server \
                postgresql-contrib \
                fail2ban \
                firewalld \
                htop \
                jq \
                supervisor \
                logrotate \
                cronie
            ;;
        *)
            error "Unsupported operating system: $OS"
            exit 1
            ;;
    esac
    
    log "System dependencies installed successfully"
}

install_nodejs() {
    log "Installing Node.js..."
    
    # Install Node.js using NodeSource repository
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    
    case "$OS" in
        "Ubuntu"*|"Debian"*)
            apt-get install -y nodejs
            ;;
        "CentOS"*|"Red Hat"*|"Rocky"*|"AlmaLinux"*)
            yum install -y nodejs npm
            ;;
    esac
    
    # Verify installation
    node_version=$(node --version)
    npm_version=$(npm --version)
    
    log "Node.js installed: $node_version"
    log "npm installed: $npm_version"
}

create_user() {
    log "Creating PoppoBuilder user..."
    
    if ! id "$USER" &>/dev/null; then
        useradd -r -s /bin/bash -d "$DATA_DIR" -m "$USER"
        log "User $USER created"
    else
        log "User $USER already exists"
    fi
    
    # Create group if it doesn't exist
    if ! getent group "$GROUP" &>/dev/null; then
        groupadd "$GROUP"
        log "Group $GROUP created"
    fi
    
    # Add user to group
    usermod -a -G "$GROUP" "$USER"
}

setup_directories() {
    log "Setting up directories..."
    
    # Create directories
    mkdir -p "$DATA_DIR"/{logs,data,config,scripts,backups}
    mkdir -p "$CONFIG_DIR"
    mkdir -p /var/log/poppobuilder
    mkdir -p /var/run/poppobuilder
    
    # Set ownership
    chown -R "$USER:$GROUP" "$DATA_DIR"
    chown -R "$USER:$GROUP" /var/log/poppobuilder
    chown -R "$USER:$GROUP" /var/run/poppobuilder
    
    # Set permissions
    chmod 755 "$DATA_DIR"
    chmod 755 "$CONFIG_DIR"
    chmod 755 /var/log/poppobuilder
    chmod 755 /var/run/poppobuilder
    
    log "Directories created and configured"
}

install_application() {
    log "Installing PoppoBuilder application..."
    
    # Copy application files
    cp -r "$PROJECT_ROOT"/* "$DATA_DIR/"
    
    # Set ownership
    chown -R "$USER:$GROUP" "$DATA_DIR"
    
    # Install npm dependencies as poppo user
    sudo -u "$USER" bash -c "cd $DATA_DIR && npm ci --production"
    
    log "Application installed successfully"
}

configure_database() {
    log "Configuring PostgreSQL database..."
    
    case "$OS" in
        "Ubuntu"*|"Debian"*)
            # Initialize PostgreSQL
            sudo -u postgres initdb -D /var/lib/postgresql/data
            systemctl enable postgresql
            systemctl start postgresql
            ;;
        "CentOS"*|"Red Hat"*|"Rocky"*|"AlmaLinux"*)
            # Initialize PostgreSQL
            postgresql-setup --initdb
            systemctl enable postgresql
            systemctl start postgresql
            ;;
    esac
    
    # Create database and user
    sudo -u postgres psql << EOF
CREATE USER poppobuilder WITH PASSWORD 'poppobuilder_production_password';
CREATE DATABASE poppobuilder_production OWNER poppobuilder;
GRANT ALL PRIVILEGES ON DATABASE poppobuilder_production TO poppobuilder;
\\q
EOF
    
    log "PostgreSQL configured successfully"
}

configure_redis() {
    log "Configuring Redis..."
    
    # Configure Redis
    cat > /etc/redis/redis.conf << 'EOF'
# Redis configuration for PoppoBuilder
bind 127.0.0.1
port 6379
daemonize yes
supervised systemd
pidfile /var/run/redis/redis-server.pid
loglevel notice
logfile /var/log/redis/redis-server.log
databases 16
save 900 1
save 300 10
save 60 10000
rdbcompression yes
rdbchecksum yes
dbfilename dump.rdb
dir /var/lib/redis
maxmemory 256mb
maxmemory-policy allkeys-lru
EOF
    
    # Enable and start Redis
    systemctl enable redis-server
    systemctl start redis-server
    
    log "Redis configured successfully"
}

configure_nginx() {
    log "Configuring Nginx..."
    
    # Create Nginx configuration
    cat > /etc/nginx/sites-available/poppobuilder << 'EOF'
server {
    listen 80;
    server_name poppobuilder.com www.poppobuilder.com;
    
    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name poppobuilder.com www.poppobuilder.com;
    
    # SSL configuration
    ssl_certificate /etc/ssl/certs/poppobuilder.crt;
    ssl_certificate_key /etc/ssl/private/poppobuilder.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    
    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    
    # Proxy to PoppoBuilder
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }
    
    # Dashboard
    location /dashboard {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    
    # Health check endpoint
    location /health {
        access_log off;
        proxy_pass http://127.0.0.1:3000/health;
    }
}
EOF
    
    # Enable site
    ln -sf /etc/nginx/sites-available/poppobuilder /etc/nginx/sites-enabled/
    
    # Remove default site
    rm -f /etc/nginx/sites-enabled/default
    
    # Test configuration
    nginx -t
    
    # Enable and restart Nginx
    systemctl enable nginx
    systemctl restart nginx
    
    log "Nginx configured successfully"
}

create_systemd_service() {
    log "Creating systemd service..."
    
    # Main PoppoBuilder service
    cat > /etc/systemd/system/poppobuilder.service << EOF
[Unit]
Description=PoppoBuilder Main Service
After=network.target postgresql.service redis-server.service
Requires=postgresql.service redis-server.service

[Service]
Type=simple
User=$USER
Group=$GROUP
WorkingDirectory=$DATA_DIR
ExecStart=/usr/bin/node src/minimal-poppo.js
ExecReload=/bin/kill -HUP \$MAINPID
Restart=always
RestartSec=10
Environment=NODE_ENV=production
Environment=PORT=3000
EnvironmentFile=$CONFIG_DIR/environment

# Security
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DATA_DIR /var/log/poppobuilder /var/run/poppobuilder
PrivateTmp=true

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=poppobuilder

[Install]
WantedBy=multi-user.target
EOF

    # Dashboard service
    cat > /etc/systemd/system/poppobuilder-dashboard.service << EOF
[Unit]
Description=PoppoBuilder Dashboard Service
After=network.target poppobuilder.service
Requires=poppobuilder.service

[Service]
Type=simple
User=$USER
Group=$GROUP
WorkingDirectory=$DATA_DIR
ExecStart=/usr/bin/node dashboard/server/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
Environment=DASHBOARD_PORT=3001
EnvironmentFile=$CONFIG_DIR/environment

# Security
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DATA_DIR /var/log/poppobuilder
PrivateTmp=true

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=poppobuilder-dashboard

[Install]
WantedBy=multi-user.target
EOF
    
    # Reload systemd
    systemctl daemon-reload
    
    log "Systemd services created"
}

configure_environment() {
    log "Configuring environment..."
    
    # Create environment file
    cat > "$CONFIG_DIR/environment" << 'EOF'
# PoppoBuilder Production Environment
NODE_ENV=production
PORT=3000
DASHBOARD_PORT=3001

# Database
DATABASE_TYPE=postgresql
DATABASE_HOST=localhost
DATABASE_NAME=poppobuilder_production
DATABASE_USER=poppobuilder
DATABASE_PASSWORD=poppobuilder_production_password

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Logging
LOG_LEVEL=info
LOG_ROTATION_ENABLED=true
LOG_MAX_SIZE=100MB
LOG_MAX_FILES=10

# Security
DASHBOARD_AUTH_ENABLED=true
DASHBOARD_USERNAME=admin
DASHBOARD_PASSWORD=change_me_in_production

# GitHub (to be configured)
GITHUB_TOKEN=
CLAUDE_API_KEY=

# Monitoring
ENABLE_METRICS=true
PROMETHEUS_PORT=9090
EOF
    
    # Set permissions
    chown root:$GROUP "$CONFIG_DIR/environment"
    chmod 640 "$CONFIG_DIR/environment"
    
    log "Environment configured successfully"
}

setup_logrotate() {
    log "Setting up log rotation..."
    
    cat > /etc/logrotate.d/poppobuilder << 'EOF'
/var/log/poppobuilder/*.log {
    daily
    missingok
    rotate 52
    compress
    notifempty
    create 644 poppo poppo
    postrotate
        systemctl reload poppobuilder
        systemctl reload poppobuilder-dashboard
    endscript
}
EOF
    
    log "Log rotation configured"
}

setup_monitoring() {
    log "Setting up monitoring..."
    
    # Create monitoring directory
    mkdir -p "$DATA_DIR/monitoring"
    
    # Basic health check script
    cat > "$DATA_DIR/scripts/health-check.sh" << 'EOF'
#!/bin/bash
# PoppoBuilder Health Check

HEALTH_URL="http://localhost:3000/health"
DASHBOARD_URL="http://localhost:3001/api/health"

# Check main service
if curl -f -s "$HEALTH_URL" > /dev/null; then
    echo "PoppoBuilder: OK"
else
    echo "PoppoBuilder: FAILED"
    exit 1
fi

# Check dashboard
if curl -f -s "$DASHBOARD_URL" > /dev/null; then
    echo "Dashboard: OK"
else
    echo "Dashboard: FAILED"
    exit 1
fi

echo "All services: OK"
EOF
    
    chmod +x "$DATA_DIR/scripts/health-check.sh"
    chown "$USER:$GROUP" "$DATA_DIR/scripts/health-check.sh"
    
    log "Monitoring setup completed"
}

setup_firewall() {
    log "Configuring firewall..."
    
    case "$OS" in
        "Ubuntu"*|"Debian"*)
            # Configure UFW
            ufw --force reset
            ufw default deny incoming
            ufw default allow outgoing
            
            # Allow SSH
            ufw allow ssh
            
            # Allow HTTP/HTTPS
            ufw allow 80/tcp
            ufw allow 443/tcp
            
            # Enable firewall
            ufw --force enable
            ;;
        "CentOS"*|"Red Hat"*|"Rocky"*|"AlmaLinux"*)
            # Configure firewalld
            systemctl enable firewalld
            systemctl start firewalld
            
            # Allow services
            firewall-cmd --permanent --add-service=ssh
            firewall-cmd --permanent --add-service=http
            firewall-cmd --permanent --add-service=https
            
            # Reload firewall
            firewall-cmd --reload
            ;;
    esac
    
    log "Firewall configured successfully"
}

setup_fail2ban() {
    log "Configuring Fail2ban..."
    
    # Configure Fail2ban for SSH and Nginx
    cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5
backend = systemd

[sshd]
enabled = true
port = ssh
logpath = %(sshd_log)s

[nginx-http-auth]
enabled = true
port = http,https
logpath = /var/log/nginx/error.log

[nginx-limit-req]
enabled = true
port = http,https
logpath = /var/log/nginx/error.log
maxretry = 10

[nginx-botsearch]
enabled = true
port = http,https
logpath = /var/log/nginx/access.log
maxretry = 2
EOF
    
    # Enable and start Fail2ban
    systemctl enable fail2ban
    systemctl start fail2ban
    
    log "Fail2ban configured successfully"
}

create_backup_script() {
    log "Creating backup script..."
    
    cat > "$DATA_DIR/scripts/backup.sh" << 'EOF'
#!/bin/bash
# PoppoBuilder Backup Script

BACKUP_DIR="/opt/poppobuilder/backups"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="poppobuilder_backup_$DATE"

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Backup database
pg_dump -U poppobuilder poppobuilder_production > "$BACKUP_DIR/${BACKUP_NAME}_db.sql"

# Backup application data
tar -czf "$BACKUP_DIR/${BACKUP_NAME}_data.tar.gz" -C /opt/poppobuilder \
    data logs config --exclude='logs/*.log'

# Backup configuration
tar -czf "$BACKUP_DIR/${BACKUP_NAME}_config.tar.gz" -C /etc poppobuilder

# Remove old backups (keep 30 days)
find "$BACKUP_DIR" -name "poppobuilder_backup_*" -mtime +30 -delete

echo "Backup completed: $BACKUP_NAME"
EOF
    
    chmod +x "$DATA_DIR/scripts/backup.sh"
    chown "$USER:$GROUP" "$DATA_DIR/scripts/backup.sh"
    
    # Add to crontab
    (crontab -u "$USER" -l 2>/dev/null; echo "0 2 * * * $DATA_DIR/scripts/backup.sh") | crontab -u "$USER" -
    
    log "Backup script created and scheduled"
}

setup_ssl() {
    log "Setting up SSL certificates..."
    
    # Create self-signed certificate for testing
    # In production, use Let's Encrypt or proper certificates
    
    mkdir -p /etc/ssl/private
    
    # Generate private key
    openssl genrsa -out /etc/ssl/private/poppobuilder.key 2048
    
    # Generate certificate
    openssl req -new -x509 -key /etc/ssl/private/poppobuilder.key \
        -out /etc/ssl/certs/poppobuilder.crt -days 365 \
        -subj "/C=US/ST=State/L=City/O=PoppoBuilder/CN=poppobuilder.com"
    
    # Set permissions
    chmod 600 /etc/ssl/private/poppobuilder.key
    chmod 644 /etc/ssl/certs/poppobuilder.crt
    
    warn "Self-signed certificate created. Please replace with proper SSL certificate in production."
    
    log "SSL certificates configured"
}

start_services() {
    log "Starting services..."
    
    # Enable and start services
    systemctl enable poppobuilder
    systemctl enable poppobuilder-dashboard
    
    systemctl start poppobuilder
    systemctl start poppobuilder-dashboard
    
    # Wait for services to start
    sleep 10
    
    # Check service status
    if systemctl is-active --quiet poppobuilder; then
        log "PoppoBuilder service started successfully"
    else
        error "Failed to start PoppoBuilder service"
        systemctl status poppobuilder
    fi
    
    if systemctl is-active --quiet poppobuilder-dashboard; then
        log "Dashboard service started successfully"
    else
        error "Failed to start Dashboard service"
        systemctl status poppobuilder-dashboard
    fi
}

run_health_check() {
    log "Running health check..."
    
    # Wait for services to be ready
    sleep 30
    
    if "$DATA_DIR/scripts/health-check.sh"; then
        log "Health check passed"
    else
        error "Health check failed"
        exit 1
    fi
}

print_summary() {
    log "Setup completed successfully!"
    
    cat << EOF

🎉 PoppoBuilder Production Setup Complete!

📊 Service Status:
   - PoppoBuilder: $(systemctl is-active poppobuilder)
   - Dashboard: $(systemctl is-active poppobuilder-dashboard)
   - PostgreSQL: $(systemctl is-active postgresql)
   - Redis: $(systemctl is-active redis-server)
   - Nginx: $(systemctl is-active nginx)

🌐 URLs:
   - Main Application: https://$(hostname)/
   - Dashboard: https://$(hostname)/dashboard

📁 Important Directories:
   - Application: $DATA_DIR
   - Configuration: $CONFIG_DIR
   - Logs: /var/log/poppobuilder

🔧 Management Commands:
   - Start: systemctl start poppobuilder
   - Stop: systemctl stop poppobuilder
   - Restart: systemctl restart poppobuilder
   - Status: systemctl status poppobuilder
   - Logs: journalctl -u poppobuilder -f

📋 Next Steps:
   1. Configure GitHub Token in $CONFIG_DIR/environment
   2. Configure Claude API Key in $CONFIG_DIR/environment
   3. Replace self-signed SSL certificate with proper certificate
   4. Change default dashboard password in $CONFIG_DIR/environment
   5. Review and adjust firewall rules if needed

⚠️  Security Notes:
   - Change default passwords immediately
   - Review and secure environment variables
   - Set up proper SSL certificates
   - Configure monitoring and alerting

EOF
}

# Main execution
main() {
    log "Starting PoppoBuilder production setup..."
    
    check_root
    detect_os
    install_dependencies
    install_nodejs
    create_user
    setup_directories
    install_application
    configure_database
    configure_redis
    configure_nginx
    create_systemd_service
    configure_environment
    setup_logrotate
    setup_monitoring
    setup_firewall
    setup_fail2ban
    create_backup_script
    setup_ssl
    start_services
    run_health_check
    print_summary
    
    log "PoppoBuilder production setup completed successfully!"
}

# Run main function
main "$@"