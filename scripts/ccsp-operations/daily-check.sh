#!/bin/bash
# Issue #148: CCSP運用ドキュメントとスクリプト作成
# 日次チェックスクリプト

set -euo pipefail

# 設定
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="$PROJECT_ROOT/logs/operations"
REPORT_DIR="$PROJECT_ROOT/reports/operations"
DATE=$(date +%Y-%m-%d)
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)

# ログディレクトリの作成
mkdir -p "$LOG_DIR" "$REPORT_DIR"

# ログファイル
LOG_FILE="$LOG_DIR/daily-check-$DATE.log"
REPORT_FILE="$REPORT_DIR/daily-report-$DATE.json"

# 関数定義
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

error() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $1" | tee -a "$LOG_FILE" >&2
}

check_status() {
    local service=$1
    local expected_status=$2
    local actual_status
    
    case $service in
        "ccsp")
            if pgrep -f "agents/ccsp/index.js" > /dev/null; then
                actual_status="running"
            else
                actual_status="stopped"
            fi
            ;;
        "poppo-builder")
            if pgrep -f "src/minimal-poppo.js" > /dev/null; then
                actual_status="running"
            else
                actual_status="stopped"
            fi
            ;;
        "dashboard")
            if pgrep -f "dashboard/server/index.js" > /dev/null; then
                actual_status="running"
            else
                actual_status="stopped"
            fi
            ;;
        *)
            actual_status="unknown"
            ;;
    esac
    
    echo "$actual_status"
}

# メイン処理開始
log "=== CCSP日次チェック開始 ==="

# 初期化
ISSUES=()
WARNINGS=()
SUCCESS_COUNT=0
ERROR_COUNT=0

# 1. サービス状態チェック
log "1. サービス状態チェック"

SERVICES=("ccsp" "poppo-builder" "dashboard")
for service in "${SERVICES[@]}"; do
    status=$(check_status "$service" "running")
    if [ "$status" = "running" ]; then
        log "  ✅ $service: 正常稼働中"
        ((SUCCESS_COUNT++))
    else
        error "  ❌ $service: 停止中"
        ISSUES+=("$service サービスが停止しています")
        ((ERROR_COUNT++))
    fi
done

# 2. CCSP API 疎通確認
log "2. CCSP API疎通確認"

if command -v curl > /dev/null; then
    if curl -s -o /dev/null -w "%{http_code}" http://localhost:3002/health | grep -q "200"; then
        log "  ✅ CCSP API: 疎通確認成功"
        ((SUCCESS_COUNT++))
    else
        error "  ❌ CCSP API: 疎通確認失敗"
        ISSUES+=("CCSP APIにアクセスできません")
        ((ERROR_COUNT++))
    fi
else
    WARNINGS+=("curlコマンドが見つからないため、API疎通確認をスキップ")
fi

# 3. ログファイルチェック
log "3. ログファイルチェック"

LOG_FILES=(
    "$PROJECT_ROOT/logs/ccsp.log"
    "$PROJECT_ROOT/logs/poppo-$(date +%Y-%m-%d).log"
    "$PROJECT_ROOT/logs/dashboard.log"
)

for log_file in "${LOG_FILES[@]}"; do
    if [ -f "$log_file" ]; then
        # ファイルサイズチェック
        size=$(du -m "$log_file" | cut -f1)
        if [ "$size" -gt 100 ]; then
            WARNINGS+=("ログファイル $log_file が100MBを超えています ($size MB)")
        fi
        
        # 最近のエラーチェック
        if [ -r "$log_file" ]; then
            error_count=$(tail -1000 "$log_file" 2>/dev/null | grep -i "error\|fail\|exception" | wc -l)
            if [ "$error_count" -gt 10 ]; then
                WARNINGS+=("ログファイル $log_file に多数のエラーが記録されています ($error_count 件)")
            fi
        fi
        
        log "  ✅ ログファイル $log_file: 確認完了"
        ((SUCCESS_COUNT++))
    else
        WARNINGS+=("ログファイル $log_file が見つかりません")
    fi
done

# 4. ディスク容量チェック
log "4. ディスク容量チェック"

if command -v df > /dev/null; then
    usage=$(df "$PROJECT_ROOT" | awk 'NR==2 {print $5}' | sed 's/%//')
    if [ "$usage" -gt 90 ]; then
        ISSUES+=("ディスク使用率が90%を超えています ($usage%)")
        ((ERROR_COUNT++))
    elif [ "$usage" -gt 80 ]; then
        WARNINGS+=("ディスク使用率が80%を超えています ($usage%)")
    else
        log "  ✅ ディスク使用率: $usage%"
        ((SUCCESS_COUNT++))
    fi
