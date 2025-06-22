#!/bin/bash
# CCSP Agent 診断ツール

set -euo pipefail

# 設定
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
REPORT_FILE="/tmp/ccsp-diagnostics-$(date +%Y%m%d_%H%M%S).txt"

# カラー出力
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
NC='\033[0m'

# ステータスアイコン
PASS="✓"
FAIL="✗"
WARN="!"
INFO="i"

# ログ関数
log() {
    echo "$1" | tee -a "$REPORT_FILE"
}

header() {
    echo -e "\n${BLUE}=== $1 ===${NC}" | tee -a "$REPORT_FILE"
}

success() {
    echo -e "${GREEN}${PASS}${NC} $1" | tee -a "$REPORT_FILE"
}

error() {
    echo -e "${RED}${FAIL}${NC} $1" | tee -a "$REPORT_FILE"
}

warn() {
    echo -e "${YELLOW}${WARN}${NC} $1" | tee -a "$REPORT_FILE"
}

info() {
    echo -e "${MAGENTA}${INFO}${NC} $1" | tee -a "$REPORT_FILE"
}

# 診断開始
log "CCSP Agent 診断レポート"
log "生成日時: $(date)"
log "ホスト名: $(hostname)"
log "============================================"

# 1. サービスステータス
header "サービスステータス"

check_service() {
    local service="$1"
    if systemctl is-active --quiet "$service"; then
        success "$service: 稼働中"
        systemctl status "$service" --no-pager --lines=3 >> "$REPORT_FILE" 2>&1
    else
        error "$service: 停止中"
    fi
}

check_service "ccsp-agent"
check_service "redis"

# 2. プロセス情報
header "プロセス情報"

CCSP_PIDS=$(pgrep -f "agents/ccsp/index.js" || true)
if [[ -n "$CCSP_PIDS" ]]; then
    success "CCSPプロセスが実行中 (PID: $CCSP_PIDS)"
    for pid in $CCSP_PIDS; do
        if [[ -e /proc/$pid ]]; then
            info "  PID $pid - メモリ: $(ps -p $pid -o rss= | awk '{print $1/1024 "MB"}') | CPU: $(ps -p $pid -o %cpu=)%"
        fi
    done
else
    error "CCSPプロセスが見つかりません"
fi

# 3. ポート確認
header "ポート確認"

check_port() {
    local port="$1"
    local service="$2"
    if lsof -i :$port >/dev/null 2>&1; then
        success "ポート $port ($service): リスニング中"
    else
        error "ポート $port ($service): 使用されていません"
    fi
}

check_port 3100 "CCSP API"
check_port 3101 "CCSP Health"
check_port 9100 "Prometheus Metrics"
check_port 6379 "Redis"

# 4. Claude CLIステータス
header "Claude CLIステータス"

if command -v claude &> /dev/null; then
    CLAUDE_VERSION=$(claude --version 2>&1 || echo "不明")
    success "Claude CLI: インストール済み ($CLAUDE_VERSION)"
    
    # セッションチェック
    if claude --version &> /dev/null; then
        success "Claude セッション: アクティブ"
    else
        error "Claude セッション: 非アクティブ（ログインが必要）"
    fi
else
    error "Claude CLI: インストールされていません"
fi

# 5. ログファイル分析
header "ログファイル分析"

LATEST_LOG=$(find "$PROJECT_ROOT/logs" -name "ccsp-*.log" -type f -printf '%T@ %p\n' | sort -n | tail -1 | cut -d' ' -f2)
if [[ -n "$LATEST_LOG" ]]; then
    info "最新ログファイル: $LATEST_LOG"
    
    # エラー数カウント
    ERROR_COUNT=$(grep -c "ERROR" "$LATEST_LOG" 2>/dev/null || echo "0")
    WARN_COUNT=$(grep -c "WARN" "$LATEST_LOG" 2>/dev/null || echo "0")
    
    if [[ $ERROR_COUNT -eq 0 ]]; then
        success "エラー: なし"
    else
        warn "エラー: $ERROR_COUNT 件"
        echo "  最新のエラー:" >> "$REPORT_FILE"
        grep "ERROR" "$LATEST_LOG" | tail -5 | sed 's/^/    /' >> "$REPORT_FILE"
    fi
    
    if [[ $WARN_COUNT -eq 0 ]]; then
        success "警告: なし"
    else
        info "警告: $WARN_COUNT 件"
    fi
else
    warn "ログファイルが見つかりません"
fi

# 6. キュー状態
header "キュー状態"

