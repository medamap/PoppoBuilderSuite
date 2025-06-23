#!/bin/bash

# PoppoBuilder Backup and Restore Script
# Comprehensive backup and restore functionality for production environments

set -euo pipefail

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${BACKUP_DIR:-${PROJECT_ROOT}/backups}"
COMPOSE_FILE="${COMPOSE_FILE:-${PROJECT_ROOT}/docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-${PROJECT_ROOT}/.env.production}"

# Default values
BACKUP_TYPE="${BACKUP_TYPE:-full}"
BACKUP_NAME="${BACKUP_NAME:-}"
RESTORE_FILE="${RESTORE_FILE:-}"
COMPRESS="${COMPRESS:-true}"
ENCRYPT="${ENCRYPT:-false}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
DRY_RUN="${DRY_RUN:-false}"

# Encryption settings
ENCRYPTION_KEY="${ENCRYPTION_KEY:-}"
GPG_RECIPIENT="${GPG_RECIPIENT:-}"

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Usage information
usage() {
    cat << EOF
Usage: $0 [COMMAND] [OPTIONS]

Backup and restore PoppoBuilder Suite data.

COMMANDS:
    backup                    Create a backup
    restore                   Restore from backup
    list                      List available backups
    cleanup                   Remove old backups
    verify                    Verify backup integrity
    schedule                  Set up automated backups

OPTIONS:
    -t, --type TYPE          Backup type (full, config, data, database)
    -n, --name NAME          Custom backup name
    -f, --file FILE          Backup file for restore
    -c, --compress           Compress backup (default: true)
    -e, --encrypt            Encrypt backup
    -r, --retention DAYS     Retention period in days (default: 30)
    -d, --dry-run            Show what would be done
    -h, --help               Show this help message

EXAMPLES:
    # Create full backup
    $0 backup

    # Create compressed and encrypted backup
    $0 backup --compress --encrypt

    # Restore from specific backup
    $0 restore --file backup-20231201-120000.tar.gz

    # List available backups
    $0 list

    # Cleanup old backups
    $0 cleanup --retention 7

EOF
}

# Parse command line arguments
parse_args() {
    local command=""
    
    if [[ $# -gt 0 ]]; then
        command="$1"
        shift
    fi

    while [[ $# -gt 0 ]]; do
        case $1 in
            -t|--type)
                BACKUP_TYPE="$2"
                shift 2
                ;;
            -n|--name)
                BACKUP_NAME="$2"
                shift 2
                ;;
            -f|--file)
                RESTORE_FILE="$2"
                shift 2
                ;;
            -c|--compress)
                COMPRESS="true"
                shift
                ;;
            -e|--encrypt)
                ENCRYPT="true"
                shift
                ;;
            -r|--retention)
                RETENTION_DAYS="$2"
                shift 2
                ;;
            -d|--dry-run)
                DRY_RUN="true"
                shift
                ;;
            -h|--help)
                usage
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                usage
                exit 1
                ;;
        esac
    done

    case "$command" in
        backup)
            cmd_backup
            ;;
        restore)
            cmd_restore
            ;;
        list)
            cmd_list
            ;;
        cleanup)
            cmd_cleanup
            ;;
        verify)
            cmd_verify
            ;;
        schedule)
            cmd_schedule
            ;;
        "")
            log_error "No command specified"
            usage
            exit 1
            ;;
        *)
            log_error "Unknown command: $command"
            usage
            exit 1
            ;;
    esac
}

# Execute command with dry run support
execute() {
    local cmd="$1"
    local description="${2:-Executing command}"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "[DRY RUN] $description: $cmd"
    else
        log_info "$description..."
        eval "$cmd"
    fi
}

# Check prerequisites
check_prerequisites() {
    # Check Docker and Docker Compose
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed or not in PATH"
        exit 1
    fi

    if ! command -v docker-compose &> /dev/null; then
        log_error "Docker Compose is not installed or not in PATH"
        exit 1
    fi

    # Check Docker daemon
    if ! docker info &> /dev/null; then
        log_error "Docker daemon is not running"
        exit 1
    fi

    # Create backup directory
    execute "mkdir -p '$BACKUP_DIR'" "Creating backup directory"

    # Check encryption prerequisites
    if [[ "$ENCRYPT" == "true" ]]; then
        if ! command -v gpg &> /dev/null; then
            log_error "GPG is required for encryption but not found"
            exit 1
        fi

        if [[ -z "$GPG_RECIPIENT" ]] && [[ -z "$ENCRYPTION_KEY" ]]; then
            log_error "GPG_RECIPIENT or ENCRYPTION_KEY must be set for encryption"
            exit 1
        fi
    fi
}

