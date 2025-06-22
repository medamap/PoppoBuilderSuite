#!/usr/bin/env node

/**
 * 並行アクセステスト用の子プロセススクリプト
 */

const FileStateManager = require('../src/file-state-manager');

async function main() {
  const [, , stateDir, processId, numOperations] = process.argv;
  
  const stateManager = new FileStateManager(stateDir);
  
  for (let i = 0; i < parseInt(numOperations); i++) {
    try {
      // 既存のIssueを読み込み
      const issues = await stateManager.loadProcessedIssues();
      
      // 新しいIssueを追加
      const newIssueNumber = parseInt(processId) * 100 + i;
      issues.add(newIssueNumber);
      
      // 保存
      await stateManager.saveProcessedIssues(issues);
      
      // ランダムな遅延（競合状態をシミュレート）
      await new Promise(resolve => setTimeout(resolve, Math.random() * 10));
    } catch (error) {
      console.error(`Process ${processId} operation ${i} error:`, error);
      process.exit(1);
    }
  }
  
  process.exit(0);
}

main();