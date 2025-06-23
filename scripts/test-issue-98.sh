#!/bin/bash
# Issue #98 のテストスクリプト

echo "=== Issue #98 状態管理統合と二重起動防止のテスト ==="
echo ""

# 作業ディレクトリの確認
cd /Volumes/PoppoSSD2T/Projects/ClaudeCodeProjects/AIBuildSystem/PoppoBuilderSuite || exit 1

# 1. 状態ファイルの初期状態を確認
echo "1. 状態ファイルの初期状態確認"
echo "================================"
echo "running-tasks.json:"
cat state/running-tasks.json | jq '.' 2>/dev/null || echo "{}"
echo ""

# 2. 同時に複数のcronプロセスを起動
echo "2. 二重起動防止テスト"
echo "====================="
echo "最初のプロセスを起動..."
node src/minimal-poppo-cron.js > test-process1.log 2>&1 &
PID1=$!
echo "PID1: $PID1"

sleep 2

echo "2番目のプロセスを起動（二重起動防止が効くはず）..."
node src/minimal-poppo-cron.js > test-process2.log 2>&1 &
PID2=$!
echo "PID2: $PID2"

sleep 5

# プロセスの状態確認
echo ""
echo "プロセス状態:"
ps aux | grep -E "PoppoBuilder|minimal-poppo" | grep -v grep

# ログの確認
echo ""
echo "最初のプロセスのログ:"
head -20 test-process1.log

echo ""
echo "2番目のプロセスのログ（二重起動防止メッセージが表示されるはず）:"
cat test-process2.log

# 3. 実行中タスクの確認
echo ""
echo "3. 実行中タスクの確認"
echo "===================="
echo "running-tasks.json:"
cat state/running-tasks.json | jq '.' 2>/dev/null || echo "{}"

# 4. プロセス異常終了シミュレーション
echo ""
echo "4. プロセス異常終了時の回復テスト"
echo "================================"
if ps -p $PID1 > /dev/null; then
    echo "プロセス $PID1 を強制終了..."
    kill -9 $PID1
    sleep 2
fi

echo "新しいプロセスを起動（死んだタスクをクリーンアップするはず）..."
node src/minimal-poppo-cron.js > test-process3.log 2>&1 &
PID3=$!
echo "PID3: $PID3"

sleep 5

echo ""
echo "回復後のログ:"
head -20 test-process3.log

# 5. 保留中タスクの永続化テスト
echo ""
echo "5. タスクキューの永続化テスト"
echo "==========================="
echo "pending-tasks.json:"
cat state/pending-tasks.json | jq '.' 2>/dev/null || echo "[]"

# クリーンアップ
echo ""
echo "クリーンアップ中..."
kill $PID1 $PID2 $PID3 2>/dev/null
rm -f test-process*.log

echo ""
echo "テスト完了"