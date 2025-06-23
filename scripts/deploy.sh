#!/bin/bash

# PoppoBuilder Suite Production Deployment Script
# This script handles complete deployment of PoppoBuilder to production environment

set -euo pipefail

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DEPLOYMENT_ENV="${DEPLOYMENT_ENV:-production}"
COMPOSE_FILE="${PROJECT_ROOT}/docker-compose.prod.yml"
ENV_FILE="${PROJECT_ROOT}/.env.${DEPLOYMENT_ENV}"

# Default values
SKIP_BACKUP="${SKIP_BACKUP:-false}"
SKIP_TESTS="${SKIP_TESTS:-false}"
FORCE_REBUILD="${FORCE_REBUILD:-false}"
DRY_RUN="${DRY_RUN:-false}"

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
Usage: $0 [OPTIONS]

Deploy PoppoBuilder Suite to production environment.

OPTIONS:
    -e, --env ENV              Deployment environment (default: production)
    -f, --force-rebuild        Force rebuild of all images
    -s, --skip-backup         Skip pre-deployment backup
    -t, --skip-tests          Skip running tests
    -d, --dry-run             Show what would be done without executing
    -h, --help                Show this help message

ENVIRONMENT VARIABLES:
    DEPLOYMENT_ENV            Target environment (production, staging, etc.)
    SKIP_BACKUP              Skip backup step (true/false)
    SKIP_TESTS               Skip test execution (true/false)
    FORCE_REBUILD            Force image rebuild (true/false)
    DRY_RUN                  Dry run mode (true/false)

EXAMPLES:
    # Standard production deployment
    $0

    # Deploy to staging environment
    $0 --env staging

    # Force rebuild and deploy
    $0 --force-rebuild

    # Dry run to see what would happen
    $0 --dry-run

EOF
}

# Parse command line arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            -e|--env)
                DEPLOYMENT_ENV="$2"
                shift 2
                ;;
            -f|--force-rebuild)
                FORCE_REBUILD="true"
                shift
                ;;
            -s|--skip-backup)
                SKIP_BACKUP="true"
                shift
                ;;
            -t|--skip-tests)
                SKIP_TESTS="true"
                shift
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

    # Update paths based on environment
    COMPOSE_FILE="${PROJECT_ROOT}/docker-compose.${DEPLOYMENT_ENV}.yml"
    ENV_FILE="${PROJECT_ROOT}/.env.${DEPLOYMENT_ENV}"
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
    log_info "Checking prerequisites..."

    # Check if running as root (not recommended for production)
    if [[ $EUID -eq 0 ]]; then
        log_warning "Running as root is not recommended for production deployments"
    fi

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

    # Check required files
    if [[ ! -f "$COMPOSE_FILE" ]]; then
        log_error "Docker Compose file not found: $COMPOSE_FILE"
        exit 1
    fi

    if [[ ! -f "$ENV_FILE" ]]; then
        log_warning "Environment file not found: $ENV_FILE"
        log_info "Creating template environment file..."
        cp "${PROJECT_ROOT}/.env.production" "$ENV_FILE"
        log_warning "Please edit $ENV_FILE with your configuration before running deployment"
        exit 1
    fi

    # Check disk space (minimum 5GB recommended)
    local available_space=$(df "$PROJECT_ROOT" | awk 'NR==2 {print $4}')
    local min_space=$((5 * 1024 * 1024)) # 5GB in KB

    if [[ $available_space -lt $min_space ]]; then
        log_warning "Low disk space detected. Recommended: 5GB+, Available: $(($available_space / 1024 / 1024))GB"
    fi

    log_success "Prerequisites check completed"
}

