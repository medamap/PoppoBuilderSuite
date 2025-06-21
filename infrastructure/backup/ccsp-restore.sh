#!/bin/bash
# CCSP Agent リストアスクリプト

set -euo pipefail

# 設定
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BACKUP_ROOT="/var/backups/poppo/ccsp"

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

info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

# 使用方法
usage() {
    cat << EOF
使用方法: $0 [OPTION]... BACKUP_FILE

CCSP Agentのバックアップからリストアします。

オプション:
  -t, --type TYPE      リストアタイプ (full|config|data)
  -n, --dry-run        実際にはリストアせず、内容を確認
  -f, --force          確認なしでリストア
  -s, --source DIR     カスタムバックアップソース
  -h, --help          このヘルプを表示

例:
  $0 20240121_120000.tar.gz
  $0 --type config --dry-run 20240121_120000
  $0 --force /mnt/backup/20240121_120000.tar.gz.gpg

EOF
}

# オプション解析
RESTORE_TYPE="full"
DRY_RUN=false
FORCE=false
CUSTOM_SOURCE=""
BACKUP_FILE=""

while [[ $# -gt 0 ]]; do
    case $1 in
        -t|--type)
            RESTORE_TYPE="$2"
            shift 2
            ;;
        -n|--dry-run)
            DRY_RUN=true
            shift
            ;;
        -f|--force)
            FORCE=true
            shift
            ;;
        -s|--source)
            CUSTOM_SOURCE="$2"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            if [[ -z "$BACKUP_FILE" ]]; then
                BACKUP_FILE="$1"
                shift
            else
                error "不明なオプション: $1"
                usage
                exit 1
            fi
            ;;
    esac
done

# バックアップファイルチェック
if [[ -z "$BACKUP_FILE" ]]; then
    error "バックアップファイルを指定してください"
    usage
    exit 1
fi

# バックアップソースの設定
if [[ -n "$CUSTOM_SOURCE" ]]; then
    BACKUP_ROOT="$CUSTOM_SOURCE"
fi

# 一時ディレクトリ
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

# バックアップファイルの検索
find_backup() {
    local backup_name="$1"
    
    # フルパスの場合
    if [[ -f "$backup_name" ]]; then
        echo "$backup_name"
        return 0
    fi
    
    # バックアップディレクトリ内を検索
    for ext in "" ".tar.gz" ".tar.gz.gpg"; do
        if [[ -f "$BACKUP_ROOT/$backup_name$ext" ]]; then
            echo "$BACKUP_ROOT/$backup_name$ext"
            return 0
        fi
    done
    
    # ディレクトリの場合
    if [[ -d "$BACKUP_ROOT/$backup_name" ]]; then
        echo "$BACKUP_ROOT/$backup_name"
        return 0
    fi
    
    return 1
}

# バックアップの展開
extract_backup() {
    local backup_path="$1"
    
    log "バックアップを展開..."
    
    # 暗号化されている場合
    if [[ "$backup_path" =~ \.gpg$ ]]; then
        log "バックアップを復号化..."
        gpg --decrypt "$backup_path" > "$TEMP_DIR/backup.tar.gz"
        backup_path="$TEMP_DIR/backup.tar.gz"
    fi
    
    # 圧縮されている場合
    if [[ "$backup_path" =~ \.tar\.gz$ ]]; then
        tar -xzf "$backup_path" -C "$TEMP_DIR"
        BACKUP_DIR=$(find "$TEMP_DIR" -maxdepth 1 -type d ! -path "$TEMP_DIR" | head -1)
    else
        # ディレクトリの場合
        BACKUP_DIR="$backup_path"
    fi
    
    # メタデータ確認
    if [[ -f "$BACKUP_DIR/backup-metadata.json" ]]; then
        info "バックアップ情報:"
        jq -r '. | "  タイムスタンプ: \(.timestamp)\n  タイプ: \(.type)\n  バージョン: \(.ccsp_version)"' \
            "$BACKUP_DIR/backup-metadata.json"
    else
        warn "メタデータファイルが見つかりません"
    fi
}

# サービス停止
stop_service() {
    if [[ "$DRY_RUN" == "false" ]] && systemctl is-active --quiet ccsp-agent; then
        log "CCSPエージェントサービスを停止..."
        systemctl stop ccsp-agent
    fi
}

# 設定のリストア
restore_config() {
    log "設定ファイルをリストア..."
    
    if [[ "$DRY_RUN" == "true" ]]; then
        info "以下のファイルがリストアされます:"
        find "$BACKUP_DIR/config" -type f 2>/dev/null | sed 's|^|  |'
        return
    fi
    
    # 環境変数ファイル
    if [[ -f "$BACKUP_DIR/config/ccsp.env" ]]; then
        cp "$BACKUP_DIR/config/ccsp.env" /etc/poppo/ccsp.env
        warn "環境変数ファイルをリストアしました。GITHUB_TOKENの再設定が必要です。"
    fi
    
    # systemd設定
    if [[ -f "$BACKUP_DIR/config/ccsp-agent.service" ]]; then
        cp "$BACKUP_DIR/config/ccsp-agent.service" /etc/systemd/system/
        systemctl daemon-reload
    fi
    
    # プロジェクト設定
    if [[ -d "$BACKUP_DIR/project-config" ]]; then
        cp -r "$BACKUP_DIR/project-config/"* "$PROJECT_ROOT/config/"
    fi
}

