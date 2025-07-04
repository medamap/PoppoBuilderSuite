#!/bin/bash

# PoppoBuilder Multi-Project Executor
# This script handles round-robin execution of PoppoBuilder across multiple registered projects

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

# PoppoBuilder executable path
POPPOBUILDER_BIN="/opt/homebrew/bin/poppo-builder"
if [ ! -x "$POPPOBUILDER_BIN" ]; then
    POPPOBUILDER_BIN="$(which poppo-builder)"
fi

# Log file
LOG_DIR="/tmp/poppo-builder/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/multi-project-executor-$(date +%Y-%m-%d).log"

# State file for round-robin
STATE_FILE="/tmp/poppo-builder/state/last-project-index.txt"
mkdir -p "$(dirname "$STATE_FILE")"

# Initialize state file if not exists
if [ ! -f "$STATE_FILE" ]; then
    echo "0" > "$STATE_FILE"
fi

# PID directory
PID_DIR="/tmp/poppo-builder/pids"
mkdir -p "$PID_DIR"

# Configuration
POPPOBUILDER_TIMEOUT=${POPPOBUILDER_TIMEOUT:-300}  # 5 minutes default
POPPOBUILDER_HEALTH_CHECK_INTERVAL=${POPPOBUILDER_HEALTH_CHECK_INTERVAL:-30}

# Function to log messages
log() {
    local level=$1
    shift
    local message="$@"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo -e "${timestamp} [${level}] ${message}" | tee -a "$LOG_FILE"
}

# Function to check if process is running
is_process_running() {
    local pid=$1
    if [ -z "$pid" ]; then
        return 1
    fi
    
    # Check if process exists
    if kill -0 "$pid" 2>/dev/null; then
        # Additional check: verify it's actually node process
        local cmd=$(ps -p "$pid" -o comm= 2>/dev/null)
        if [[ "$cmd" == *"node"* ]]; then
            return 0
        fi
    fi
    
    return 1
}

# Function to create PID file
create_pid_file() {
    local project_name=$1
    local pid=$2
    local pidfile="$PID_DIR/poppo-builder-${project_name}.pid"
    
    echo "$pid" > "$pidfile"
    log "DEBUG" "Created PID file: $pidfile (PID: $pid)"
}

# Function to remove PID file
remove_pid_file() {
    local project_name=$1
    local pidfile="$PID_DIR/poppo-builder-${project_name}.pid"
    
    if [ -f "$pidfile" ]; then
        rm -f "$pidfile"
        log "DEBUG" "Removed PID file: $pidfile"
    fi
}

# Function to check for existing process
check_existing_process() {
    local project_name=$1
    local pidfile="$PID_DIR/poppo-builder-${project_name}.pid"
    
    if [ -f "$pidfile" ]; then
        local old_pid=$(cat "$pidfile")
        if is_process_running "$old_pid"; then
            log "WARN" "${YELLOW}Previous PoppoBuilder process still running for ${project_name} (PID: $old_pid)${NC}"
            return 0  # Process is running
        else
            # Stale PID file, remove it
            log "INFO" "Removing stale PID file for ${project_name}"
            remove_pid_file "$project_name"
        fi
    fi
    
    return 1  # No process running
}

# Function to get all registered projects
get_registered_projects() {
    local projects_file="$HOME/.poppobuilder/projects.json"
    
    if [ ! -f "$projects_file" ]; then
        log "WARN" "No projects registered. Projects file not found: $projects_file"
        echo "[]"
        return
    fi
    
    # Extract enabled projects with their paths and priorities, including the project ID
    local projects=$(cat "$projects_file" | jq -r '
        .projects | to_entries[] | 
        select(.value.enabled != false) | 
        {
            id: .key,
            name: (.value.config.name // .key),
            path: .value.path,
            priority: (.value.config.priority // 50),
            weight: (.value.config.weight // 1)
        } | @json')
    echo "$projects"
}

# Function to select next project based on strategy
select_next_project() {
    local projects_json="$1"
    local strategy="${POPPOBUILDER_STRATEGY:-round-robin}"
    
    # Convert JSON array to bash array
    local projects=()
    while IFS= read -r line; do
        projects+=("$line")
    done <<< "$projects_json"
    
    local num_projects=${#projects[@]}
    
    if [ $num_projects -eq 0 ]; then
        log "WARN" "No enabled projects found"
        return 1
    fi
    
    local selected_project=""
    local selected_index=0
    
    case "$strategy" in
        "round-robin")
            # Simple round-robin: get last index and increment
            local last_index=$(cat "$STATE_FILE" 2>/dev/null || echo "0")
            selected_index=$(( (last_index + 1) % num_projects ))
            echo "$selected_index" > "$STATE_FILE"
            selected_project="${projects[$selected_index]}"
            ;;
            
        "priority")
            # Select project with highest priority that hasn't been processed recently
            local highest_priority=-1
            local i=0
            for project in "${projects[@]}"; do
                local priority=$(echo "$project" | jq -r '.priority // 50')
                if [ $priority -gt $highest_priority ]; then
                    highest_priority=$priority
                    selected_index=$i
                    selected_project="$project"
                fi
                ((i++))
            done
            ;;
            
        "weighted")
            # Weighted selection based on project weights (not implemented)
            log "WARN" "Weighted strategy not yet implemented, falling back to round-robin"
            selected_index=0
            selected_project="${projects[0]}"
            ;;
            
        "fair-share")
            # Fair-share based on recent processing history (not implemented)
            log "WARN" "Fair-share strategy not yet implemented, falling back to round-robin"
            selected_index=0
            selected_project="${projects[0]}"
            ;;
            
        *)
            log "WARN" "Unknown strategy: $strategy, using round-robin"
            selected_project="${projects[0]}"
            ;;
    esac
    
    echo "$selected_project"
}