if command -v redis-cli &> /dev/null && redis-cli ping &> /dev/null; then
    QUEUE_SIZE=$(redis-cli llen "bull:ccsp-queue:wait" 2>/dev/null || echo "0")
    ACTIVE_SIZE=$(redis-cli llen "bull:ccsp-queue:active" 2>/dev/null || echo "0")
    FAILED_SIZE=$(redis-cli llen "bull:ccsp-queue:failed" 2>/dev/null || echo "0")
    
    info "待機中のタスク: $QUEUE_SIZE"
    info "実行中のタスク: $ACTIVE_SIZE"
    if [[ $FAILED_SIZE -eq 0 ]]; then
        success "失敗したタスク: なし"
    else
        warn "失敗したタスク: $FAILED_SIZE"
    fi
else
    warn "Redisに接続できません"
fi

# 7. ディスク使用量
header "ディスク使用量"

check_disk_usage() {
    local path="$1"
    local name="$2"
    if [[ -d "$path" ]]; then
        local usage=$(du -sh "$path" 2>/dev/null | cut -f1)
        local count=$(find "$path" -type f | wc -l)
        info "$name: $usage ($count ファイル)"
    fi
}

check_disk_usage "$PROJECT_ROOT/logs" "ログディレクトリ"
check_disk_usage "$PROJECT_ROOT/state" "状態ディレクトリ"
check_disk_usage "$PROJECT_ROOT/data" "データディレクトリ"

# 8. 設定確認
header "設定確認"

if [[ -f /etc/poppo/ccsp.env ]]; then
    success "環境変数ファイル: 存在"
    # GitHubトークンの存在確認（値は表示しない）
    if grep -q "GITHUB_TOKEN=." /etc/poppo/ccsp.env; then
        success "GitHubトークン: 設定済み"
    else
        error "GitHubトークン: 未設定"
    fi
else
    error "環境変数ファイル: 存在しない"
fi

if [[ -f "$PROJECT_ROOT/config/config.json" ]]; then
    success "設定ファイル: 存在"
    # JSON検証
    if jq empty "$PROJECT_ROOT/config/config.json" 2>/dev/null; then
        success "設定ファイル: 有効なJSON"
    else
        error "設定ファイル: 無効なJSON"
    fi
else
    error "設定ファイル: 存在しない"
fi

# 9. ネットワーク接続性
header "ネットワーク接続性"

check_connectivity() {
    local url="$1"
    local name="$2"
    if curl -s -o /dev/null -w "%{http_code}" "$url" | grep -q "200\|301\|302"; then
        success "$name: 接続可能"
    else
        error "$name: 接続不可"
    fi
}

check_connectivity "https://api.github.com" "GitHub API"
check_connectivity "https://api.anthropic.com" "Anthropic API"

# 10. ヘルスチェック
header "ヘルスチェック"

if curl -s http://localhost:3101/health > /dev/null 2>&1; then
    HEALTH=$(curl -s http://localhost:3101/health)
    HEALTH_SCORE=$(echo "$HEALTH" | jq -r '.score // 0' 2>/dev/null || echo "0")
    
    if [[ $(echo "$HEALTH_SCORE > 80" | bc -l) -eq 1 ]]; then
        success "ヘルススコア: ${HEALTH_SCORE}%"
    elif [[ $(echo "$HEALTH_SCORE > 60" | bc -l) -eq 1 ]]; then
        warn "ヘルススコア: ${HEALTH_SCORE}%"
    else
        error "ヘルススコア: ${HEALTH_SCORE}%"
    fi
    
    # コンポーネント状態
    echo "$HEALTH" | jq -r '.components | to_entries[] | "\(.key): \(.value.status)"' 2>/dev/null | while read line; do
        if [[ "$line" =~ "healthy" ]]; then
            success "  $line"
        else
            error "  $line"
        fi
    done
else
    error "ヘルスチェックエンドポイントに接続できません"
fi

# レポート完了
echo -e "\n${GREEN}診断完了${NC}"
echo "詳細レポートは以下に保存されました:"
echo "  $REPORT_FILE"

# 問題がある場合の推奨事項
if grep -q "${FAIL}" "$REPORT_FILE"; then
    echo -e "\n${YELLOW}推奨事項:${NC}"
    echo "1. systemctl status ccsp-agent でサービスログを確認"
    echo "2. journalctl -u ccsp-agent -f でリアルタイムログを監視"
    echo "3. 必要に応じて systemctl restart ccsp-agent でサービスを再起動"
fi