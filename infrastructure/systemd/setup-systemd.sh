#!/bin/bash
# CCSP Agent systemd セットアップスクリプト

set -euo pipefail

# 設定
SERVICE_NAME="ccsp-agent"
SERVICE_FILE="ccsp-agent.service"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# カラー出力
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ログ関数
log() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

# root権限チェック
check_root() {
    if [[ $EUID -ne 0 ]]; then
        error "このスクリプトはroot権限で実行する必要があります"
        echo "使用方法: sudo $0"
        exit 1
    fi
}

# poppoユーザー作成
create_user() {
    if ! id -u poppo >/dev/null 2>&1; then
        log "poppoユーザーを作成します..."
        useradd -r -s /bin/bash -d /var/lib/poppo -m poppo
        log "poppoユーザーを作成しました"
    else
        log "poppoユーザーは既に存在します"
    fi
}

# ディレクトリ作成と権限設定
setup_directories() {
    log "必要なディレクトリを作成します..."
    
    # 設定ディレクトリ
    mkdir -p /etc/poppo
    chown poppo:poppo /etc/poppo
    chmod 755 /etc/poppo
    
    # ログディレクトリ
    mkdir -p /var/log/poppo
    chown poppo:poppo /var/log/poppo
    chmod 755 /var/log/poppo
    
    # 実行時ディレクトリ
    mkdir -p /var/run/poppo
    chown poppo:poppo /var/run/poppo
    chmod 755 /var/run/poppo
    
    log "ディレクトリの作成が完了しました"
}

# 環境変数ファイル作成
create_env_file() {
    local env_file="/etc/poppo/ccsp.env"
    
    if [[ ! -f "$env_file" ]]; then
        log "環境変数ファイルを作成します..."
        cat > "$env_file" << EOF
# CCSP Agent Environment Variables
# GitHubトークンは必須です
GITHUB_TOKEN=

# Redis設定（デフォルト値）
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
# REDIS_PASSWORD=

# Claude CLI設定
CLAUDE_CLI_PATH=/usr/local/bin/claude
CLAUDE_API_TIMEOUT=300000

# ログレベル
LOG_LEVEL=info

# その他の設定
CCSP_PORT=3100
CCSP_MAX_QUEUE_SIZE=100
CCSP_WORKER_COUNT=3
EOF
        chown poppo:poppo "$env_file"
        chmod 600 "$env_file"
        warn "環境変数ファイルを作成しました: $env_file"
        warn "必ずGITHUB_TOKENを設定してください"
    else
        log "環境変数ファイルは既に存在します: $env_file"
    fi
}

# systemdサービスインストール
install_service() {
    log "systemdサービスをインストールします..."
    
    # サービスファイルのコピー
    cp "$SCRIPT_DIR/$SERVICE_FILE" "/etc/systemd/system/$SERVICE_FILE"
    
    # プロジェクトパスの置換
    sed -i "s|/Volumes/PoppoSSD2T/Projects/ClaudeCodeProjects/AIBuildSystem/PoppoBuilderSuite|$PROJECT_ROOT|g" \
        "/etc/systemd/system/$SERVICE_FILE"
    
    # systemdリロード
    systemctl daemon-reload
    
    log "systemdサービスのインストールが完了しました"
}

# ログローテーション設定
setup_logrotate() {
    log "ログローテーション設定を作成します..."
    
    cat > /etc/logrotate.d/ccsp-agent << EOF
/var/log/poppo/ccsp-*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 0644 poppo poppo
    sharedscripts
    postrotate
        systemctl reload ccsp-agent >/dev/null 2>&1 || true
    endscript
}

$PROJECT_ROOT/logs/ccsp-*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 0644 poppo poppo
    sharedscripts
    postrotate
        systemctl reload ccsp-agent >/dev/null 2>&1 || true
    endscript
}
EOF
    
    log "ログローテーション設定が完了しました"
}

# サービスの有効化と起動
enable_service() {
    log "サービスを有効化します..."
    systemctl enable "$SERVICE_NAME"
    
    echo
    echo -e "${BLUE}=== セットアップ完了 ===${NC}"
    echo
    echo "次の手順でCCSPエージェントを起動してください："
    echo
    echo "1. 環境変数を設定:"
    echo "   vim /etc/poppo/ccsp.env"
    echo
    echo "2. サービスを起動:"
    echo "   systemctl start $SERVICE_NAME"
    echo
    echo "3. ステータスを確認:"
    echo "   systemctl status $SERVICE_NAME"
    echo
    echo "4. ログを確認:"
    echo "   journalctl -u $SERVICE_NAME -f"
    echo
}

# アンインストール関数
uninstall() {
    log "CCSPエージェントのsystemd設定を削除します..."
    
    # サービス停止と無効化
    if systemctl is-active --quiet "$SERVICE_NAME"; then
        systemctl stop "$SERVICE_NAME"
    fi
    if systemctl is-enabled --quiet "$SERVICE_NAME"; then
        systemctl disable "$SERVICE_NAME"
    fi
    
    # ファイル削除
    rm -f "/etc/systemd/system/$SERVICE_FILE"
    rm -f "/etc/logrotate.d/ccsp-agent"
    
    # systemdリロード
    systemctl daemon-reload
    
    log "アンインストールが完了しました"
}

# メイン処理
main() {
    check_root
    
    if [[ "${1:-}" == "uninstall" ]]; then
        uninstall
        exit 0
    fi
    
    log "CCSP Agent systemdセットアップを開始します..."
    
    create_user
    setup_directories
    create_env_file
    install_service
    setup_logrotate
    enable_service
    
    log "セットアップが正常に完了しました"
}

# 実行
main "$@"