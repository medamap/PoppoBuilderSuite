#!/bin/bash
# CCSP Agent パフォーマンス監視スクリプト

set -euo pipefail

# 設定
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
INTERVAL=${1:-5}  # デフォルト5秒間隔

# カラー出力
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# ヘッダー表示
show_header() {
    clear
    echo -e "${BLUE}CCSP Agent Performance Monitor${NC}"
    echo -e "${BLUE}================================${NC}"
    echo -e "更新間隔: ${INTERVAL}秒 | 終了: Ctrl+C"
    echo
}

# プロセス情報取得
get_process_info() {
    local pids=$(pgrep -f "agents/ccsp/index.js" || echo "")
    if [[ -z "$pids" ]]; then
        echo -e "${RED}CCSPプロセスが実行されていません${NC}"
        return 1
    fi
    
    echo -e "${GREEN}プロセス情報:${NC}"
    printf "%-8s %-8s %-8s %-10s %-20s\n" "PID" "CPU%" "MEM%" "RSS(MB)" "起動時間"
    echo "--------------------------------------------------------"
    
    for pid in $pids; do
        if [[ -e /proc/$pid ]]; then
            local cpu=$(ps -p $pid -o %cpu= | tr -d ' ')
            local mem=$(ps -p $pid -o %mem= | tr -d ' ')
            local rss=$(ps -p $pid -o rss= | awk '{print int($1/1024)}')
            local etime=$(ps -p $pid -o etime= | tr -d ' ')
            printf "%-8s %-8s %-8s %-10s %-20s\n" "$pid" "$cpu" "$mem" "$rss" "$etime"
        fi
    done
}

# Redis情報取得
get_redis_info() {
    if ! command -v redis-cli &> /dev/null || ! redis-cli ping &> /dev/null 2>&1; then
        echo -e "${YELLOW}Redis情報を取得できません${NC}"
        return 1
    fi
    
    echo -e "\n${GREEN}キュー状態:${NC}"
    local wait=$(redis-cli llen "bull:ccsp-queue:wait" 2>/dev/null || echo "0")
    local active=$(redis-cli llen "bull:ccsp-queue:active" 2>/dev/null || echo "0")
    local completed=$(redis-cli get "bull:ccsp-queue:completed:count" 2>/dev/null || echo "0")
    local failed=$(redis-cli llen "bull:ccsp-queue:failed" 2>/dev/null || echo "0")
    
    printf "待機中: %-6s 実行中: %-6s 完了: %-6s 失敗: %-6s\n" "$wait" "$active" "$completed" "$failed"
    
    # 進捗バー
    local total=$((wait + active))
    if [[ $total -gt 0 ]]; then
        local progress=$((active * 100 / total))
        echo -n "進捗: ["
        for i in {1..20}; do
            if [[ $((i * 5)) -le $progress ]]; then
                echo -n "="
            else
                echo -n " "
            fi
        done
        echo "] $progress%"
    fi
}

# メトリクス情報取得
get_metrics_info() {
    local metrics_url="http://localhost:9100/metrics"
    if ! curl -s "$metrics_url" > /dev/null 2>&1; then
        echo -e "${YELLOW}メトリクス情報を取得できません${NC}"
        return 1
    fi
    
    echo -e "\n${GREEN}パフォーマンスメトリクス:${NC}"
    
    # レート制限
    local rate_remaining=$(curl -s "$metrics_url" | grep "ccsp_rate_limit_remaining" | grep -v "#" | awk '{print $2}' | head -1)
    local rate_total=$(curl -s "$metrics_url" | grep "ccsp_rate_limit_total" | grep -v "#" | awk '{print $2}' | head -1)
    if [[ -n "$rate_remaining" && -n "$rate_total" ]]; then
        local rate_percent=$(echo "scale=1; $rate_remaining * 100 / $rate_total" | bc)
        echo "レート制限残量: $rate_remaining/$rate_total ($rate_percent%)"
    fi
    
    # ワーカー状態
    local active_workers=$(curl -s "$metrics_url" | grep "ccsp_active_workers" | grep -v "#" | awk '{print $2}' | head -1)
    local worker_util=$(curl -s "$metrics_url" | grep "ccsp_worker_utilization_ratio" | grep -v "#" | awk '{print $2}' | head -1)
    if [[ -n "$active_workers" ]]; then
        echo "アクティブワーカー: $active_workers"
    fi
    if [[ -n "$worker_util" ]]; then
        local util_percent=$(echo "scale=1; $worker_util * 100" | bc)
        echo "ワーカー使用率: $util_percent%"
    fi
}

# リアルタイムログ表示
show_recent_logs() {
    echo -e "\n${GREEN}最新のログ:${NC}"
    local latest_log=$(find "$PROJECT_ROOT/logs" -name "ccsp-*.log" -type f -printf '%T@ %p\n' | sort -n | tail -1 | cut -d' ' -f2)
    
    if [[ -n "$latest_log" ]]; then
        tail -5 "$latest_log" | while IFS= read -r line; do
            if [[ "$line" =~ ERROR ]]; then
                echo -e "${RED}$line${NC}"
            elif [[ "$line" =~ WARN ]]; then
                echo -e "${YELLOW}$line${NC}"
            else
                echo "$line"
            fi
        done
    else
        echo "ログファイルが見つかりません"
    fi
}

# システムリソース
show_system_resources() {
    echo -e "\n${GREEN}システムリソース:${NC}"
    
    # CPU使用率
    local cpu_usage=$(top -bn1 | grep "Cpu(s)" | sed "s/.*, *\([0-9.]*\)%* id.*/\1/" | awk '{print 100 - $1}')
    echo -n "CPU使用率: "
    printf "%.1f%%\n" "$cpu_usage"
    
    # メモリ使用量
    local mem_info=$(free -m | awk 'NR==2{printf "%.1f%% (%sMB/%sMB)", $3*100/$2, $3, $2}')
    echo "メモリ使用量: $mem_info"
    
    # ディスク使用量
    local disk_usage=$(df -h "$PROJECT_ROOT" | awk 'NR==2{print $5 " (" $3 "/" $2 ")"}')
    echo "ディスク使用量: $disk_usage"
}

# メイン監視ループ
monitor_loop() {
    while true; do
        show_header
        
        # 各情報を表示
        get_process_info
        get_redis_info
        get_metrics_info
        show_system_resources
        show_recent_logs
        
        echo -e "\n${CYAN}次回更新まで ${INTERVAL} 秒...${NC}"
        sleep "$INTERVAL"
    done
}

# シグナルハンドラー
cleanup() {
    echo -e "\n${GREEN}監視を終了しました${NC}"
    exit 0
}

trap cleanup INT TERM

# 使用方法
if [[ "${1:-}" == "-h" ]] || [[ "${1:-}" == "--help" ]]; then
    echo "使用方法: $0 [更新間隔(秒)]"
    echo "例: $0 10  # 10秒ごとに更新"
    exit 0
fi

# 実行
monitor_loop