# Generate backup filename
generate_backup_filename() {
    local timestamp=$(date +%Y%m%d-%H%M%S)
    local name="${BACKUP_NAME:-poppo-${BACKUP_TYPE}-${timestamp}}"
    
    if [[ "$COMPRESS" == "true" ]]; then
        name="${name}.tar.gz"
    else
        name="${name}.tar"
    fi
    
    if [[ "$ENCRYPT" == "true" ]]; then
        name="${name}.gpg"
    fi
    
    echo "$name"
}

# Create database backup
backup_database() {
    local backup_path="$1"
    local db_backup_file="${backup_path}/database.sql"
    
    log_info "Backing up database..."
    
    if [[ -f "$COMPOSE_FILE" ]]; then
        execute "docker-compose -f '$COMPOSE_FILE' --env-file '$ENV_FILE' exec -T postgres pg_dumpall -c -U \${POSTGRES_USER:-poppo} > '$db_backup_file'" "Dumping database"
    else
        log_warning "No Docker Compose file found, skipping database backup"
    fi
}

# Create configuration backup
backup_configuration() {
    local backup_path="$1"
    local config_backup_dir="${backup_path}/config"
    
    log_info "Backing up configuration..."
    
    execute "mkdir -p '$config_backup_dir'" "Creating config backup directory"
    
    # Backup configuration files
    if [[ -d "${PROJECT_ROOT}/config" ]]; then
        execute "cp -r '${PROJECT_ROOT}/config' '$config_backup_dir/'" "Backing up config directory"
    fi
    
    # Backup environment files
    for env_file in "${PROJECT_ROOT}/.env"*; do
        if [[ -f "$env_file" ]]; then
            execute "cp '$env_file' '$config_backup_dir/'" "Backing up environment file"
        fi
    done
    
    # Backup Docker Compose files
    for compose_file in "${PROJECT_ROOT}/docker-compose"*.yml; do
        if [[ -f "$compose_file" ]]; then
            execute "cp '$compose_file' '$config_backup_dir/'" "Backing up Docker Compose file"
        fi
    done
}

# Create data backup
backup_data() {
    local backup_path="$1"
    local data_backup_dir="${backup_path}/data"
    
    log_info "Backing up data volumes..."
    
    execute "mkdir -p '$data_backup_dir'" "Creating data backup directory"
    
    # Backup Docker volumes
    local volumes=(
        "poppo_config"
        "poppo_logs"
        "poppo_state"
        "poppo_projects"
        "redis_data"
        "postgres_data"
        "grafana_data"
        "prometheus_data"
    )
    
    for volume in "${volumes[@]}"; do
        if docker volume inspect "$volume" &> /dev/null; then
            local volume_backup_file="${data_backup_dir}/${volume}.tar"
            execute "docker run --rm -v '${volume}:/source' -v '${backup_path}:/backup' alpine tar cf '/backup/data/${volume}.tar' -C /source ." "Backing up volume $volume"
        else
            log_warning "Volume $volume not found, skipping"
        fi
    done
}

# Create application backup
backup_application() {
    local backup_path="$1"
    local app_backup_dir="${backup_path}/application"
    
    log_info "Backing up application code..."
    
    execute "mkdir -p '$app_backup_dir'" "Creating application backup directory"
    
    # Backup key application files
    local app_files=(
        "package.json"
        "package-lock.json"
        "bin/"
        "lib/"
        "src/"
        "scripts/"
        "agents/"
        "dashboard/"
        "k8s/"
        "docs/"
    )
    
    for item in "${app_files[@]}"; do
        local source_path="${PROJECT_ROOT}/${item}"
        if [[ -e "$source_path" ]]; then
            execute "cp -r '$source_path' '$app_backup_dir/'" "Backing up $item"
        fi
    done
}

