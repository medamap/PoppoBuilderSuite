#!/bin/bash

# PoppoBuilder スケジューラー
# cronの代わりに5分毎に実行するループスクリプト

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
WRAPPER_SCRIPT="$SCRIPT_DIR/poppo-cron-wrapper.sh"
LOG_FILE="$SCRIPT_DIR/../logs/scheduler.log"

echo "[$(date)] PoppoBuilder Scheduler 開始" | tee -a "$LOG_FILE"

while true; do
    echo "[$(date)] 実行開始" | tee -a "$LOG_FILE"
    
    # ラッパースクリプトを実行
    "$WRAPPER_SCRIPT"
    
    echo "[$(date)] 実行完了、5分待機" | tee -a "$LOG_FILE"
    
    # 5分待機
    sleep 300
done