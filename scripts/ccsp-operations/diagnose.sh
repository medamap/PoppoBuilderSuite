#!/bin/bash
# Issue #148: CCSP運用ドキュメントとスクリプト作成
# 診断ツールスクリプト

set -euo pipefail

# 設定
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="$PROJECT_ROOT/logs/operations"
REPORT_DIR="$PROJECT_ROOT/reports/operations"
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)

# 引数解析
VERBOSE=false
QUICK=false
OUTPUT_FORMAT="text"
TARGET_COMPONENT=""

while [[ $# -gt 0 ]]; do
    case $1 in
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
        -q|--quick)
            QUICK=true
            shift
            ;;
        --json)
            OUTPUT_FORMAT="json"
            shift
            ;;
        --component)
            TARGET_COMPONENT="$2"
            shift 2
            ;;
        -h|--help)
            cat << EOF
CCSP診断ツール

使用方法: $0 [オプション]

オプション:
  -v, --verbose      詳細出力
  -q, --quick        クイック診断（基本チェックのみ）
  --json             JSON形式で出力
  --component NAME   特定コンポーネントのみ診断（ccsp, poppo, dashboard）
  -h, --help         このヘルプを表示

例:
  $0                           # 標準診断
  $0 --verbose                 # 詳細診断
  $0 --component ccsp          # CCSP のみ診断
  $0 --json > diagnosis.json   # JSON形式で結果保存
EOF
            exit 0
            ;;
        *)
            echo "不明なオプション: $1" >&2
            exit 1
            ;;
    esac
done

# ログディレクトリの作成
mkdir -p "$LOG_DIR" "$REPORT_DIR"

# ログファイル
DIAG_LOG="$LOG_DIR/diagnosis-$TIMESTAMP.log"
DIAG_REPORT="$REPORT_DIR/diagnosis-$TIMESTAMP.json"

# 関数定義
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$DIAG_LOG"
}

verbose_log() {
    if [ "$VERBOSE" = true ]; then
        log "$1"
    fi
}

output() {
    if [ "$OUTPUT_FORMAT" = "json" ]; then
        echo "$1" >> "$DIAG_REPORT.tmp"
    else
        echo "$1"
    fi
}

# 診断結果格納
DIAGNOSIS_RESULTS=()
ISSUES_FOUND=()
PERFORMANCE_METRICS=()

# プロセス情報取得
get_process_info() {
    local pattern=$1
    local name=$2
    
    if pgrep -f "$pattern" > /dev/null; then
        local pid=$(pgrep -f "$pattern" | head -1)
        local cpu_mem
        
        if command -v ps > /dev/null; then
            cpu_mem=$(ps -p "$pid" -o pid,pcpu,pmem,etime,command --no-headers 2>/dev/null || echo "N/A")
        else
            cpu_mem="N/A"
        fi
        
        echo "running:$pid:$cpu_mem"
    else
        echo "stopped:N/A:N/A"
    fi
}

# ネットワーク接続チェック
check_network() {
    local host=$1
    local port=$2
    local timeout=${3:-5}
    
    if command -v nc > /dev/null; then
        if nc -z -w"$timeout" "$host" "$port" 2>/dev/null; then
            echo "ok"
        else
            echo "failed"
        fi
    elif command -v telnet > /dev/null; then
        if timeout "$timeout" telnet "$host" "$port" </dev/null 2>/dev/null | grep -q "Connected"; then
            echo "ok"
        else
            echo "failed"
        fi
    else
        echo "unknown"
    fi
}

# API レスポンステスト
test_api_response() {
    local url=$1
    local expected_status=${2:-200}
    
    if command -v curl > /dev/null; then
        local response_time
        local http_code
        
        response_time=$(curl -o /dev/null -s -w '%{time_total}' --max-time 10 "$url" 2>/dev/null || echo "timeout")
        http_code=$(curl -o /dev/null -s -w '%{http_code}' --max-time 10 "$url" 2>/dev/null || echo "000")
        
        echo "$http_code:$response_time"
    else
        echo "000:unknown"
    fi
}