# Function to process a single project
process_project() {
    local project_json="$1"
    
    # Extract project details
    local project_id=$(echo "$project_json" | jq -r '.id')
    local project_name=$(echo "$project_json" | jq -r '.name // .id')
    local project_path=$(echo "$project_json" | jq -r '.path')
    local project_priority=$(echo "$project_json" | jq -r '.priority // 50')
    
    log "INFO" "${BLUE}Processing project: ${project_name} (${project_id})${NC}"
    log "DEBUG" "Path: ${project_path}, Priority: ${project_priority}"
    
    # Check if process is already running for this project
    if check_existing_process "$project_name"; then
        log "WARN" "${YELLOW}Skipping ${project_name} - process already running${NC}"
        return 0
    fi
    
    # Check if project directory exists
    if [ ! -d "$project_path" ]; then
        log "ERROR" "${RED}Project directory not found: ${project_path}${NC}"
        return 1
    fi
    
    # Change to project directory
    cd "$project_path" || {
        log "ERROR" "${RED}Failed to change to project directory: ${project_path}${NC}"
        return 1
    }
    
    # Check if PoppoBuilder is initialized in this project
    if [ ! -d ".poppobuilder" ] && [ ! -d ".poppo" ]; then
        log "WARN" "${YELLOW}PoppoBuilder not initialized in project: ${project_name}${NC}"
        log "INFO" "Skipping project"
        return 0
    fi
    
    # Execute PoppoBuilder for this project
    log "INFO" "${GREEN}Starting PoppoBuilder for ${project_name}${NC}"
    
    # Find the PoppoBuilder minimal script
    local MINIMAL_POPPO=""
    if [ -f "$PROJECT_ROOT/src/minimal-poppo.js" ]; then
        MINIMAL_POPPO="$PROJECT_ROOT/src/minimal-poppo.js"
    elif [ -f "/opt/homebrew/lib/node_modules/poppo-builder-suite/src/minimal-poppo.js" ]; then
        MINIMAL_POPPO="/opt/homebrew/lib/node_modules/poppo-builder-suite/src/minimal-poppo.js"
    else
        log "ERROR" "${RED}minimal-poppo.js not found${NC}"
        return 1
    fi
    
    # Run minimal-poppo.js directly (single execution)
    if [ -f "$MINIMAL_POPPO" ]; then
        # Set environment variables to ensure correct project context
        export POPPO_PROJECT_PATH="$project_path"
        export POPPO_PROJECT_NAME="$project_name"
        # Read github config from project's .poppo/config.json if it exists
        if [ -f "$project_path/.poppo/config.json" ]; then
            local poppo_config=$(cat "$project_path/.poppo/config.json")
            export POPPO_GITHUB_OWNER=$(echo "$poppo_config" | jq -r '.github.owner // empty')
            export POPPO_GITHUB_REPO=$(echo "$poppo_config" | jq -r '.github.repo // empty')
        fi
        
        # Start PoppoBuilder process in background
        node "$MINIMAL_POPPO" 2>&1 | while IFS= read -r line; do
            echo "[${project_name}] $line" | tee -a "$LOG_FILE"
        done &
        
        local poppo_pid=$!
        create_pid_file "$project_name" "$poppo_pid"
        
        # Monitor process with timeout
        local elapsed=0
        while [ $elapsed -lt $POPPOBUILDER_TIMEOUT ]; do
            if ! is_process_running "$poppo_pid"; then
                # Process finished
                wait "$poppo_pid"
                local exit_code=$?
                remove_pid_file "$project_name"
                
                if [ $exit_code -ne 0 ]; then
                    log "ERROR" "${RED}PoppoBuilder failed with exit code: ${exit_code}${NC}"
                    return $exit_code
                else
                    log "INFO" "${GREEN}PoppoBuilder completed successfully for ${project_name}${NC}"
                    return 0
                fi
            fi
            
            # Health check interval
            sleep $POPPOBUILDER_HEALTH_CHECK_INTERVAL
            elapsed=$((elapsed + POPPOBUILDER_HEALTH_CHECK_INTERVAL))
            
            # Log progress
            if [ $((elapsed % 60)) -eq 0 ]; then
                log "INFO" "PoppoBuilder still running for ${project_name} (${elapsed}s elapsed)"
            fi
        done
        
        # Timeout reached
        log "ERROR" "${RED}PoppoBuilder timeout reached for ${project_name} (${POPPOBUILDER_TIMEOUT}s)${NC}"
        log "INFO" "Terminating process PID: $poppo_pid"
        
        # Try graceful shutdown first
        kill -TERM "$poppo_pid" 2>/dev/null
        sleep 5
        
        # Force kill if still running
        if is_process_running "$poppo_pid"; then
            log "WARN" "Force killing process PID: $poppo_pid"
            kill -KILL "$poppo_pid" 2>/dev/null
        fi
        
        remove_pid_file "$project_name"
        return 1
    else
        log "ERROR" "${RED}PoppoBuilder script not found${NC}"
        return 1
    fi
    
    return 0
}

