#!/bin/bash
# CCSP Agent ログ分析ツール

set -euo pipefail

# 設定
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="$PROJECT_ROOT/logs"
REPORT_FILE="/tmp/ccsp-log-analysis-$(date +%Y%m%d_%H%M%S).html"

# カラー出力
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 使用方法
usage() {
    cat << EOF
使用方法: $0 [OPTIONS]

CCSP Agentのログを分析し、レポートを生成します。

オプション:
  -d, --days DAYS      分析対象の日数 (デフォルト: 7)
  -l, --log-pattern    ログファイルパターン (デフォルト: ccsp-*.log)
  -o, --output FILE    出力ファイル (デフォルト: /tmp/ccsp-log-analysis-*.html)
  -f, --format FORMAT  出力形式 (html|text|json) (デフォルト: html)
  -h, --help          このヘルプを表示

例:
  $0 --days 30 --format json
  $0 -d 1 -o report.html

EOF
}

# デフォルト値
DAYS=7
LOG_PATTERN="ccsp-*.log"
OUTPUT_FORMAT="html"
CUSTOM_OUTPUT=""

# オプション解析
while [[ $# -gt 0 ]]; do
    case $1 in
        -d|--days)
            DAYS="$2"
            shift 2
            ;;
        -l|--log-pattern)
            LOG_PATTERN="$2"
            shift 2
            ;;
        -o|--output)
            CUSTOM_OUTPUT="$2"
            shift 2
            ;;
        -f|--format)
            OUTPUT_FORMAT="$2"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "不明なオプション: $1"
            usage
            exit 1
            ;;
    esac
done

# 出力ファイル設定
if [[ -n "$CUSTOM_OUTPUT" ]]; then
    REPORT_FILE="$CUSTOM_OUTPUT"
elif [[ "$OUTPUT_FORMAT" == "json" ]]; then
    REPORT_FILE="/tmp/ccsp-log-analysis-$(date +%Y%m%d_%H%M%S).json"
elif [[ "$OUTPUT_FORMAT" == "text" ]]; then
    REPORT_FILE="/tmp/ccsp-log-analysis-$(date +%Y%m%d_%H%M%S).txt"
fi

echo -e "${BLUE}CCSP Agent ログ分析を開始します...${NC}"
echo "分析対象: 過去 $DAYS 日間"
echo "ログパターン: $LOG_PATTERN"
echo

# 対象ログファイルの収集
TEMP_LOG=$(mktemp)
find "$LOG_DIR" -name "$LOG_PATTERN" -mtime -"$DAYS" -type f -exec cat {} \; > "$TEMP_LOG"

if [[ ! -s "$TEMP_LOG" ]]; then
    echo -e "${RED}分析対象のログが見つかりません${NC}"
    rm "$TEMP_LOG"
    exit 1
fi

TOTAL_LINES=$(wc -l < "$TEMP_LOG")
echo "分析対象: $TOTAL_LINES 行"

# 分析実行
analyze_logs() {
    # エラー分析
    ERROR_COUNT=$(grep -c "ERROR" "$TEMP_LOG" || echo "0")
    WARN_COUNT=$(grep -c "WARN" "$TEMP_LOG" || echo "0")
    INFO_COUNT=$(grep -c "INFO" "$TEMP_LOG" || echo "0")
    
    # エラータイプ別集計
    ERROR_TYPES=$(grep "ERROR" "$TEMP_LOG" | sed -E 's/.*ERROR[^:]*: ([^:]+).*/\1/' | sort | uniq -c | sort -rn | head -10)
    
    # 時間帯別分析
    HOURLY_ERRORS=$(grep "ERROR" "$TEMP_LOG" | grep -oE '[0-9]{2}:[0-9]{2}:[0-9]{2}' | cut -d: -f1 | sort | uniq -c)
    
    # セッションタイムアウト分析
    SESSION_TIMEOUTS=$(grep -c "session.*timeout\|Invalid API key" "$TEMP_LOG" || echo "0")
    
    # タスク実行統計
    TASKS_COMPLETED=$(grep -c "Task completed" "$TEMP_LOG" || echo "0")
    TASKS_FAILED=$(grep -c "Task failed" "$TEMP_LOG" || echo "0")
    
    # レート制限
    RATE_LIMIT_HITS=$(grep -c "rate limit\|Rate limit" "$TEMP_LOG" || echo "0")
    
    # パフォーマンス分析（実行時間）
    AVG_EXEC_TIME=$(grep -oE "execution time: [0-9.]+" "$TEMP_LOG" | awk '{sum+=$3; count++} END {if(count>0) print sum/count; else print 0}')
}

# 分析実行
analyze_logs

# レポート生成
case "$OUTPUT_FORMAT" in
    html)
        cat > "$REPORT_FILE" << EOF
