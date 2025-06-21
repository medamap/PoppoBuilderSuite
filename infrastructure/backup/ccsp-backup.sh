#!/bin/bash
# CCSP Agent バックアップスクリプト

set -euo pipefail

# 設定
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BACKUP_ROOT="/var/backups/poppo/ccsp"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="$BACKUP_ROOT/$TIMESTAMP"

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

# 使用方法
usage() {
    cat << EOF
使用方法: $0 [OPTION]...

CCSP Agentのバックアップを作成します。

オプション:
  -t, --type TYPE       バックアップタイプ (full|incremental|data-only)
  -c, --compress        圧縮バックアップを作成
  -e, --encrypt         バックアップを暗号化
  -r, --retention DAYS  保持日数 (デフォルト: 30)
  -d, --destination DIR カスタムバックアップ先
  -h, --help           このヘルプを表示

例:
  $0 --type full --compress
  $0 --type incremental --retention 7
  $0 --type data-only --destination /mnt/backup

EOF
}

# オプション解析
BACKUP_TYPE="full"
COMPRESS=false
ENCRYPT=false
RETENTION_DAYS=30
CUSTOM_DEST=""

while [[ $# -gt 0 ]]; do
    case $1 in
        -t|--type)
            BACKUP_TYPE="$2"
            shift 2
            ;;
        -c|--compress)
            COMPRESS=true
            shift
            ;;
        -e|--encrypt)
            ENCRYPT=true
            shift
            ;;
        -r|--retention)
            RETENTION_DAYS="$2"
            shift 2
            ;;
        -d|--destination)
            CUSTOM_DEST="$2"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            error "不明なオプション: $1"
            usage
            exit 1
            ;;
    esac
done

# バックアップ先の設定
if [[ -n "$CUSTOM_DEST" ]]; then
    BACKUP_ROOT="$CUSTOM_DEST"
    BACKUP_DIR="$BACKUP_ROOT/$TIMESTAMP"
fi

# バックアップディレクトリ作成
create_backup_dir() {
    log "バックアップディレクトリを作成: $BACKUP_DIR"
    mkdir -p "$BACKUP_DIR"
}

# サービス停止（オプション）
stop_service() {
    if systemctl is-active --quiet ccsp-agent; then
        log "CCSPエージェントサービスを停止..."
        systemctl stop ccsp-agent
        NEED_RESTART=true
    else
        NEED_RESTART=false
    fi
}

# サービス再開
start_service() {
    if [[ "$NEED_RESTART" == "true" ]]; then
        log "CCSPエージェントサービスを再開..."
        systemctl start ccsp-agent
    fi
}

# 設定ファイルのバックアップ
backup_config() {
    log "設定ファイルをバックアップ..."
    
    # システム設定
    mkdir -p "$BACKUP_DIR/config"
    
    # 環境変数ファイル（機密情報をマスク）
    if [[ -f /etc/poppo/ccsp.env ]]; then
        sed 's/\(GITHUB_TOKEN=\).*/\1[MASKED]/' /etc/poppo/ccsp.env > "$BACKUP_DIR/config/ccsp.env"
    fi
    
    # プロジェクト設定
    cp -r "$PROJECT_ROOT/config" "$BACKUP_DIR/project-config"
    
    # systemd設定
    if [[ -f /etc/systemd/system/ccsp-agent.service ]]; then
        cp /etc/systemd/system/ccsp-agent.service "$BACKUP_DIR/config/"
    fi
}

# データファイルのバックアップ
backup_data() {
    log "データファイルをバックアップ..."
    
    # 状態ファイル
    mkdir -p "$BACKUP_DIR/state"
    if [[ -d "$PROJECT_ROOT/state" ]]; then
        cp -r "$PROJECT_ROOT/state" "$BACKUP_DIR/"
    fi
    
    # ログファイル（最新7日分）
    mkdir -p "$BACKUP_DIR/logs"
    find "$PROJECT_ROOT/logs" -name "ccsp-*.log" -mtime -7 -exec cp {} "$BACKUP_DIR/logs/" \;
    
    # キューデータ（Redisダンプ）
    if command -v redis-cli &> /dev/null; then
        log "Redisデータをバックアップ..."
        redis-cli BGSAVE
        sleep 2
        if [[ -f /var/lib/redis/dump.rdb ]]; then
            cp /var/lib/redis/dump.rdb "$BACKUP_DIR/redis-dump.rdb"
        fi
    fi
}