# ファイルシステム診断
diagnose_filesystem() {
    local component=$1
    local base_path=$2
    
    verbose_log "  ファイルシステム診断: $component"
    
    # ディレクトリ存在確認
    local dirs_ok=true
    local required_dirs=("$base_path/logs" "$base_path/config" "$base_path/state")
    
    for dir in "${required_dirs[@]}"; do
        if [ ! -d "$dir" ]; then
            ISSUES_FOUND+=("$component: 必要なディレクトリが見つかりません: $dir")
            dirs_ok=false
        fi
    done
    
    # 権限チェック
    local perms_ok=true
    if [ -d "$base_path/config" ]; then
        find "$base_path/config" -name "*.json" | while read -r config_file; do
            if [ -f "$config_file" ]; then
                local perms=$(stat -c "%a" "$config_file" 2>/dev/null || stat -f "%A" "$config_file" 2>/dev/null || echo "unknown")
                if [ "$perms" = "777" ] || [ "$perms" = "0777" ]; then
                    ISSUES_FOUND+=("$component: 設定ファイルの権限が不適切: $config_file ($perms)")
                    perms_ok=false
                fi
            fi
        done
    fi
    
    echo "$dirs_ok:$perms_ok"
}

# メイン診断処理
run_diagnosis() {
    local component=$1
    
    case $component in
        "ccsp")
            log "🔍 CCSP 診断開始"
            
            # プロセス状態
            local process_info=$(get_process_info "ccsp/index.js" "CCSP")
            DIAGNOSIS_RESULTS+=("ccsp_process:$process_info")
            
            # API テスト
            local api_test=$(test_api_response "http://localhost:3002/health")
            DIAGNOSIS_RESULTS+=("ccsp_api:$api_test")
            
            # ポート確認
            local port_check=$(check_network "localhost" "3002")
            DIAGNOSIS_RESULTS+=("ccsp_port:$port_check")
            
            # ファイルシステム
            local fs_check=$(diagnose_filesystem "CCSP" "$PROJECT_ROOT")
            DIAGNOSIS_RESULTS+=("ccsp_filesystem:$fs_check")
            
            if [ "$QUICK" = false ]; then
                # 詳細チェック
                
                # ログ分析
                if [ -f "$PROJECT_ROOT/logs/ccsp.log" ]; then
                    local recent_errors=$(tail -100 "$PROJECT_ROOT/logs/ccsp.log" | grep -i "error\|fail\|exception" | wc -l)
                    if [ "$recent_errors" -gt 5 ]; then
                        ISSUES_FOUND+=("CCSP: 最近のログに多数のエラー ($recent_errors 件)")
                    fi
                    DIAGNOSIS_RESULTS+=("ccsp_recent_errors:$recent_errors")
                fi
                
                # セッション状態
                if command -v claude > /dev/null; then
                    if claude --version > /dev/null 2>&1; then
                        DIAGNOSIS_RESULTS+=("ccsp_session:active")
                    else
                        DIAGNOSIS_RESULTS+=("ccsp_session:inactive")
                        ISSUES_FOUND+=("CCSP: Claude CLIセッションが無効")
                    fi
                else
                    DIAGNOSIS_RESULTS+=("ccsp_session:no_cli")
                    ISSUES_FOUND+=("CCSP: Claude CLIが見つからない")
                fi
                
                # キュー状態
                if [ -f "$PROJECT_ROOT/temp/ccsp" ]; then
                    local queue_files=$(find "$PROJECT_ROOT/temp/ccsp" -name "*.json" | wc -l)
                    DIAGNOSIS_RESULTS+=("ccsp_queue_files:$queue_files")
                    if [ "$queue_files" -gt 100 ]; then
                        ISSUES_FOUND+=("CCSP: キューファイルが蓄積 ($queue_files 件)")
                    fi
                fi
            fi
            
            log "✅ CCSP 診断完了"
            ;;
            
        "poppo")
            log "🔍 PoppoBuilder 診断開始"
            
            # プロセス状態
            local process_info=$(get_process_info "minimal-poppo.js" "PoppoBuilder")
            DIAGNOSIS_RESULTS+=("poppo_process:$process_info")
            
            # GitHub API接続
            local github_test="unknown"
            if command -v curl > /dev/null; then
                github_test=$(curl -s -o /dev/null -w '%{http_code}' "https://api.github.com/rate_limit" --max-time 10 || echo "failed")
            fi
            DIAGNOSIS_RESULTS+=("poppo_github_api:$github_test")
            
            # ファイルシステム
            local fs_check=$(diagnose_filesystem "PoppoBuilder" "$PROJECT_ROOT")
            DIAGNOSIS_RESULTS+=("poppo_filesystem:$fs_check")
            
            if [ "$QUICK" = false ]; then
                # 状態ファイル確認
                local state_files=("issue-status.json" "running-tasks.json")
                for state_file in "${state_files[@]}"; do
                    local file_path="$PROJECT_ROOT/state/$state_file"
                    if [ -f "$file_path" ]; then
                        if jq empty "$file_path" 2>/dev/null; then
                            DIAGNOSIS_RESULTS+=("poppo_state_${state_file}:valid")
                        else
                            DIAGNOSIS_RESULTS+=("poppo_state_${state_file}:invalid")
                            ISSUES_FOUND+=("PoppoBuilder: 状態ファイルが破損: $state_file")
                        fi
                    else
                        DIAGNOSIS_RESULTS+=("poppo_state_${state_file}:missing")
                        ISSUES_FOUND+=("PoppoBuilder: 状態ファイルが見つからない: $state_file")
                    fi
                done
                
                # レート制限状態
                if [ -f "$PROJECT_ROOT/logs/poppo-$(date +%Y-%m-%d).log" ]; then
                    local rate_limit_hits=$(grep -i "rate limit" "$PROJECT_ROOT/logs/poppo-$(date +%Y-%m-%d).log" | wc -l)
                    DIAGNOSIS_RESULTS+=("poppo_rate_limit_hits:$rate_limit_hits")
                    if [ "$rate_limit_hits" -gt 10 ]; then
                        ISSUES_FOUND+=("PoppoBuilder: 頻繁なレート制限 ($rate_limit_hits 回)")
                    fi
                fi
            fi
            
            log "✅ PoppoBuilder 診断完了"
            ;;
            
        "dashboard")
            log "🔍 Dashboard 診断開始"
            
            # プロセス状態
            local process_info=$(get_process_info "dashboard/server/index.js" "Dashboard")
            DIAGNOSIS_RESULTS+=("dashboard_process:$process_info")
            
            # API テスト
            local api_test=$(test_api_response "http://localhost:3001/api/health")
            DIAGNOSIS_RESULTS+=("dashboard_api:$api_test")
            
            # ポート確認
            local port_check=$(check_network "localhost" "3001")
            DIAGNOSIS_RESULTS+=("dashboard_port:$port_check")
            
            if [ "$QUICK" = false ]; then
                # WebSocket テスト
                if command -v curl > /dev/null; then
                    local ws_test=$(curl -s -I "http://localhost:3001" | grep -i "upgrade" | wc -l)
                    DIAGNOSIS_RESULTS+=("dashboard_websocket:$ws_test")
                fi
                
                # 静的ファイル確認
                local static_files=("$PROJECT_ROOT/dashboard/client/index.html" "$PROJECT_ROOT/dashboard/client/js/app.js")
                local static_ok=true
                for static_file in "${static_files[@]}"; do
                    if [ ! -f "$static_file" ]; then
                        ISSUES_FOUND+=("Dashboard: 静的ファイルが見つからない: $(basename "$static_file")")
                        static_ok=false
                    fi
                done
                DIAGNOSIS_RESULTS+=("dashboard_static_files:$static_ok")
            fi
            
            log "✅ Dashboard 診断完了"
            ;;
    esac
}

