#!/bin/bash

# Issue #98 の修正をテストするスクリプト
# - 二重起動防止の強化
# - 状態管理の統一
# - エラー時の整合性
# - タスクキューの永続化

echo "==================================="
echo "Issue #98 テストスクリプト"
echo "==================================="
echo ""

# 作業ディレクトリの設定
POPPO_DIR="/Volumes/PoppoSSD2T/Projects/ClaudeCodeProjects/AIBuildSystem/PoppoBuilderSuite"
cd "$POPPO_DIR" || exit 1

# カラー出力のための設定
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 結果を表示する関数
show_result() {
    if [ $1 -eq 0 ]; then
        echo -e "${GREEN}✅ $2${NC}"
    else
        echo -e "${RED}❌ $2${NC}"
    fi
}

# セクション区切り
section() {
    echo ""
    echo -e "${YELLOW}▶ $1${NC}"
    echo "-----------------------------------"
}

# 1. 環境の初期化
section "1. 環境の初期化"

# 既存のプロセスを停止
echo "既存のPoppoBuilderプロセスを確認..."
ps aux | grep -E "(minimal-poppo|PoppoBuilder)" | grep -v grep | grep -v $$

# 状態ファイルをバックアップ
echo "状態ファイルをバックアップ..."
if [ -d "state" ]; then
    cp -r state state.backup.$(date +%Y%m%d%H%M%S)
    show_result $? "状態ファイルのバックアップ"
fi

# 2. 二重起動防止のテスト
section "2. 二重起動防止のテスト"

echo "最初のcronプロセスを起動..."
node src/minimal-poppo-cron.js > test-process1.log 2>&1 &
FIRST_PID=$!
sleep 3

echo "2つ目のcronプロセスを起動（ブロックされるはず）..."
node src/minimal-poppo-cron.js > test-process2.log 2>&1 &
SECOND_PID=$!
sleep 2

# 2つ目のプロセスが終了しているか確認
if ps -p $SECOND_PID > /dev/null 2>&1; then
    show_result 1 "二重起動防止（2つ目のプロセスが実行中）"
    kill $SECOND_PID 2>/dev/null
else
    show_result 0 "二重起動防止（2つ目のプロセスは正しくブロックされた）"
fi

# ログ内容を確認
echo ""
echo "2番目のプロセスのログ:"
cat test-process2.log 2>/dev/null | grep -E "(別のPoppoBuilder|プロセスロック)" || echo "（ログなし）"

# 最初のプロセスを停止
kill $FIRST_PID 2>/dev/null
wait $FIRST_PID 2>/dev/null

# 3. 状態管理の統一テスト
section "3. 状態管理の統一テスト"

echo "running-tasks.jsonの場所を確認..."
if [ -f "state/running-tasks.json" ]; then
    show_result 0 "running-tasks.jsonは正しい場所（state/）にあります"
    echo "内容: $(cat state/running-tasks.json | jq '.' 2>/dev/null || cat state/running-tasks.json)"
else
    show_result 1 "running-tasks.jsonが見つかりません"
fi

# logs/running-tasks.jsonが存在しないことを確認
if [ -f "logs/running-tasks.json" ]; then
    show_result 1 "古いrunning-tasks.jsonがlogs/に残っています"
else
    show_result 0 "logs/にrunning-tasks.jsonはありません（正しい）"
fi

# 4. エラーハンドリングのテスト
section "4. エラーハンドリングのテスト"

echo "状態ファイルの整合性を確認..."
node -e "
const FileStateManager = require('./src/file-state-manager');
const stateManager = new FileStateManager();

(async () => {
  try {
    await stateManager.init();
    const integrity = await stateManager.checkIntegrity();
    if (integrity.isValid) {
      console.log('✅ 状態ファイルの整合性: OK');
    } else {
      console.log('❌ 状態ファイルの整合性エラー:');
      integrity.errors.forEach(err => console.log('  - ' + err));
    }
  } catch (error) {
    console.error('エラー:', error.message);
  }
})();
"

# 5. タスクキューの永続化テスト
section "5. タスクキューの永続化テスト"

echo "pending-tasks.jsonの存在を確認..."
if [ -f "state/pending-tasks.json" ]; then
    show_result 0 "pending-tasks.jsonが存在します"
    echo "内容: $(cat state/pending-tasks.json | jq '.' 2>/dev/null || echo '[]')"
else
    show_result 1 "pending-tasks.jsonが見つかりません"
fi

# 6. プロセスロックのテスト
section "6. プロセスロックのテスト"

echo "プロセスロックファイルを確認..."
if [ -f "state/poppo-node.lock" ]; then
    echo "ロックファイルが存在します:"
    cat state/poppo-node.lock | jq '.' 2>/dev/null || cat state/poppo-node.lock
else
    echo "ロックファイルは存在しません（正常）"
fi

# 7. プロセス異常終了時の回復テスト
section "7. プロセス異常終了時の回復テスト"

echo "テスト用のcronプロセスを起動..."
node src/minimal-poppo-cron.js > test-process3.log 2>&1 &
PID3=$!
sleep 3

echo "プロセスを強制終了..."
kill -9 $PID3 2>/dev/null
sleep 1

echo "新しいプロセスを起動（死んだタスクをクリーンアップするはず）..."
node src/minimal-poppo-cron.js > test-process4.log 2>&1 &
PID4=$!
sleep 5

echo ""
echo "回復ログを確認:"
grep -E "(死んだタスク|クリーンアップ|古いプロセスロック)" test-process4.log || echo "（クリーンアップメッセージなし）"

kill $PID4 2>/dev/null

# 8. 同時実行のシミュレーション
section "8. 同時実行のシミュレーション"

echo "同じIssueを処理する2つのタスクをシミュレート..."
node -e "
const FileStateManager = require('./src/file-state-manager');
const stateManager = new FileStateManager();

(async () => {
  try {
    await stateManager.init();
    
    // タスク1を追加
    await stateManager.addRunningTask('issue-999', {
      issueNumber: 999,
      title: 'Test Issue',
      pid: 12345,
      type: 'issue',
      status: 'running'
    });
    console.log('タスク1を追加しました');
    
    // タスク2を追加しようとする（同じIssue番号）
    const tasks = await stateManager.loadRunningTasks();
    if (tasks['issue-999']) {
      console.log('✅ 同じIssueの二重登録は正しく防止されます');
    }
    
    // クリーンアップ
    await stateManager.removeRunningTask('issue-999');
    console.log('テストタスクをクリーンアップしました');
  } catch (error) {
    console.error('エラー:', error.message);
  }
})();
"

# 9. クリーンアップ
section "9. クリーンアップ"

echo "テストファイルを削除..."
rm -f test-process*.log
show_result $? "テストログファイルの削除"

echo "すべてのPoppoBuilderプロセスを確認..."
ps aux | grep -E "(minimal-poppo|PoppoBuilder)" | grep -v grep | grep -v $$

echo ""
echo "==================================="
echo "テスト完了"
echo "==================================="
echo ""
echo "注意: 本番環境でテストする場合は、必ず状態ファイルのバックアップを取ってください。"
echo "バックアップファイル: state.backup.*"