<!DOCTYPE html>
<html>
<head>
    <title>CCSP Agent ログ分析レポート</title>
    <meta charset="utf-8">
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background-color: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background-color: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #333; border-bottom: 2px solid #007bff; padding-bottom: 10px; }
        h2 { color: #555; margin-top: 30px; }
        .stat-box { display: inline-block; margin: 10px; padding: 20px; background-color: #f8f9fa; border-radius: 5px; min-width: 150px; text-align: center; }
        .stat-number { font-size: 36px; font-weight: bold; color: #007bff; }
        .stat-label { color: #666; margin-top: 5px; }
        .error { color: #dc3545; }
        .warning { color: #ffc107; }
        .success { color: #28a745; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background-color: #007bff; color: white; }
        tr:hover { background-color: #f5f5f5; }
        .chart { margin: 20px 0; }
        pre { background-color: #f8f9fa; padding: 10px; border-radius: 5px; overflow-x: auto; }
    </style>
</head>
<body>
    <div class="container">
        <h1>CCSP Agent ログ分析レポート</h1>
        <p>分析期間: 過去 $DAYS 日間 | 生成日時: $(date)</p>
        
        <h2>概要統計</h2>
        <div>
            <div class="stat-box">
                <div class="stat-number">$TOTAL_LINES</div>
                <div class="stat-label">総ログ行数</div>
            </div>
            <div class="stat-box">
                <div class="stat-number error">$ERROR_COUNT</div>
                <div class="stat-label">エラー</div>
            </div>
            <div class="stat-box">
                <div class="stat-number warning">$WARN_COUNT</div>
                <div class="stat-label">警告</div>
            </div>
            <div class="stat-box">
                <div class="stat-number success">$INFO_COUNT</div>
                <div class="stat-label">情報</div>
            </div>
        </div>
        
        <h2>タスク実行統計</h2>
        <div>
            <div class="stat-box">
                <div class="stat-number success">$TASKS_COMPLETED</div>
                <div class="stat-label">完了タスク</div>
            </div>
            <div class="stat-box">
                <div class="stat-number error">$TASKS_FAILED</div>
                <div class="stat-label">失敗タスク</div>
            </div>
            <div class="stat-box">
                <div class="stat-number">$(echo "scale=2; $TASKS_COMPLETED * 100 / ($TASKS_COMPLETED + $TASKS_FAILED)" | bc)%</div>
                <div class="stat-label">成功率</div>
            </div>
        </div>
        
        <h2>問題の統計</h2>
        <div>
            <div class="stat-box">
                <div class="stat-number error">$SESSION_TIMEOUTS</div>
                <div class="stat-label">セッションタイムアウト</div>
            </div>
            <div class="stat-box">
                <div class="stat-number warning">$RATE_LIMIT_HITS</div>
                <div class="stat-label">レート制限</div>
            </div>
        </div>
        
        <h2>エラータイプ TOP 10</h2>
        <table>
            <tr><th>件数</th><th>エラータイプ</th></tr>
EOF

        echo "$ERROR_TYPES" | while read count type; do
            if [[ -n "$count" ]]; then
                echo "<tr><td>$count</td><td>$type</td></tr>" >> "$REPORT_FILE"
            fi
        done

        cat >> "$REPORT_FILE" << EOF
        </table>
        
        <h2>時間帯別エラー分布</h2>
        <pre>
$HOURLY_ERRORS
        </pre>
        
        <h2>推奨アクション</h2>
        <ul>
EOF

        # 推奨事項の生成
        if [[ $SESSION_TIMEOUTS -gt 10 ]]; then
            echo "<li class='error'>セッションタイムアウトが頻発しています。Claude CLIの自動ログイン機能の実装を検討してください。</li>" >> "$REPORT_FILE"
        fi
        
        if [[ $RATE_LIMIT_HITS -gt 50 ]]; then
            echo "<li class='warning'>レート制限に頻繁に到達しています。リクエスト間隔の調整が必要です。</li>" >> "$REPORT_FILE"
        fi
        
        if [[ $(echo "$TASKS_FAILED > $TASKS_COMPLETED * 0.1" | bc) -eq 1 ]]; then
            echo "<li class='error'>タスク失敗率が10%を超えています。エラーログの詳細確認が必要です。</li>" >> "$REPORT_FILE"
        fi

        cat >> "$REPORT_FILE" << EOF
        </ul>
    </div>
</body>
</html>
EOF
        ;;
        
    json)
        cat > "$REPORT_FILE" << EOF
{
  "analysis_period_days": $DAYS,
  "generated_at": "$(date -Iseconds)",
  "total_log_lines": $TOTAL_LINES,
  "summary": {
    "errors": $ERROR_COUNT,
    "warnings": $WARN_COUNT,
    "info": $INFO_COUNT
  },
  "tasks": {
    "completed": $TASKS_COMPLETED,
    "failed": $TASKS_FAILED,
    "success_rate": $(echo "scale=2; $TASKS_COMPLETED * 100 / ($TASKS_COMPLETED + $TASKS_FAILED)" | bc)
  },
  "issues": {
    "session_timeouts": $SESSION_TIMEOUTS,
    "rate_limit_hits": $RATE_LIMIT_HITS
  }
}
EOF
        ;;
        
    text)
        cat > "$REPORT_FILE" << EOF
CCSP Agent ログ分析レポート
========================
分析期間: 過去 $DAYS 日間
生成日時: $(date)

概要統計
--------
総ログ行数: $TOTAL_LINES
エラー: $ERROR_COUNT
警告: $WARN_COUNT
情報: $INFO_COUNT

タスク実行統計
--------------
完了タスク: $TASKS_COMPLETED
失敗タスク: $TASKS_FAILED
成功率: $(echo "scale=2; $TASKS_COMPLETED * 100 / ($TASKS_COMPLETED + $TASKS_FAILED)" | bc)%

問題の統計
----------
セッションタイムアウト: $SESSION_TIMEOUTS
レート制限: $RATE_LIMIT_HITS

エラータイプ TOP 10
-------------------
$ERROR_TYPES

時間帯別エラー分布
------------------
$HOURLY_ERRORS
EOF
        ;;
esac

# クリーンアップ
rm "$TEMP_LOG"

echo -e "${GREEN}分析が完了しました${NC}"
echo "レポート: $REPORT_FILE"

# HTMLの場合はブラウザで開く提案
if [[ "$OUTPUT_FORMAT" == "html" ]] && command -v open &> /dev/null; then
    echo -e "\n${BLUE}レポートを開きますか？ [Y/n]${NC}"
    read -r response
    if [[ ! "$response" =~ ^[Nn]$ ]]; then
        open "$REPORT_FILE"
    fi
fi