# システム診断
run_system_diagnosis() {
    log "🔍 システム診断開始"
    
    # システムリソース
    local cpu_usage="unknown"
    local memory_usage="unknown"
    local disk_usage="unknown"
    
    # CPU使用率
    if command -v top > /dev/null; then
        cpu_usage=$(top -l 1 -n 0 | grep "CPU usage" | awk '{print $3}' | sed 's/%//' 2>/dev/null || echo "unknown")
    elif command -v vmstat > /dev/null; then
        cpu_usage=$(vmstat 1 1 | tail -1 | awk '{print 100-$15}' 2>/dev/null || echo "unknown")
    fi
    
    # メモリ使用率
    if command -v free > /dev/null; then
        memory_usage=$(free | awk 'NR==2{printf "%.1f", $3*100/$2}')
    elif command -v vm_stat > /dev/null; then
        # macOS の場合
        memory_usage=$(vm_stat | perl -ne '/page size of (\d+)/ and $size=$1; /Pages\s+([^:]+)[^\d]+(\d+)/ and printf("%.1f\n", $2 * $size / 1024 / 1024 / 1024 * 100 / `sysctl -n hw.memsize` * 1024 * 1024 * 1024) if $1 eq "active" or $1 eq "inactive"' 2>/dev/null || echo "unknown")
    fi
    
    # ディスク使用率
    if command -v df > /dev/null; then
        disk_usage=$(df "$PROJECT_ROOT" | awk 'NR==2 {print $5}' | sed 's/%//')
    fi
    
    PERFORMANCE_METRICS+=("cpu_usage:$cpu_usage")
    PERFORMANCE_METRICS+=("memory_usage:$memory_usage")
    PERFORMANCE_METRICS+=("disk_usage:$disk_usage")
    
    # システム負荷
    if command -v uptime > /dev/null; then
        local load_avg=$(uptime | awk -F'load average:' '{print $2}' | awk '{print $1}' | sed 's/,//')
        PERFORMANCE_METRICS+=("load_average:$load_avg")
    fi
    
    log "✅ システム診断完了"
}