# Main execution loop
main() {
    log "INFO" "${GREEN}Starting PoppoBuilder Multi-Project Executor${NC}"
    log "INFO" "Strategy: ${POPPOBUILDER_STRATEGY:-round-robin}"
    log "INFO" "PoppoBuilder: ${POPPOBUILDER_BIN}"
    
    while true; do
        log "INFO" "=== Starting new iteration ==="
        
        # Get all registered projects
        local projects_json=$(get_registered_projects)
        
        # Count projects
        local num_projects=$(echo "$projects_json" | grep -c '^{')
        log "INFO" "Found ${num_projects} enabled project(s)"
        
        if [ $num_projects -eq 0 ]; then
            log "WARN" "No projects to process. Waiting..."
            sleep 60
            continue
        fi
        
        # Select next project based on strategy
        local selected_project=$(select_next_project "$projects_json")
        
        if [ -z "$selected_project" ] || [ "$selected_project" == "null" ]; then
            log "ERROR" "Failed to select a project"
            sleep 60
            continue
        fi
        
        # Process the selected project
        process_project "$selected_project"
        
        # Wait before next iteration
        local wait_time=${POPPOBUILDER_WAIT_TIME:-60}
        log "INFO" "Waiting ${wait_time} seconds before next iteration..."
        sleep $wait_time
    done
}

# Cleanup function
cleanup() {
    log "INFO" "Performing cleanup..."
    
    # Kill all running PoppoBuilder processes
    for pidfile in "$PID_DIR"/poppo-builder-*.pid; do
        if [ -f "$pidfile" ]; then
            local pid=$(cat "$pidfile")
            local project=$(basename "$pidfile" .pid | sed 's/poppo-builder-//')
            
            if is_process_running "$pid"; then
                log "INFO" "Terminating PoppoBuilder for $project (PID: $pid)"
                kill -TERM "$pid" 2>/dev/null
                sleep 2
                
                # Force kill if still running
                if is_process_running "$pid"; then
                    kill -KILL "$pid" 2>/dev/null
                fi
            fi
            
            rm -f "$pidfile"
        fi
    done
    
    log "INFO" "Cleanup completed"
}

# Function to clean up stale PID files on startup
cleanup_stale_pids() {
    log "INFO" "Checking for stale PID files..."
    local cleaned=0
    
    for pidfile in "$PID_DIR"/poppo-builder-*.pid; do
        if [ -f "$pidfile" ]; then
            local pid=$(cat "$pidfile")
            local project=$(basename "$pidfile" .pid | sed 's/poppo-builder-//')
            
            if ! is_process_running "$pid"; then
                log "INFO" "Removing stale PID file for $project"
                rm -f "$pidfile"
                cleaned=$((cleaned + 1))
            fi
        fi
    done
    
    if [ $cleaned -gt 0 ]; then
        log "INFO" "Cleaned up $cleaned stale PID file(s)"
    fi
}

# Handle signals
trap 'log "INFO" "Received interrupt signal, exiting..."; cleanup; exit 0' INT TERM QUIT

# Clean up stale PIDs on startup
cleanup_stale_pids

# Start main loop
main