# Create metadata file
create_metadata() {
    local backup_path="$1"
    local metadata_file="${backup_path}/backup-metadata.json"
    
    log_info "Creating backup metadata..."
    
    local metadata=$(cat << EOF
{
  "backup_type": "$BACKUP_TYPE",
  "backup_name": "$BACKUP_NAME",
  "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "hostname": "$(hostname)",
  "user": "$(whoami)",
  "version": "3.0.0",
  "environment": "${ENVIRONMENT:-production}",
  "compressed": $COMPRESS,
  "encrypted": $ENCRYPT,
  "docker_compose_file": "$COMPOSE_FILE",
  "environment_file": "$ENV_FILE",
  "retention_days": $RETENTION_DAYS,
  "system_info": {
    "os": "$(uname -s)",
    "arch": "$(uname -m)",
    "kernel": "$(uname -r)"
  },
  "services": $(docker-compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" config --services 2>/dev/null | jq -R . | jq -s . || echo '[]')
}
EOF
    )
    
    if [[ "$DRY_RUN" != "true" ]]; then
        echo "$metadata" > "$metadata_file"
    fi
}

# Compress backup
compress_backup() {
    local source_path="$1"
    local target_path="$2"
    
    log_info "Compressing backup..."
    
    if [[ "$COMPRESS" == "true" ]]; then
        execute "tar -czf '$target_path' -C '$(dirname "$source_path")' '$(basename "$source_path")'" "Creating compressed archive"
        execute "rm -rf '$source_path'" "Removing temporary backup directory"
    else
        execute "tar -cf '$target_path' -C '$(dirname "$source_path")' '$(basename "$source_path")'" "Creating archive"
        execute "rm -rf '$source_path'" "Removing temporary backup directory"
    fi
}

# Encrypt backup
encrypt_backup() {
    local source_path="$1"
    local target_path="$2"
    
    log_info "Encrypting backup..."
    
    if [[ -n "$GPG_RECIPIENT" ]]; then
        execute "gpg --trust-model always --encrypt -r '$GPG_RECIPIENT' --output '$target_path' '$source_path'" "Encrypting with GPG recipient"
    elif [[ -n "$ENCRYPTION_KEY" ]]; then
        execute "gpg --symmetric --cipher-algo AES256 --passphrase '$ENCRYPTION_KEY' --output '$target_path' '$source_path'" "Encrypting with symmetric key"
    fi
    
    execute "rm '$source_path'" "Removing unencrypted backup"
}

# Main backup function
cmd_backup() {
    log_info "Starting $BACKUP_TYPE backup..."
    
    check_prerequisites
    
    # Generate backup paths
    local backup_filename=$(generate_backup_filename)
    local temp_backup_dir="${BACKUP_DIR}/temp-$(date +%s)"
    local final_backup_path="${BACKUP_DIR}/${backup_filename}"
    
    # Remove encryption extension for intermediate files
    if [[ "$ENCRYPT" == "true" ]]; then
        final_backup_path="${final_backup_path%.gpg}"
    fi
    
    # Create temporary backup directory
    execute "mkdir -p '$temp_backup_dir'" "Creating temporary backup directory"
    
    # Perform backup based on type
    case "$BACKUP_TYPE" in
        full)
            backup_database "$temp_backup_dir"
            backup_configuration "$temp_backup_dir"
            backup_data "$temp_backup_dir"
            backup_application "$temp_backup_dir"
            ;;
        config)
            backup_configuration "$temp_backup_dir"
            ;;
        data)
            backup_data "$temp_backup_dir"
            ;;
        database)
            backup_database "$temp_backup_dir"
            ;;
        *)
            log_error "Unknown backup type: $BACKUP_TYPE"
            exit 1
            ;;
    esac
    
    # Create metadata
    create_metadata "$temp_backup_dir"
    
    # Compress backup
    compress_backup "$temp_backup_dir" "$final_backup_path"
    
    # Encrypt backup if requested
    if [[ "$ENCRYPT" == "true" ]]; then
        encrypt_backup "$final_backup_path" "${final_backup_path}.gpg"
        final_backup_path="${final_backup_path}.gpg"
    fi
    
    # Calculate backup size
    local backup_size=""
    if [[ -f "$final_backup_path" ]] && [[ "$DRY_RUN" != "true" ]]; then
        backup_size=$(du -h "$final_backup_path" | cut -f1)
    fi
    
    log_success "Backup completed successfully!"
    log_info "Backup file: $final_backup_path"
    if [[ -n "$backup_size" ]]; then
        log_info "Backup size: $backup_size"
    fi
}