else
    WARNINGS+=("dfコマンドが見つからないため、ディスク容量チェックをスキップ")
fi

# 5. メモリ使用量チェック
log "5. メモリ使用量チェック"

if command -v free > /dev/null; then
    # Linux
    memory_usage=$(free | awk 'NR==2{printf "%.1f", $3*100/$2}')
elif command -v vm_stat > /dev/null; then
    # macOS
    memory_usage=$(vm_stat | perl -ne '/page size of (\d+)/ and $size=$1; /Pages\s+([^:]+)[^\d]+(\d+)/ and printf("%.1f\n", $2 * $size / 1024 / 1024 / 1024 * 100 / `sysctl -n hw.memsize` * 1024 * 1024 * 1024) if $1 eq "active" or $1 eq "inactive"')
    memory_usage=${memory_usage:-0}
else
    memory_usage="unknown"
fi

if [ "$memory_usage" != "unknown" ] && [ "$(echo "$memory_usage > 90" | bc -l)" = "1" ]; then
    ISSUES+=("メモリ使用率が90%を超えています ($memory_usage%)")
    ((ERROR_COUNT++))
elif [ "$memory_usage" != "unknown" ] && [ "$(echo "$memory_usage > 80" | bc -l)" = "1" ]; then
    WARNINGS+=("メモリ使用率が80%を超えています ($memory_usage%)")
else
    log "  ✅ メモリ使用率: $memory_usage%"
    ((SUCCESS_COUNT++))
fi

# 6. 重要プロセスの確認
log "6. 重要プロセスの確認"

CRITICAL_PROCESSES=(
    "node.*ccsp/index.js"
    "node.*minimal-poppo.js"
)

for process_pattern in "${CRITICAL_PROCESSES[@]}"; do
    if pgrep -f "$process_pattern" > /dev/null; then
        pid=$(pgrep -f "$process_pattern" | head -1)
        log "  ✅ プロセス確認: $process_pattern (PID: $pid)"
        ((SUCCESS_COUNT++))
    else
        ISSUES+=("重要プロセスが見つかりません: $process_pattern")
        ((ERROR_COUNT++))
    fi
done

# 7. セッション状態確認
log "7. セッション状態確認"

if command -v claude > /dev/null; then
    if claude --version > /dev/null 2>&1; then
        log "  ✅ Claude CLI: セッション有効"
        ((SUCCESS_COUNT++))
    else
        ISSUES+=("Claude CLIセッションが無効です")
        ((ERROR_COUNT++))
    fi
else
    WARNINGS+=("Claude CLIが見つからないため、セッション確認をスキップ")
fi

# 結果レポート生成
log "8. 結果レポート生成"

# JSON レポート
cat > "$REPORT_FILE" << EOF
{
  "timestamp": "$TIMESTAMP",
  "date": "$DATE",
  "summary": {
    "status": "$([ $ERROR_COUNT -eq 0 ] && echo "HEALTHY" || echo "ISSUES_FOUND")",
    "success_count": $SUCCESS_COUNT,
    "error_count": $ERROR_COUNT,
    "warning_count": ${#WARNINGS[@]}
  },
  "checks": {
    "services": {
      "ccsp": "$(check_status 'ccsp')",
      "poppo_builder": "$(check_status 'poppo-builder')",
      "dashboard": "$(check_status 'dashboard')"
    },
    "disk_usage": "$usage%",
    "memory_usage": "$memory_usage%"
  },
  "issues": [
$(printf '    "%s"' "${ISSUES[@]}" | sed 's/$/,/' | sed '$s/,$//')
  ],
  "warnings": [
$(printf '    "%s"' "${WARNINGS[@]}" | sed 's/$/,/' | sed '$s/,$//')
  ]
}
EOF

# 結果サマリー
log "=== チェック結果サマリー ==="
log "成功: $SUCCESS_COUNT, エラー: $ERROR_COUNT, 警告: ${#WARNINGS[@]}"

if [ ${#ISSUES[@]} -gt 0 ]; then
    log "🚨 発見された問題:"
    for issue in "${ISSUES[@]}"; do
        log "  - $issue"
    done
fi

if [ ${#WARNINGS[@]} -gt 0 ]; then
    log "⚠️  警告:"
    for warning in "${WARNINGS[@]}"; do
        log "  - $warning"
    done
fi

log "レポートファイル: $REPORT_FILE"
log "=== CCSP日次チェック完了 ==="

# 終了コード
if [ $ERROR_COUNT -gt 0 ]; then
    exit 1
else
    exit 0
fi