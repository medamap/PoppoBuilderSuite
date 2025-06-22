#!/bin/bash

# CCSP Agent ヘルスチェックスクリプト
# systemdサービスの起動前・起動後チェック

set -euo pipefail

# ログ設定
LOG_FILE="/var/log/ccsp/health-check.log"
SCRIPT_NAME="$(basename "$0")"

# ログ関数
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [$SCRIPT_NAME] $*" | tee -a "$LOG_FILE"
}

# エラーログ関数
error() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [$SCRIPT_NAME] ERROR: $*" | tee -a "$LOG_FILE" >&2
}

# 使用方法表示
usage() {
    echo "Usage: $0 {pre|post}"
    echo "  pre  - サービス起動前チェック"
    echo "  post - サービス起動後チェック"
    exit 1
}

# 起動前チェック
pre_start_check() {
    log "Pre-start health check starting..."
    
    # 1. Node.js インストール確認
    if ! command -v node >/dev/null 2>&1; then
        error "Node.js is not installed"
        exit 1
    fi
    
    NODE_VERSION=$(node --version)
    log "Node.js version: $NODE_VERSION"
    
    # 2. 必要なディレクトリの存在確認
    local required_dirs=(
        "/opt/poppo-builder-suite"
        "/opt/poppo-builder-suite/agents/ccsp"
        "/opt/poppo-builder-suite/logs"
        "/opt/poppo-builder-suite/state"
        "/opt/poppo-builder-suite/data"
        "/var/log/ccsp"
    )
    
    for dir in "${required_dirs[@]}"; do
        if [[ ! -d "$dir" ]]; then
            error "Required directory not found: $dir"
            exit 1
        fi
    done
    
    # 3. 必要なファイルの存在確認
    local required_files=(
        "/opt/poppo-builder-suite/agents/ccsp/index.js"
        "/opt/poppo-builder-suite/config/config.json"
        "/etc/default/ccsp-agent"
    )
    
    for file in "${required_files[@]}"; do
        if [[ ! -f "$file" ]]; then
            error "Required file not found: $file"
            exit 1
        fi
    done
    
    # 4. 権限確認
    if [[ ! -w "/opt/poppo-builder-suite/logs" ]]; then
        error "Logs directory is not writable"
        exit 1
    fi
    
    if [[ ! -w "/opt/poppo-builder-suite/state" ]]; then
        error "State directory is not writable"
        exit 1
    fi
    
    # 5. Redis接続確認
    if command -v redis-cli >/dev/null 2>&1; then
        if ! redis-cli ping >/dev/null 2>&1; then
            error "Redis server is not responding"
            exit 1
        fi
        log "Redis connection OK"
    else
        log "WARNING: redis-cli not found, skipping Redis check"
    fi
    
    # 6. ポート使用状況確認
    local ports=(6379 3001)  # Redis, CCSP dashboard
    for port in "${ports[@]}"; do
        if lsof -i ":$port" >/dev/null 2>&1; then
            if [[ $port -eq 6379 ]]; then
                log "Port $port (Redis) is in use - OK"
            else
                log "WARNING: Port $port is already in use"
            fi
        fi
    done
    
    # 7. ディスク容量確認
    local available_space
    available_space=$(df /opt/poppo-builder-suite | awk 'NR==2 {print $4}')
    local min_space=1048576  # 1GB in KB
    
    if [[ $available_space -lt $min_space ]]; then
        error "Insufficient disk space: ${available_space}KB available, ${min_space}KB required"
        exit 1
    fi
    
    log "Pre-start health check completed successfully"
}

# 起動後チェック
post_start_check() {
    log "Post-start health check starting..."
    
    # 1. プロセス存在確認（最大30秒待機）
    local max_wait=30
    local wait_count=0
    
    while [[ $wait_count -lt $max_wait ]]; do
        if pgrep -f "agents/ccsp/index.js" >/dev/null 2>&1; then
            log "CCSP process is running"
            break
        fi
        
        sleep 1
        ((wait_count++))
        
        if [[ $wait_count -eq $max_wait ]]; then
            error "CCSP process not found after ${max_wait} seconds"
            exit 1
        fi
    done
    
    # 2. PIDファイル確認
    local pid_file="/var/run/ccsp-agent.pid"
    if [[ -f "$pid_file" ]]; then
        local pid
        pid=$(cat "$pid_file")
        if kill -0 "$pid" 2>/dev/null; then
            log "PID file exists and process $pid is running"
        else
            error "PID file exists but process $pid is not running"
            exit 1
        fi
    else
        log "WARNING: PID file not found (may not be created yet)"
    fi
    
    # 3. ヘルスチェックAPI確認（最大60秒待機）
    local health_url="http://localhost:3001/api/ccsp/health"
    max_wait=60
    wait_count=0
    
    while [[ $wait_count -lt $max_wait ]]; do
        if curl -s -f "$health_url" >/dev/null 2>&1; then
            log "Health check API is responding"
            break
        fi
        
        sleep 2
        ((wait_count += 2))
        
        if [[ $wait_count -eq $max_wait ]]; then
            error "Health check API not responding after ${max_wait} seconds"
            exit 1
        fi
    done
    
    # 4. ログファイル確認
    local log_dir="/opt/poppo-builder-suite/logs"
    if [[ -f "$log_dir/ccsp-$(date +%Y-%m-%d).log" ]]; then
        log "Log file is being created"
    else
        log "WARNING: Log file not found (may not be created yet)"
    fi
    
    # 5. Redis接続確認
    if curl -s -f "http://localhost:3001/api/ccsp/queue/status" >/dev/null 2>&1; then
        log "Queue status API is responding (Redis connection OK)"
    else
        error "Queue status API not responding (Redis connection issue?)"
        exit 1
    fi
    
    log "Post-start health check completed successfully"
}

# メイン処理
main() {
    # ログディレクトリ作成
    mkdir -p "$(dirname "$LOG_FILE")"
    
    case "${1:-}" in
        "pre")
            pre_start_check
            ;;
        "post")
            post_start_check
            ;;
        *)
            usage
            ;;
    esac
}

main "$@"