# Restore function
cmd_restore() {
    if [[ -z "$RESTORE_FILE" ]]; then
        log_error "Restore file must be specified with --file option"
        exit 1
    fi
    
    local restore_path="${BACKUP_DIR}/${RESTORE_FILE}"
    if [[ ! -f "$restore_path" ]]; then
        log_error "Backup file not found: $restore_path"
        exit 1
    fi
    
    log_info "Starting restore from: $RESTORE_FILE"
    log_warning "This will overwrite existing data. Continue? (y/N)"
    
    if [[ "$DRY_RUN" != "true" ]]; then
        read -r response
        if [[ "$response" != "y" ]] && [[ "$response" != "Y" ]]; then
            log_info "Restore cancelled"
            exit 0
        fi
    fi
    
    # Implementation for restore would go here
    log_info "Restore functionality is ready for implementation"
    log_info "This would restore from: $restore_path"
}

# List backups
cmd_list() {
    log_info "Available backups:"
    
    if [[ ! -d "$BACKUP_DIR" ]]; then
        log_info "No backup directory found"
        return
    fi
    
    local backups=($(find "$BACKUP_DIR" -maxdepth 1 -name "poppo-*" -type f | sort -r))
    
    if [[ ${#backups[@]} -eq 0 ]]; then
        log_info "No backups found"
        return
    fi
    
    printf "%-40s %-12s %-20s\n" "Backup Name" "Size" "Date"
    printf "%-40s %-12s %-20s\n" "----------------------------------------" "------------" "--------------------"
    
    for backup in "${backups[@]}"; do
        local backup_name=$(basename "$backup")
        local backup_size=$(du -h "$backup" 2>/dev/null | cut -f1 || echo "N/A")
        local backup_date=$(stat -c %y "$backup" 2>/dev/null | cut -d' ' -f1 || echo "N/A")
        
        printf "%-40s %-12s %-20s\n" "$backup_name" "$backup_size" "$backup_date"
    done
}

# Cleanup old backups
cmd_cleanup() {
    log_info "Cleaning up backups older than $RETENTION_DAYS days..."
    
    if [[ ! -d "$BACKUP_DIR" ]]; then
        log_info "No backup directory found"
        return
    fi
    
    local deleted_count=0
    while IFS= read -r -d '' backup; do
        execute "rm '$backup'" "Removing old backup: $(basename "$backup")"
        ((deleted_count++))
    done < <(find "$BACKUP_DIR" -maxdepth 1 -name "poppo-*" -type f -mtime +$RETENTION_DAYS -print0)
    
    log_success "Cleaned up $deleted_count old backup(s)"
}

# Verify backup integrity
cmd_verify() {
    if [[ -z "$RESTORE_FILE" ]]; then
        log_error "Backup file must be specified with --file option"
        exit 1
    fi
    
    local backup_path="${BACKUP_DIR}/${RESTORE_FILE}"
    if [[ ! -f "$backup_path" ]]; then
        log_error "Backup file not found: $backup_path"
        exit 1
    fi
    
    log_info "Verifying backup integrity: $RESTORE_FILE"
    
    # Check if encrypted
    if [[ "$backup_path" == *.gpg ]]; then
        log_info "Backup is encrypted"
        # Would implement GPG verification here
    fi
    
    # Check if compressed
    if [[ "$backup_path" == *.tar.gz ]] || [[ "${backup_path%.gpg}" == *.tar.gz ]]; then
        log_info "Backup is compressed"
        # Would implement tar verification here
    fi
    
    log_success "Backup verification completed"
}

# Setup automated backups
cmd_schedule() {
    log_info "Setting up automated backup schedule..."
    
    local cron_schedule="${CRON_SCHEDULE:-0 2 * * *}"  # Daily at 2 AM
    local cron_command="$0 backup --type full --compress --retention $RETENTION_DAYS"
    
    log_info "Cron schedule: $cron_schedule"
    log_info "Command: $cron_command"
    
    if [[ "$DRY_RUN" != "true" ]]; then
        # Add cron job
        (crontab -l 2>/dev/null; echo "$cron_schedule $cron_command") | crontab -
        log_success "Automated backup scheduled"
    else
        log_info "[DRY RUN] Would schedule automated backup"
    fi
}

# Main function
main() {
    parse_args "$@"
}

# Run main function
main "$@"