# Validate environment configuration
validate_environment() {
    log_info "Validating environment configuration..."

    # Load environment variables
    if [[ -f "$ENV_FILE" ]]; then
        set -a
        source "$ENV_FILE"
        set +a
    fi

    # Check required environment variables
    local required_vars=(
        "GITHUB_TOKEN"
        "CLAUDE_API_KEY"
        "POSTGRES_PASSWORD"
        "GRAFANA_PASSWORD"
    )

    local missing_vars=()
    for var in "${required_vars[@]}"; do
        if [[ -z "${!var:-}" ]] || [[ "${!var}" == *"changeme"* ]] || [[ "${!var}" == *"your_"* ]]; then
            missing_vars+=("$var")
        fi
    done

    if [[ ${#missing_vars[@]} -gt 0 ]]; then
        log_error "Missing or invalid required environment variables:"
        for var in "${missing_vars[@]}"; do
            log_error "  - $var"
        done
        log_error "Please update $ENV_FILE with valid values"
        exit 1
    fi

    log_success "Environment configuration validated"
}

# Create backup
create_backup() {
    if [[ "$SKIP_BACKUP" == "true" ]]; then
        log_info "Skipping backup as requested"
        return
    fi

    log_info "Creating pre-deployment backup..."

    local backup_dir="${PROJECT_ROOT}/backups"
    local backup_name="poppo-backup-$(date +%Y%m%d-%H%M%S)"
    local backup_path="${backup_dir}/${backup_name}"

    execute "mkdir -p '$backup_dir'" "Creating backup directory"

    # Create comprehensive backup
    local backup_script="${PROJECT_ROOT}/scripts/backup.sh"
    if [[ -f "$backup_script" ]]; then
        execute "$backup_script --output '$backup_path'" "Running backup script"
    else
        # Simple Docker volume backup
        execute "docker-compose -f '$COMPOSE_FILE' --env-file '$ENV_FILE' run --rm -v '$backup_path:/backup' postgres pg_dumpall -h postgres -U poppo > /backup/database.sql || true" "Backing up database"
        execute "docker run --rm -v poppo_config:/source -v '$backup_path:/backup' alpine tar czf /backup/config.tar.gz -C /source ." "Backing up configuration"
        execute "docker run --rm -v poppo_state:/source -v '$backup_path:/backup' alpine tar czf /backup/state.tar.gz -C /source ." "Backing up state"
    fi

    log_success "Backup created: $backup_path"
}

# Run tests
run_tests() {
    if [[ "$SKIP_TESTS" == "true" ]]; then
        log_info "Skipping tests as requested"
        return
    fi

    log_info "Running tests..."

    # Build test image
    execute "docker build -t poppobuilder:test --target test ." "Building test image"

    # Run unit tests
    execute "docker run --rm poppobuilder:test npm test" "Running unit tests"

    # Run integration tests if available
    if [[ -f "${PROJECT_ROOT}/test/integration/index.js" ]]; then
        execute "docker run --rm poppobuilder:test npm run test:integration" "Running integration tests"
    fi

    log_success "Tests completed successfully"
}

# Build images
build_images() {
    log_info "Building Docker images..."

    local build_args=""
    if [[ "$FORCE_REBUILD" == "true" ]]; then
        build_args="--no-cache"
    fi

    execute "docker-compose -f '$COMPOSE_FILE' --env-file '$ENV_FILE' build $build_args" "Building services"

    log_success "Images built successfully"
}

# Deploy services
deploy_services() {
    log_info "Deploying services..."

    # Stop existing services gracefully
    execute "docker-compose -f '$COMPOSE_FILE' --env-file '$ENV_FILE' down --timeout 30" "Stopping existing services"

    # Pull latest images for external services
    execute "docker-compose -f '$COMPOSE_FILE' --env-file '$ENV_FILE' pull redis postgres prometheus grafana nginx" "Pulling latest external images"

    # Create necessary directories and set permissions
    execute "mkdir -p '${PROJECT_ROOT}/data/{config,logs,state,projects}'" "Creating data directories"
    execute "mkdir -p '${PROJECT_ROOT}/config/{nginx,grafana,prometheus,loki,promtail,alertmanager}'" "Creating config directories"

    # Start services
    execute "docker-compose -f '$COMPOSE_FILE' --env-file '$ENV_FILE' up -d" "Starting services"

    # Wait for services to be healthy
    log_info "Waiting for services to be healthy..."
    local max_wait=300 # 5 minutes
    local wait_time=0

    while [[ $wait_time -lt $max_wait ]]; do
        local healthy_services=$(docker-compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps --filter "health=healthy" -q | wc -l)
        local total_services=$(docker-compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps -q | wc -l)

        if [[ $healthy_services -eq $total_services ]] && [[ $total_services -gt 0 ]]; then
            break
        fi

        sleep 10
        wait_time=$((wait_time + 10))
        log_info "Waiting for services... ($wait_time/${max_wait}s)"
    done

    if [[ $wait_time -ge $max_wait ]]; then
        log_warning "Some services may not be fully healthy yet"
        execute "docker-compose -f '$COMPOSE_FILE' --env-file '$ENV_FILE' ps" "Showing service status"
    else
        log_success "All services are healthy"
    fi
}

# Verify deployment
verify_deployment() {
    log_info "Verifying deployment..."

    # Check service health
    local services=("poppobuilder" "redis" "postgres" "prometheus" "grafana")
    for service in "${services[@]}"; do
        local health=$(docker inspect --format='{{.State.Health.Status}}' "poppobuilder-$service" 2>/dev/null || echo "no-healthcheck")
        if [[ "$health" == "healthy" ]] || [[ "$health" == "no-healthcheck" ]]; then
            log_success "$service: $health"
        else
            log_warning "$service: $health"
        fi
    done

    # Test API endpoints
    log_info "Testing API endpoints..."
    
    # Wait a bit for services to settle
    sleep 10
    
    # Test main API
    if curl -f -s "http://localhost:${POPPO_DAEMON_PORT:-3003}/health" > /dev/null; then
        log_success "PoppoBuilder API is responding"
    else
        log_warning "PoppoBuilder API is not responding"
    fi

    # Test Grafana
    if curl -f -s "http://localhost:${GRAFANA_PORT:-3000}/api/health" > /dev/null; then
        log_success "Grafana is responding"
    else
        log_warning "Grafana is not responding"
    fi

    # Test Prometheus
    if curl -f -s "http://localhost:${PROMETHEUS_PORT:-9090}/-/healthy" > /dev/null; then
        log_success "Prometheus is responding"
    else
        log_warning "Prometheus is not responding"
    fi

    log_success "Deployment verification completed"
}

# Show deployment summary
show_summary() {
    log_info "Deployment Summary:"
    echo
    echo "Environment: $DEPLOYMENT_ENV"
    echo "Compose file: $COMPOSE_FILE"
    echo "Environment file: $ENV_FILE"
    echo
    echo "Services URLs:"
    echo "  PoppoBuilder Dashboard: http://localhost:${POPPO_DAEMON_PORT:-3003}"
    echo "  Grafana: http://localhost:${GRAFANA_PORT:-3000}"
    echo "  Prometheus: http://localhost:${PROMETHEUS_PORT:-9090}"
    echo
    echo "Management commands:"
    echo "  View logs: docker-compose -f $COMPOSE_FILE --env-file $ENV_FILE logs -f"
    echo "  Stop services: docker-compose -f $COMPOSE_FILE --env-file $ENV_FILE down"
    echo "  Restart services: docker-compose -f $COMPOSE_FILE --env-file $ENV_FILE restart"
    echo
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "This was a dry run. No actual changes were made."
    else
        log_success "Deployment completed successfully!"
    fi
}

# Cleanup on exit
cleanup() {
    local exit_code=$?
    if [[ $exit_code -ne 0 ]]; then
        log_error "Deployment failed with exit code $exit_code"
        log_info "Check logs with: docker-compose -f $COMPOSE_FILE --env-file $ENV_FILE logs"
    fi
    exit $exit_code
}

# Main deployment function
main() {
    log_info "Starting PoppoBuilder Suite deployment..."
    log_info "Environment: $DEPLOYMENT_ENV"
    log_info "Dry run: $DRY_RUN"
    echo

    # Set trap for cleanup
    trap cleanup EXIT

    # Run deployment steps
    check_prerequisites
    validate_environment
    create_backup
    run_tests
    build_images
    deploy_services
    verify_deployment
    show_summary
}

# Parse arguments and run
parse_args "$@"
main