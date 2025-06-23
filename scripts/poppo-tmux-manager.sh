#!/bin/bash

# PoppoBuilder tmux管理スクリプト
# cronの代わりにtmuxセッションで各サービスを管理

# 設定
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"
LOG_DIR="$PROJECT_ROOT/logs/tmux"

# ログディレクトリ作成
mkdir -p "$LOG_DIR"

# 色付き出力
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# ログ関数
log() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"
}

error() {
    echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1" >&2
}

warning() {
    echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"
}

# セッション定義（連想配列の代わりに関数を使用）
get_session_command() {
    case "$1" in
        "${SESSION_PREFIX}-main")
            echo "cd $PROJECT_ROOT && while true; do ./scripts/poppo-cron-wrapper.sh; sleep 300; done"
            ;;
        "${SESSION_PREFIX}-medama")
            echo "while true; do /opt/homebrew/bin/node /Volumes/PoppoSSD2T/Projects/ClaudeCodeProjects/AIBuildSystem/medama-repair-log-only.js >> $LOG_DIR/medama.log 2>&1; sleep 900; done"
            ;;
        "${SESSION_PREFIX}-mera")
            echo "while true; do /opt/homebrew/bin/node /Volumes/PoppoSSD2T/Projects/ClaudeCodeProjects/AIBuildSystem/mera-cleaner.js >> $LOG_DIR/mera.log 2>&1; sleep 1800; done"
            ;;
        "${SESSION_PREFIX}-mirin")
            echo "while true; do CURRENT_MIN=\$(date +%M); if [ \$CURRENT_MIN -eq 03 ] || [ \$CURRENT_MIN -eq 33 ]; then /opt/homebrew/bin/node /Volumes/PoppoSSD2T/Projects/ClaudeCodeProjects/AIBuildSystem/mirin-orphan-manager.js >> $LOG_DIR/mirin.log 2>&1; fi; sleep 60; done"
            ;;
    esac
}

# セッション名の配列（ユニークプレフィックス付き）
SESSION_PREFIX="pbs"  # PoppoBuilder Suite の略
SESSIONS=("${SESSION_PREFIX}-main" "${SESSION_PREFIX}-medama" "${SESSION_PREFIX}-mera" "${SESSION_PREFIX}-mirin")

# セッションが存在するかチェック
session_exists() {
    tmux has-session -t "$1" 2>/dev/null
}

# セッションを開始
start_session() {
    local session_name=$1
    local command=$2
    
    if session_exists "$session_name"; then
        warning "セッション '$session_name' は既に存在します"
    else
        log "セッション '$session_name' を開始します"
        tmux new-session -d -s "$session_name" "$command"
        if [ $? -eq 0 ]; then
            log "✅ セッション '$session_name' を開始しました"
        else
            error "❌ セッション '$session_name' の開始に失敗しました"
        fi
    fi
}

# セッションを停止
stop_session() {
    local session_name=$1
    
    if session_exists "$session_name"; then
        log "セッション '$session_name' を停止します"
        tmux kill-session -t "$session_name"
        log "✅ セッション '$session_name' を停止しました"
    else
        warning "セッション '$session_name' は存在しません"
    fi
}

# すべてのセッションの状態を表示
status() {
    echo -e "${GREEN}=== PoppoBuilder tmuxセッション状態 ===${NC}"
    echo
    
    for session_name in "${SESSIONS[@]}"; do
        if session_exists "$session_name"; then
            echo -e "✅ ${GREEN}$session_name${NC}: 実行中"
            # 最後の5行を表示
            echo "   最新ログ:"
            tmux capture-pane -t "$session_name" -p | tail -5 | sed 's/^/     /'
        else
            echo -e "❌ ${RED}$session_name${NC}: 停止中"
        fi
        echo
    done
}

# ログを表示
show_logs() {
    local session_name=$1
    
    if [ -z "$session_name" ]; then
        error "セッション名を指定してください"
        exit 1
    fi
    
    if session_exists "$session_name"; then
        log "セッション '$session_name' のログを表示します"
        tmux attach-session -t "$session_name"
    else
        error "セッション '$session_name' は存在しません"
        exit 1
    fi
}

# すべてのセッションを開始
start_all() {
    log "すべてのPoppoBuilderセッションを開始します"
    
    for session_name in "${SESSIONS[@]}"; do
        command=$(get_session_command "$session_name")
        start_session "$session_name" "$command"
    done
}

# すべてのセッションを停止
stop_all() {
    log "すべてのPoppoBuilderセッションを停止します"
    
    for session_name in "${SESSIONS[@]}"; do
        stop_session "$session_name"
    done
}

# cronエントリを削除
remove_cron() {
    log "既存のcronエントリを削除します"
    
    # 一時ファイルに現在のcrontabを保存
    crontab -l > /tmp/crontab.backup 2>/dev/null
    
    # PoppoBuilder関連のエントリを削除
    grep -v "poppo-cron-wrapper.sh" /tmp/crontab.backup | \
    grep -v "medama-repair" | \
    grep -v "mera-cleaner" | \
    grep -v "mirin-orphan-manager" > /tmp/crontab.new
    
    # 新しいcrontabを適用
    crontab /tmp/crontab.new
    
    log "✅ cronエントリを削除しました"
}

# ヘルプ表示
show_help() {
    cat << EOF
PoppoBuilder tmux管理ツール

使用方法:
    $0 <コマンド> [オプション]

コマンド:
    start       すべてのセッションを開始
    stop        すべてのセッションを停止
    restart     すべてのセッションを再起動
    status      セッションの状態を表示
    logs <name> 指定したセッションのログを表示
    remove-cron cronエントリを削除
    help        このヘルプを表示

セッション名:
    ${SESSION_PREFIX}-main    - PoppoBuilder本体（5分毎）
    ${SESSION_PREFIX}-medama  - MedamaRepair（15分毎）
    ${SESSION_PREFIX}-mera    - MeraCleaner（30分毎）
    ${SESSION_PREFIX}-mirin   - MirinOrphanManager（毎時3,33分）

例:
    $0 start                    # すべて開始
    $0 logs ${SESSION_PREFIX}-main  # メインのログを表示
    $0 status                   # 状態確認

EOF
}

# メイン処理
case "$1" in
    start)
        start_all
        ;;
    stop)
        stop_all
        ;;
    restart)
        stop_all
        sleep 2
        start_all
        ;;
    status)
        status
        ;;
    logs)
        show_logs "$2"
        ;;
    remove-cron)
        remove_cron
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        error "不明なコマンド: $1"
        show_help
        exit 1
        ;;
esac