#!/usr/bin/env node

/**
 * 既存の状態ファイルをUnifiedStateManagerに移行するスクリプト
 */

const fs = require('fs').promises;
const path = require('path');
const UnifiedStateManager = require('../src/unified-state-manager');

async function migrate() {
  console.log('🔄 統一状態管理システムへのマイグレーション開始\n');
  
  const stateDir = path.join(__dirname, '../state');
  const unifiedStateManager = new UnifiedStateManager(stateDir);
  
  try {
    // UnifiedStateManagerを初期化
    await unifiedStateManager.initialize();
    console.log('✅ UnifiedStateManager初期化完了\n');
    
    // 1. processed-issues.jsonの移行
    console.log('1. processed-issues.jsonの移行');
    try {
      const processedIssuesPath = path.join(stateDir, 'processed-issues.json');
      const processedIssues = JSON.parse(await fs.readFile(processedIssuesPath, 'utf8'));
      
      if (Array.isArray(processedIssues)) {
        for (const issueNumber of processedIssues) {
          await unifiedStateManager.set('issues', issueNumber.toString(), {
            status: 'completed',
            lastUpdated: new Date().toISOString(),
            migratedFrom: 'processed-issues.json'
          });
        }
        console.log(`✅ ${processedIssues.length}件のIssueを移行しました`);
        
        // バックアップを作成
        await fs.rename(processedIssuesPath, processedIssuesPath + '.migrated-' + Date.now());
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('❌ processed-issues.jsonの移行エラー:', error.message);
      }
    }
    
    // 2. issue-status.jsonの移行
    console.log('\n2. issue-status.jsonの移行');
    try {
      const issueStatusPath = path.join(stateDir, 'issue-status.json');
      const issueStatus = JSON.parse(await fs.readFile(issueStatusPath, 'utf8'));
      
      if (issueStatus.issues) {
        const issues = Object.entries(issueStatus.issues);
        for (const [issueNumber, status] of issues) {
          await unifiedStateManager.set('issues', issueNumber, {
            ...status,
            migratedFrom: 'issue-status.json'
          });
        }
        console.log(`✅ ${issues.length}件のIssueステータスを移行しました`);
        
        // バックアップを作成
        await fs.rename(issueStatusPath, issueStatusPath + '.migrated-' + Date.now());
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('❌ issue-status.jsonの移行エラー:', error.message);
      }
    }
    
    // 3. running-tasks.jsonの移行
    console.log('\n3. running-tasks.jsonの移行');
    try {
      const runningTasksPath = path.join(stateDir, 'running-tasks.json');
      const runningTasks = JSON.parse(await fs.readFile(runningTasksPath, 'utf8'));
      
      const tasks = Object.entries(runningTasks);
      for (const [taskId, task] of tasks) {
        await unifiedStateManager.set('tasks', taskId, {
          ...task,
          status: 'running',
          migratedFrom: 'running-tasks.json'
        });
      }
      console.log(`✅ ${tasks.length}件の実行中タスクを移行しました`);
      
      // バックアップを作成
      await fs.rename(runningTasksPath, runningTasksPath + '.migrated-' + Date.now());
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('❌ running-tasks.jsonの移行エラー:', error.message);
      }
    }
    
    // 4. processed-comments.jsonの移行
    console.log('\n4. processed-comments.jsonの移行');
    try {
      const processedCommentsPath = path.join(stateDir, 'processed-comments.json');
      const processedComments = JSON.parse(await fs.readFile(processedCommentsPath, 'utf8'));
      
      await unifiedStateManager.setAll('comments', {
        ...processedComments,
        migratedFrom: 'processed-comments.json'
      });
      
      const totalComments = Object.values(processedComments).reduce((sum, comments) => 
        sum + (Array.isArray(comments) ? comments.length : 0), 0
      );
      console.log(`✅ ${totalComments}件のコメントを移行しました`);
      
      // バックアップを作成
      await fs.rename(processedCommentsPath, processedCommentsPath + '.migrated-' + Date.now());
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('❌ processed-comments.jsonの移行エラー:', error.message);
      }
    }
    
    // 5. pending-tasks.jsonの移行
    console.log('\n5. pending-tasks.jsonの移行');
    try {
      const pendingTasksPath = path.join(stateDir, 'pending-tasks.json');
      const pendingTasks = JSON.parse(await fs.readFile(pendingTasksPath, 'utf8'));
      
      if (Array.isArray(pendingTasks)) {
        for (const task of pendingTasks) {
          const taskId = `pending-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          await unifiedStateManager.set('tasks', taskId, {
            ...task,
            status: 'queued',
            migratedFrom: 'pending-tasks.json'
          });
        }
        console.log(`✅ ${pendingTasks.length}件の保留中タスクを移行しました`);
        
        // バックアップを作成
        await fs.rename(pendingTasksPath, pendingTasksPath + '.migrated-' + Date.now());
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('❌ pending-tasks.jsonの移行エラー:', error.message);
      }
    }
    
    // 移行完了サマリー
    console.log('\n📊 マイグレーション完了サマリー:');
    const allIssues = await unifiedStateManager.getAll('issues');
    const allTasks = await unifiedStateManager.getAll('tasks');
    const allComments = await unifiedStateManager.getAll('comments');
    
    console.log(`- Issues: ${Object.keys(allIssues).length}件`);
    console.log(`- Tasks: ${Object.keys(allTasks).length}件`);
    console.log(`- Comments: ${Object.keys(allComments).length}件`);
    
    console.log('\n🎉 マイグレーションが完了しました！');
    console.log('※ 元のファイルは .migrated-* としてバックアップされています');
    
  } catch (error) {
    console.error('❌ マイグレーションエラー:', error);
    process.exit(1);
  }
}

// 実行
migrate();