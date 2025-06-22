#!/bin/bash
# Issue #148: CCSP運用ドキュメントとスクリプト作成
# 週次チェックスクリプト

set -euo pipefail

# 設定
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="$PROJECT_ROOT/logs/operations"
REPORT_DIR="$PROJECT_ROOT/reports/operations"
WEEK=$(date +%Y-W%V)
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)

# ログディレクトリの作成
mkdir -p "$LOG_DIR" "$REPORT_DIR"

# ログファイル
LOG_FILE="$LOG_DIR/weekly-check-$WEEK.log"
REPORT_FILE="$REPORT_DIR/weekly-report-$WEEK.json"

# 関数定義
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

error() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $1" | tee -a "$LOG_FILE" >&2
}

# メイン処理開始
log "=== CCSP週次チェック開始 ($WEEK) ==="

# 1. 過去1週間のログ分析
log "1. 過去1週間のログ分析"

# エラー統計
ERROR_COUNT=0
WARNING_COUNT=0
CCSP_ERRORS=0
POPPO_ERRORS=0

# CCSP ログ分析
if [ -f "$PROJECT_ROOT/logs/ccsp.log" ]; then
    # 過去7日のエラー
    CCSP_ERRORS=$(find "$PROJECT_ROOT/logs" -name "*.log" -mtime -7 -exec grep -l "ccsp" {} \; | xargs grep -i "error\|fail\|exception" | wc -l)
    log "  CCSP関連エラー: $CCSP_ERRORS件"
fi

# PoppoBuilder ログ分析
if ls "$PROJECT_ROOT/logs/poppo-"*.log >/dev/null 2>&1; then
    POPPO_ERRORS=$(find "$PROJECT_ROOT/logs" -name "poppo-*.log" -mtime -7 -exec grep -i "error\|fail\|exception" {} \; | wc -l)
    log "  PoppoBuilderエラー: $POPPO_ERRORS件"
fi

# 2. パフォーマンス分析
log "2. パフォーマンス分析"

# データベースファイルサイズ
DB_SIZE=0
if [ -f "$PROJECT_ROOT/data/poppo-history.db" ]; then
    DB_SIZE=$(du -m "$PROJECT_ROOT/data/poppo-history.db" | cut -f1)
    log "  データベースサイズ: ${DB_SIZE}MB"
fi

# ログファイルサイズ合計
LOG_SIZE=$(find "$PROJECT_ROOT/logs" -type f -name "*.log" -exec du -m {} \; | awk '{sum+=$1} END {print sum+0}')
log "  ログファイル総サイズ: ${LOG_SIZE}MB"

# 3. セキュリティチェック
log "3. セキュリティチェック"

SECURITY_ISSUES=()

# 設定ファイルの権限チェック
CONFIG_FILES=(
    "$PROJECT_ROOT/config/config.json"
    "$PROJECT_ROOT/.env"
)

for config_file in "${CONFIG_FILES[@]}"; do
    if [ -f "$config_file" ]; then
        permissions=$(stat -c "%a" "$config_file" 2>/dev/null || stat -f "%A" "$config_file" 2>/dev/null || echo "unknown")
        if [ "$permissions" != "600" ] && [ "$permissions" != "0600" ]; then
            SECURITY_ISSUES+=("設定ファイル $config_file の権限が適切ではありません ($permissions)")
        fi
    fi
done

# ログファイルの権限チェック
find "$PROJECT_ROOT/logs" -type f -name "*.log" | while read -r log_file; do
    permissions=$(stat -c "%a" "$log_file" 2>/dev/null || stat -f "%A" "$log_file" 2>/dev/null || echo "unknown")
    if [ "$permissions" = "777" ] || [ "$permissions" = "0777" ]; then
        SECURITY_ISSUES+=("ログファイル $log_file の権限が緩すぎます ($permissions)")
    fi
done

# 4. バックアップ状況確認
log "4. バックアップ状況確認"

BACKUP_STATUS="unknown"
LAST_BACKUP=""

