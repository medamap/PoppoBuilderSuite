#!/bin/bash

# PoppoBuilder Cron実行ラッパー（強化版）
# ロック機構とエラーハンドリングを強化したバージョン

# エラー時の即座終了、未定義変数の使用禁止、パイプエラーの検出
set -euo pipefail

# スクリプトの場所を取得（シンボリックリンクも解決）
# macOSとLinuxの両方で動作するように対応
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOSの場合
    SCRIPT_PATH="${BASH_SOURCE[0]}"
    while [ -L "$SCRIPT_PATH" ]; do
        SCRIPT_DIR="$( cd -P "$( dirname "$SCRIPT_PATH" )" && pwd )"
        SCRIPT_PATH="$(readlink "$SCRIPT_PATH")"
        [[ "$SCRIPT_PATH" != /* ]] && SCRIPT_PATH="$SCRIPT_DIR/$SCRIPT_PATH"
    done
    SCRIPT_DIR="$( cd -P "$( dirname "$SCRIPT_PATH" )" && pwd )"
else
    # Linuxの場合
    SCRIPT_DIR="$( cd "$( dirname "$(readlink -f "${BASH_SOURCE[0]}")" )" && pwd )"
fi
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

# ============================================
# 環境変数の設定（cron環境用）
# ============================================

# PATH設定（Node.jsへのパスを含む）
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

# HOME設定（cron環境では設定されない場合がある）
if [ -z "${HOME:-}" ]; then
    export HOME=$(eval echo "~$(whoami)")
fi

# PoppoBuilder用環境変数
export NODE_ENV=production
export POPPO_CRON_MODE=true
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8

# ============================================
# 設定値
# ============================================

LOG_DIR="$PROJECT_ROOT/logs/cron"
LOG_FILE="$LOG_DIR/poppo-cron-$(date +%Y-%m-%d).log"
LOCK_DIR="$PROJECT_ROOT/state/poppo-cron.lock"
LOCK_FILE="$LOCK_DIR/pid"
MAX_LOG_SIZE=$((10 * 1024 * 1024))  # 10MB
LOG_RETENTION_DAYS=7
EXECUTION_TIMEOUT=1800  # 30分

# ============================================
# 関数定義
# ============================================

# ログ出力関数
log() {
    local level="${2:-INFO}"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    local message="[$timestamp] [$level] $1"
    
    # ファイルと標準出力に出力
    echo "$message" | tee -a "$LOG_FILE"
    
    # エラーの場合は標準エラー出力にも出力
    if [ "$level" = "ERROR" ]; then
        echo "$message" >&2
    fi
}

# クリーンアップ関数
cleanup() {
    local exit_code=$?
    log "クリーンアップ処理を開始します (終了コード: $exit_code)"
    
    # ロックディレクトリの削除
    if [ -d "$LOCK_DIR" ]; then
        rm -rf "$LOCK_DIR" || log "警告: ロックディレクトリの削除に失敗しました" WARN
    fi
    
    # 実行結果のログ
    if [ $exit_code -eq 0 ]; then
        log "PoppoBuilder Cron実行完了"
    else
        log "PoppoBuilder Cron実行エラー (終了コード: $exit_code)" ERROR
    fi
    
    exit $exit_code
}

# ログローテーション関数
rotate_logs() {
    local log_file="$1"
    
    # ファイルサイズチェック
    if [ -f "$log_file" ]; then
        local size=$(stat -f%z "$log_file" 2>/dev/null || stat -c%s "$log_file" 2>/dev/null || echo 0)
        
        if [ "$size" -gt "$MAX_LOG_SIZE" ]; then
            log "ログファイルが${MAX_LOG_SIZE}バイトを超えたためローテーションします"
            
            # ローテーション先のファイル名
            local rotated_file="${log_file}.$(date +%Y%m%d%H%M%S)"
            
            # ファイルを移動
            if mv "$log_file" "$rotated_file"; then
                # 圧縮
                if gzip "$rotated_file"; then
                    log "ログファイルを圧縮しました: ${rotated_file}.gz"
                else
                    log "ログファイルの圧縮に失敗しました: $rotated_file" WARN
                fi
                
                # 新しいログファイルを作成（権限設定）
                touch "$log_file"
                chmod 644 "$log_file"
            else
                log "ログファイルのローテーションに失敗しました" ERROR
            fi
        fi
    fi
}

# Node.jsバージョンチェック関数
check_nodejs() {
    local node_path=""
    
    # Node.jsを探す
    for path in "/opt/homebrew/bin/node" "/usr/local/bin/node" "/usr/bin/node"; do
        if [ -x "$path" ]; then
            node_path="$path"
            break
        fi
    done
    
    # whichコマンドでも探す
    if [ -z "$node_path" ]; then
        node_path=$(which node 2>/dev/null || true)
    fi
    
    # Node.jsが見つからない場合
    if [ -z "$node_path" ] || [ ! -x "$node_path" ]; then
        log "エラー: Node.jsが見つかりません (PATH=$PATH)" ERROR
        return 1
    fi
    
    # バージョンチェック
    local node_version=$("$node_path" --version 2>/dev/null || echo "不明")
    log "Node.jsパス: $node_path (バージョン: $node_version)"
    
    # パスのみを標準出力に返す
    echo "$node_path"
}

# プロセス生存確認関数
is_process_running() {
    local pid="$1"
    
    # プロセスが存在するかチェック（kill -0 はプロセスにシグナルを送らずに存在確認だけ行う）
    if kill -0 "$pid" 2>/dev/null; then
        return 0
    fi
    
    return 1
}

# ============================================
# シグナルトラップの設定
# ============================================

trap cleanup EXIT
trap 'log "割り込みシグナル(INT)を受信しました" WARN; exit 130' INT
trap 'log "終了シグナル(TERM)を受信しました" WARN; exit 143' TERM

# ============================================
# 初期化処理
# ============================================

# ログディレクトリを作成
mkdir -p "$LOG_DIR"

# ログファイルを作成（権限設定）
touch "$LOG_FILE"
chmod 644 "$LOG_FILE"

# 開始ログ
log "============================================"
log "PoppoBuilder Cron実行開始"
log "プロジェクトルート: $PROJECT_ROOT"
log "スクリプトPID: $$"
log "ユーザー: $(whoami)"
log "ホスト: $(hostname)"
log "============================================"

# GitHub CLIの認証情報を引き継ぐ
export GH_TOKEN=$(gh auth token 2>/dev/null || true)
if [ -z "$GH_TOKEN" ]; then
    log "警告: GitHub認証トークンが取得できません" WARN
else
    log "GitHub認証トークンを取得しました"
fi

# Node.jsの存在確認
NODE_PATH=$(check_nodejs 2>&1 | tail -1)
NODE_CHECK_RESULT=${PIPESTATUS[0]}
if [ $NODE_CHECK_RESULT -ne 0 ]; then
    exit 1
fi

# ============================================
# ロック処理（アトミックな排他制御）
# ============================================

log "ロック取得を試みます"

# アトミックなディレクトリ作成を使用
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    # ロックディレクトリが既に存在する
    if [ -f "$LOCK_FILE" ]; then
        OLD_PID=$(cat "$LOCK_FILE" 2>/dev/null || echo "不明")
        
        # プロセスが実際に実行中かチェック
        if is_process_running "$OLD_PID"; then
            log "別のPoppoBuilder Cronが実行中です (PID: $OLD_PID)" WARN
            exit 0
        else
            log "古いロックファイルを検出しました (PID: $OLD_PID は実行されていません)" WARN
            rm -rf "$LOCK_DIR"
            
            # 再度ロック取得を試みる
            if ! mkdir "$LOCK_DIR" 2>/dev/null; then
                log "ロックの取得に失敗しました" ERROR
                exit 1
            fi
        fi
    else
        log "ロックディレクトリは存在しますがPIDファイルがありません" WARN
        exit 1
    fi
fi

# PIDを記録
echo $$ > "$LOCK_FILE"
log "ロックを取得しました (PID: $$)"

# ============================================
# メイン実行
# ============================================

cd "$PROJECT_ROOT"

# ログローテーションチェック
rotate_logs "$LOG_FILE"

log "minimal-poppo-cron.jsを実行します"

# タイムアウト付きで実行
if command -v timeout >/dev/null 2>&1; then
    # GNU coreutilsのtimeoutコマンドがある場合
    timeout "$EXECUTION_TIMEOUT" "$NODE_PATH" "$PROJECT_ROOT/src/minimal-poppo-cron.js" >> "$LOG_FILE" 2>&1
    EXIT_CODE=$?
    
    if [ $EXIT_CODE -eq 124 ]; then
        log "実行がタイムアウトしました (${EXECUTION_TIMEOUT}秒)" ERROR
    fi
else
    # timeoutコマンドがない場合は通常実行
    "$NODE_PATH" "$PROJECT_ROOT/src/minimal-poppo-cron.js" >> "$LOG_FILE" 2>&1
    EXIT_CODE=$?
fi

# ============================================
# 後処理
# ============================================

# 古いログファイルの削除
log "古いログファイルを削除します (${LOG_RETENTION_DAYS}日以上前)"
find "$LOG_DIR" -name "poppo-cron-*.log*" -mtime +${LOG_RETENTION_DAYS} -type f -print -delete 2>/dev/null | while read -r file; do
    log "削除: $file"
done

# 終了（cleanupがtrapで実行される）
exit $EXIT_CODE