# メタデータ作成
create_metadata() {
    log "メタデータを作成..."
    
    cat > "$BACKUP_DIR/backup-metadata.json" << EOF
{
  "timestamp": "$TIMESTAMP",
  "type": "$BACKUP_TYPE",
  "version": "1.0",
  "hostname": "$(hostname)",
  "project_root": "$PROJECT_ROOT",
  "ccsp_version": "$(cd $PROJECT_ROOT && git describe --tags --always 2>/dev/null || echo 'unknown')",
  "compressed": $COMPRESS,
  "encrypted": $ENCRYPT,
  "files": [
$(find "$BACKUP_DIR" -type f -printf '    "%P",\n' | sed '$ s/,$//')
  ]
}
EOF
}

# 圧縮
compress_backup() {
    if [[ "$COMPRESS" == "true" ]]; then
        log "バックアップを圧縮..."
        cd "$BACKUP_ROOT"
        tar -czf "$TIMESTAMP.tar.gz" "$TIMESTAMP"
        rm -rf "$TIMESTAMP"
        BACKUP_FILE="$BACKUP_ROOT/$TIMESTAMP.tar.gz"
    else
        BACKUP_FILE="$BACKUP_DIR"
    fi
}

# 暗号化
encrypt_backup() {
    if [[ "$ENCRYPT" == "true" ]]; then
        log "バックアップを暗号化..."
        if [[ "$COMPRESS" == "true" ]]; then
            gpg --symmetric --cipher-algo AES256 "$BACKUP_FILE"
            rm "$BACKUP_FILE"
            BACKUP_FILE="$BACKUP_FILE.gpg"
        else
            error "暗号化は圧縮と併用する必要があります"
            exit 1
        fi
    fi
}

# 古いバックアップの削除
cleanup_old_backups() {
    log "古いバックアップを削除（$RETENTION_DAYS日以前）..."
    find "$BACKUP_ROOT" -maxdepth 1 \
        \( -name "*.tar.gz" -o -name "*.tar.gz.gpg" -o -type d \) \
        -mtime +$RETENTION_DAYS -exec rm -rf {} + 2>/dev/null || true
}

# 検証
verify_backup() {
    log "バックアップを検証..."
    
    if [[ -f "$BACKUP_FILE" ]]; then
        log "バックアップファイル: $BACKUP_FILE"
        log "サイズ: $(du -h "$BACKUP_FILE" | cut -f1)"
    elif [[ -d "$BACKUP_FILE" ]]; then
        log "バックアップディレクトリ: $BACKUP_FILE"
        log "サイズ: $(du -sh "$BACKUP_FILE" | cut -f1)"
    else
        error "バックアップの作成に失敗しました"
        exit 1
    fi
}

# メイン処理
main() {
    log "CCSP Agentバックアップを開始 (タイプ: $BACKUP_TYPE)"
    
    # バックアップタイプに応じた処理
    case "$BACKUP_TYPE" in
        full)
            create_backup_dir
            stop_service
            backup_config
            backup_data
            create_metadata
            start_service
            ;;
        incremental)
            create_backup_dir
            backup_data
            create_metadata
            ;;
        data-only)
            create_backup_dir
            backup_data
            create_metadata
            ;;
        *)
            error "不明なバックアップタイプ: $BACKUP_TYPE"
            exit 1
            ;;
    esac
    
    # 後処理
    compress_backup
    encrypt_backup
    cleanup_old_backups
    verify_backup
    
    log "バックアップが完了しました"
}

# トラップ設定（エラー時のクリーンアップ）
trap 'start_service' ERR

# 実行
main