if [ -d "$PROJECT_ROOT/backups" ]; then
    BACKUP_COUNT=$(find "$PROJECT_ROOT/backups" -name "backup-*" -type d | wc -l)
    if [ "$BACKUP_COUNT" -gt 0 ]; then
        LAST_BACKUP=$(find "$PROJECT_ROOT/backups" -name "backup-*" -type d | sort | tail -1 | xargs basename)
        BACKUP_AGE=$(find "$PROJECT_ROOT/backups" -name "backup-*" -type d -mtime -7 | wc -l)
        
        if [ "$BACKUP_AGE" -gt 0 ]; then
            BACKUP_STATUS="recent"
            log "  ✅ 最新バックアップ: $LAST_BACKUP (7日以内)"
        else
            BACKUP_STATUS="old"
            log "  ⚠️  最新バックアップ: $LAST_BACKUP (7日より古い)"
        fi
    else
        BACKUP_STATUS="none"
        log "  ❌ バックアップが見つかりません"
    fi
else
    BACKUP_STATUS="no_directory"
    log "  ❌ バックアップディレクトリが存在しません"
fi

# 5. 依存関係チェック
log "5. 依存関係チェック"

DEPENDENCY_ISSUES=()

# Node.js バージョン
if command -v node > /dev/null; then
    NODE_VERSION=$(node --version)
    log "  Node.js バージョン: $NODE_VERSION"
    
    # LTS バージョンかチェック (簡易的)
    MAJOR_VERSION=$(echo "$NODE_VERSION" | sed 's/v\([0-9]*\).*/\1/')
    if [ "$MAJOR_VERSION" -lt 18 ]; then
        DEPENDENCY_ISSUES+=("Node.js バージョンが古い可能性があります: $NODE_VERSION")
    fi
else
    DEPENDENCY_ISSUES+=("Node.js が見つかりません")
fi

# npm 依存関係の脆弱性チェック
if command -v npm > /dev/null && [ -f "$PROJECT_ROOT/package.json" ]; then
    cd "$PROJECT_ROOT"
    if npm audit --audit-level=high --json > /tmp/npm-audit.json 2>/dev/null; then
        VULNERABILITIES=$(jq '.metadata.vulnerabilities.high + .metadata.vulnerabilities.critical' /tmp/npm-audit.json 2>/dev/null || echo "0")
        if [ "$VULNERABILITIES" -gt 0 ]; then
            DEPENDENCY_ISSUES+=("高/重要度の脆弱性が $VULNERABILITIES 件見つかりました")
        fi
        rm -f /tmp/npm-audit.json
    fi
fi

# 6. ディスク使用量トレンド
log "6. ディスク使用量トレンド"

CURRENT_USAGE=$(df "$PROJECT_ROOT" | awk 'NR==2 {print $5}' | sed 's/%//')
USAGE_TREND_FILE="$LOG_DIR/disk-usage-trend.log"

# 使用量を記録
echo "$(date +%Y-%m-%d),$CURRENT_USAGE" >> "$USAGE_TREND_FILE"

# 過去の傾向を分析 (過去4週間)
if [ -f "$USAGE_TREND_FILE" ]; then
    TREND_DATA=$(tail -28 "$USAGE_TREND_FILE" | tail -4)
    if [ -n "$TREND_DATA" ]; then
        AVG_USAGE=$(echo "$TREND_DATA" | awk -F, '{sum+=$2; count++} END {print sum/count}')
        log "  現在の使用量: $CURRENT_USAGE%, 4週間平均: ${AVG_USAGE}%"
    fi
fi

# 7. アップタイム統計
log "7. アップタイム統計"

UPTIME_STATS=()

# システムアップタイム
if command -v uptime > /dev/null; then
    SYSTEM_UPTIME=$(uptime | awk '{print $3,$4}' | sed 's/,//')
    log "  システムアップタイム: $SYSTEM_UPTIME"
fi

# プロセスアップタイム（ccsp）
if pgrep -f "ccsp/index.js" > /dev/null; then
    CCSP_PID=$(pgrep -f "ccsp/index.js" | head -1)
    if command -v ps > /dev/null; then
        CCSP_UPTIME=$(ps -o etime= -p "$CCSP_PID" | tr -d ' ')
        log "  CCSP プロセスアップタイム: $CCSP_UPTIME"
    fi
fi

