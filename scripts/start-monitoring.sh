#!/bin/bash

# PoppoBuilder Suite Monitoring Stack Start Script
set -euo pipefail

# 設定
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MONITORING_DIR="$PROJECT_ROOT/infrastructure"

# ログ関数
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

error() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $1" >&2
}

# 前提条件チェック
check_prerequisites() {
    log "前提条件をチェック中..."
    
    # Docker確認
    if ! command -v docker &> /dev/null; then
        error "Dockerがインストールされていません"
        exit 1
    fi
    
    # Docker Compose確認
    if ! command -v docker-compose &> /dev/null; then
        error "Docker Composeがインストールされていません"
        exit 1
    fi
    
    # 監視設定ディレクトリ確認
    if [[ ! -d "$MONITORING_DIR/monitoring" ]]; then
        error "監視設定ディレクトリが見つかりません: $MONITORING_DIR/monitoring"
        exit 1
    fi
    
    log "前提条件チェック完了"
}

# ネットワーク作成
create_network() {
    log "Dockerネットワークを作成中..."
    
    if ! docker network ls | grep -q "monitoring"; then
        docker network create monitoring || {
            error "ネットワーク作成に失敗しました"
            exit 1
        }
        log "ネットワーク 'monitoring' を作成しました"
    else
        log "ネットワーク 'monitoring' は既に存在します"
    fi
}

# 設定ファイル検証
validate_configs() {
    log "設定ファイルを検証中..."
    
    # Prometheus設定検証
    if [[ -f "$MONITORING_DIR/monitoring/prometheus/prometheus.yml" ]]; then
        # PrometheusのYAML検証
        if docker run --rm -v "$MONITORING_DIR/monitoring/prometheus:/etc/prometheus" \
           prom/prometheus:v2.47.2 promtool check config /etc/prometheus/prometheus.yml; then
            log "Prometheus設定ファイルは有効です"
        else
            error "Prometheus設定ファイルが無効です"
            exit 1
        fi
    else
        error "Prometheus設定ファイルが見つかりません"
        exit 1
    fi
    
    # Alertmanager設定検証
    if [[ -f "$MONITORING_DIR/monitoring/alertmanager/alertmanager.yml" ]]; then
        if docker run --rm -v "$MONITORING_DIR/monitoring/alertmanager:/etc/alertmanager" \
           prom/alertmanager:v0.26.0 amtool check-config /etc/alertmanager/alertmanager.yml; then
            log "Alertmanager設定ファイルは有効です"
        else
            error "Alertmanager設定ファイルが無効です"
            exit 1
        fi
    else
        error "Alertmanager設定ファイルが見つかりません"
        exit 1
    fi
    
    log "設定ファイル検証完了"
}

# 監視スタック起動
start_monitoring() {
    log "監視スタックを起動中..."
    
    cd "$MONITORING_DIR"
    
    # Docker Composeで起動
    docker-compose -f docker-compose.monitoring.yml up -d
    
    if [[ $? -eq 0 ]]; then
        log "監視スタックが正常に起動しました"
    else
        error "監視スタックの起動に失敗しました"
        exit 1
    fi
}

# ヘルスチェック
health_check() {
    log "サービスヘルスチェックを実行中..."
    
    local services=(
        "prometheus:9090"
        "grafana:3000"
        "alertmanager:9093"
    )
    
    local max_attempts=30
    local attempt=1
    
    for service in "${services[@]}"; do
        local service_name="${service%:*}"
        local port="${service#*:}"
        
        log "${service_name}のヘルスチェック中..."
        
        while [[ $attempt -le $max_attempts ]]; do
            if curl -s "http://localhost:${port}/api/health" &> /dev/null || \
               curl -s "http://localhost:${port}/-/healthy" &> /dev/null || \
               curl -s "http://localhost:${port}/" &> /dev/null; then
                log "${service_name}は正常に稼働しています"
                break
            fi
            
            if [[ $attempt -eq $max_attempts ]]; then
                error "${service_name}のヘルスチェックに失敗しました"
                show_service_logs "$service_name"
                return 1
            fi
            
            log "${service_name}の起動を待機中... (${attempt}/${max_attempts})"
            sleep 5
            ((attempt++))
        done
        
        attempt=1
    done
    
    log "すべてのサービスが正常に稼働しています"
}

# サービスログ表示
show_service_logs() {
    local service_name="$1"
    log "${service_name}のログを表示:"
    docker-compose -f "$MONITORING_DIR/docker-compose.monitoring.yml" logs --tail=20 "$service_name"
}

# 監視情報表示
show_monitoring_info() {
    log "監視システム情報:"
    echo ""
    echo "🎯 Prometheus:    http://localhost:9090"
    echo "📊 Grafana:       http://localhost:3000 (admin/poppo2024)"
    echo "🚨 Alertmanager:  http://localhost:9093"
    echo "📈 Node Exporter: http://localhost:9100"
    echo "🐳 cAdvisor:      http://localhost:8080"
    echo ""
    echo "📋 主要ダッシュボード:"
    echo "   - PoppoBuilder システム概要: http://localhost:3000/d/poppo-overview"
    echo "   - エージェント詳細: http://localhost:3000/d/poppo-agents"
    echo ""
    echo "🔍 基本的な使い方:"
    echo "   1. Grafanaにアクセス (admin/poppo2024)"
    echo "   2. 左メニューから 'Dashboards' を選択"
    echo "   3. 'PoppoBuilder Suite' フォルダを開く"
    echo "   4. 使用したいダッシュボードを選択"
    echo ""
}

# 停止機能
stop_monitoring() {
    log "監視スタックを停止中..."
    cd "$MONITORING_DIR"
    docker-compose -f docker-compose.monitoring.yml down
    log "監視スタックが停止しました"
}

# 状態確認
status_monitoring() {
    log "監視スタックの状態:"
    cd "$MONITORING_DIR"
    docker-compose -f docker-compose.monitoring.yml ps
}

# メイン処理
main() {
    local command="${1:-start}"
    
    case "$command" in
        "start")
            log "PoppoBuilder Suite 監視スタックを開始します"
            check_prerequisites
            create_network
            validate_configs
            start_monitoring
            health_check
            show_monitoring_info
            ;;
        "stop")
            stop_monitoring
            ;;
        "restart")
            stop_monitoring
            sleep 5
            main start
            ;;
        "status")
            status_monitoring
            ;;
        "logs")
            local service="${2:-}"
            if [[ -n "$service" ]]; then
                show_service_logs "$service"
            else
                cd "$MONITORING_DIR"
                docker-compose -f docker-compose.monitoring.yml logs -f
            fi
            ;;
        "health")
            health_check
            ;;
        "info")
            show_monitoring_info
            ;;
        *)
            echo "使用方法: $0 {start|stop|restart|status|logs [service]|health|info}"
            echo ""
            echo "コマンド:"
            echo "  start    - 監視スタックを起動"
            echo "  stop     - 監視スタックを停止"
            echo "  restart  - 監視スタックを再起動"
            echo "  status   - 監視スタックの状態確認"
            echo "  logs     - ログ表示 (オプション: サービス名)"
            echo "  health   - ヘルスチェック実行"
            echo "  info     - 監視システム情報表示"
            exit 1
            ;;
    esac
}

# スクリプト実行
main "$@"