# データのリストア
restore_data() {
    log "データファイルをリストア..."
    
    if [[ "$DRY_RUN" == "true" ]]; then
        info "以下のデータがリストアされます:"
        [[ -d "$BACKUP_DIR/state" ]] && echo "  - 状態ファイル"
        [[ -d "$BACKUP_DIR/logs" ]] && echo "  - ログファイル"
        [[ -f "$BACKUP_DIR/redis-dump.rdb" ]] && echo "  - Redisデータ"
        return
    fi
    
    # 現在のデータをバックアップ
    log "現在のデータをバックアップ..."
    SAFETY_BACKUP="$PROJECT_ROOT/backup-before-restore-$(date +%Y%m%d_%H%M%S)"
    mkdir -p "$SAFETY_BACKUP"
    [[ -d "$PROJECT_ROOT/state" ]] && cp -r "$PROJECT_ROOT/state" "$SAFETY_BACKUP/"
    
    # 状態ファイルのリストア
    if [[ -d "$BACKUP_DIR/state" ]]; then
        rm -rf "$PROJECT_ROOT/state"
        cp -r "$BACKUP_DIR/state" "$PROJECT_ROOT/"
    fi
    
    # ログファイルのリストア（追加のみ）
    if [[ -d "$BACKUP_DIR/logs" ]]; then
        cp -n "$BACKUP_DIR/logs/"* "$PROJECT_ROOT/logs/" 2>/dev/null || true
    fi
    
    # Redisデータのリストア
    if [[ -f "$BACKUP_DIR/redis-dump.rdb" ]] && command -v redis-cli &> /dev/null; then
        log "Redisデータをリストア..."
        systemctl stop redis || true
        cp "$BACKUP_DIR/redis-dump.rdb" /var/lib/redis/dump.rdb
        chown redis:redis /var/lib/redis/dump.rdb
        systemctl start redis
    fi
}

# 検証
verify_restore() {
    log "リストアを検証..."
    
    # 設定ファイルの存在確認
    local errors=0
    
    if [[ "$RESTORE_TYPE" =~ ^(full|config)$ ]]; then
        [[ -f /etc/poppo/ccsp.env ]] || { warn "環境変数ファイルが見つかりません"; ((errors++)); }
        [[ -f /etc/systemd/system/ccsp-agent.service ]] || { warn "systemdサービスファイルが見つかりません"; ((errors++)); }
    fi
    
    if [[ "$RESTORE_TYPE" =~ ^(full|data)$ ]]; then
        [[ -d "$PROJECT_ROOT/state" ]] || { warn "状態ディレクトリが見つかりません"; ((errors++)); }
    fi
    
    if [[ $errors -eq 0 ]]; then
        log "リストアの検証が成功しました"
    else
        error "リストアに問題があります（$errors 個のエラー）"
    fi
}

# サービス再開
start_service() {
    if [[ "$DRY_RUN" == "false" ]]; then
        log "CCSPエージェントサービスを再開..."
        systemctl start ccsp-agent
        sleep 2
        systemctl status ccsp-agent --no-pager || true
    fi
}

# 確認プロンプト
confirm_restore() {
    if [[ "$FORCE" == "true" ]] || [[ "$DRY_RUN" == "true" ]]; then
        return 0
    fi
    
    echo
    warn "リストアを実行すると現在の設定とデータが上書きされます。"
    echo -n "続行しますか？ [y/N]: "
    read -r response
    
    if [[ ! "$response" =~ ^[Yy]$ ]]; then
        log "リストアをキャンセルしました"
        exit 0
    fi
}

# メイン処理
main() {
    # バックアップファイルの検索
    BACKUP_PATH=$(find_backup "$BACKUP_FILE") || {
        error "バックアップファイルが見つかりません: $BACKUP_FILE"
        exit 1
    }
    
    log "バックアップファイル: $BACKUP_PATH"
    
    # 確認
    confirm_restore
    
    # バックアップの展開
    extract_backup "$BACKUP_PATH"
    
    # リストアタイプに応じた処理
    case "$RESTORE_TYPE" in
        full)
            stop_service
            restore_config
            restore_data
            verify_restore
            start_service
            ;;
        config)
            stop_service
            restore_config
            verify_restore
            start_service
            ;;
        data)
            stop_service
            restore_data
            verify_restore
            start_service
            ;;
        *)
            error "不明なリストアタイプ: $RESTORE_TYPE"
            exit 1
            ;;
    esac
    
    if [[ "$DRY_RUN" == "false" ]]; then
        log "リストアが完了しました"
        info "安全のため、以前のデータは以下に保存されています:"
        info "  $SAFETY_BACKUP"
    else
        info "ドライランモードのため、実際のリストアは行われませんでした"
    fi
}

# 実行
main