# 結果レポート生成
log "8. 結果レポート生成"

# 総合ステータス判定
OVERALL_STATUS="HEALTHY"
CRITICAL_ISSUES=0

if [ $CCSP_ERRORS -gt 50 ] || [ $POPPO_ERRORS -gt 50 ]; then
    OVERALL_STATUS="DEGRADED"
    ((CRITICAL_ISSUES++))
fi

if [ ${#SECURITY_ISSUES[@]} -gt 0 ]; then
    OVERALL_STATUS="NEEDS_ATTENTION"
    ((CRITICAL_ISSUES++))
fi

if [ "$BACKUP_STATUS" = "none" ] || [ "$BACKUP_STATUS" = "no_directory" ]; then
    OVERALL_STATUS="NEEDS_ATTENTION"
    ((CRITICAL_ISSUES++))
fi

if [ ${#DEPENDENCY_ISSUES[@]} -gt 0 ]; then
    OVERALL_STATUS="NEEDS_ATTENTION"
    ((CRITICAL_ISSUES++))
fi

# JSON レポート
cat > "$REPORT_FILE" << EOF
{
  "timestamp": "$TIMESTAMP",
  "week": "$WEEK",
  "summary": {
    "status": "$OVERALL_STATUS",
    "critical_issues": $CRITICAL_ISSUES,
    "total_errors": $((CCSP_ERRORS + POPPO_ERRORS)),
    "security_issues": ${#SECURITY_ISSUES[@]},
    "dependency_issues": ${#DEPENDENCY_ISSUES[@]}
  },
  "performance": {
    "database_size_mb": $DB_SIZE,
    "log_size_mb": $LOG_SIZE,
    "disk_usage_percent": $CURRENT_USAGE
  },
  "errors": {
    "ccsp_errors": $CCSP_ERRORS,
    "poppo_errors": $POPPO_ERRORS
  },
  "backup": {
    "status": "$BACKUP_STATUS",
    "last_backup": "$LAST_BACKUP"
  },
  "security_issues": [
$(printf '    "%s"' "${SECURITY_ISSUES[@]}" | sed 's/$/,/' | sed '$s/,$//')
  ],
  "dependency_issues": [
$(printf '    "%s"' "${DEPENDENCY_ISSUES[@]}" | sed 's/$/,/' | sed '$s/,$//')
  ],
  "recommendations": [
$(
if [ $CCSP_ERRORS -gt 20 ]; then echo '    "CCSPエラーログの詳細調査を推奨",'; fi
if [ $POPPO_ERRORS -gt 20 ]; then echo '    "PoppoBuilderエラーログの詳細調査を推奨",'; fi
if [ "$BACKUP_STATUS" != "recent" ]; then echo '    "バックアップの実行を推奨",'; fi
if [ ${#SECURITY_ISSUES[@]} -gt 0 ]; then echo '    "セキュリティ設定の見直しを推奨",'; fi
if [ ${#DEPENDENCY_ISSUES[@]} -gt 0 ]; then echo '    "依存関係の更新を推奨",'; fi
if [ $LOG_SIZE -gt 1000 ]; then echo '    "ログファイルのローテーションを推奨",'; fi
) | sed '$s/,$//'
  ]
}
EOF

# 結果サマリー
log "=== 週次チェック結果サマリー ==="
log "総合ステータス: $OVERALL_STATUS"
log "重要な問題: $CRITICAL_ISSUES件"
log "エラー合計: $((CCSP_ERRORS + POPPO_ERRORS))件"

if [ ${#SECURITY_ISSUES[@]} -gt 0 ]; then
    log "🔒 セキュリティ課題:"
    for issue in "${SECURITY_ISSUES[@]}"; do
        log "  - $issue"
    done
fi

if [ ${#DEPENDENCY_ISSUES[@]} -gt 0 ]; then
    log "📦 依存関係課題:"
    for issue in "${DEPENDENCY_ISSUES[@]}"; do
        log "  - $issue"
    done
fi

log "レポートファイル: $REPORT_FILE"
log "=== CCSP週次チェック完了 ==="

# 終了コード
if [ $CRITICAL_ISSUES -gt 0 ]; then
    exit 1
else
    exit 0
fi