# 結果出力
output_results() {
    if [ "$OUTPUT_FORMAT" = "json" ]; then
        # JSON出力
        cat > "$DIAG_REPORT" << EOF
{
  "timestamp": "$TIMESTAMP",
  "diagnosis_type": "$([ "$QUICK" = true ] && echo "quick" || echo "full")",
  "target_component": "${TARGET_COMPONENT:-all}",
  "summary": {
    "total_checks": ${#DIAGNOSIS_RESULTS[@]},
    "issues_found": ${#ISSUES_FOUND[@]},
    "performance_metrics": ${#PERFORMANCE_METRICS[@]}
  },
  "results": [
$(printf '    "%s"' "${DIAGNOSIS_RESULTS[@]}" | sed 's/$/,/' | sed '$s/,$//')
  ],
  "issues": [
$(printf '    "%s"' "${ISSUES_FOUND[@]}" | sed 's/$/,/' | sed '$s/,$//')
  ],
  "performance": [
$(printf '    "%s"' "${PERFORMANCE_METRICS[@]}" | sed 's/$/,/' | sed '$s/,$//')
  ]
}
EOF
        cat "$DIAG_REPORT"
    else
        # テキスト出力
        echo
        echo "=== CCSP診断結果 ==="
        echo "実行時刻: $TIMESTAMP"
        echo "診断タイプ: $([ "$QUICK" = true ] && echo "クイック" || echo "完全")"
        echo "対象: ${TARGET_COMPONENT:-すべて}"
        echo
        
        if [ ${#ISSUES_FOUND[@]} -gt 0 ]; then
            echo "🚨 発見された問題 (${#ISSUES_FOUND[@]}件):"
            for issue in "${ISSUES_FOUND[@]}"; do
                echo "  - $issue"
            done
            echo
        fi
        
        if [ ${#PERFORMANCE_METRICS[@]} -gt 0 ]; then
            echo "📊 パフォーマンスメトリクス:"
            for metric in "${PERFORMANCE_METRICS[@]}"; do
                local name=$(echo "$metric" | cut -d: -f1)
                local value=$(echo "$metric" | cut -d: -f2)
                echo "  $name: $value"
            done
            echo
        fi
        
        echo "実行結果: $([ ${#ISSUES_FOUND[@]} -eq 0 ] && echo "✅ 正常" || echo "⚠️ 要確認")"
        echo "詳細ログ: $DIAG_LOG"
    fi
}

# メイン処理
main() {
    log "=== CCSP診断ツール開始 ==="
    
    if [ -n "$TARGET_COMPONENT" ]; then
        run_diagnosis "$TARGET_COMPONENT"
    else
        run_diagnosis "ccsp"
        run_diagnosis "poppo"
        run_diagnosis "dashboard"
    fi
    
    if [ "$QUICK" = false ]; then
        run_system_diagnosis
    fi
    
    output_results
    
    log "=== CCSP診断ツール完了 ==="
    
    # 終了コード
    if [ ${#ISSUES_FOUND[@]} -gt 0 ]; then
        exit 1
    else
        exit 0
    fi
}

# スクリプト実行
main "$@"