#!/usr/bin/env node

/**
 * Fix missing labels on processed issues
 * 
 * このスクリプトは、processed-issues.jsonに記録されているが
 * 適切なラベルが付いていないIssueを修正します。
 */

const fs = require('fs').promises;
const path = require('path');

async function main() {
  try {
    console.log('🔧 Missing labels fix script started');
    
    // 設定読み込み
    const configPath = path.join(__dirname, '../config/config.json');
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    
    // processed-issues.json読み込み
    const processedIssuesPath = path.join(__dirname, '../state/processed-issues.json');
    const processedIssues = JSON.parse(await fs.readFile(processedIssuesPath, 'utf8'));
    
    // issue-status.json読み込み
    const issueStatusPath = path.join(__dirname, '../state/issue-status.json');
    const issueStatus = JSON.parse(await fs.readFile(issueStatusPath, 'utf8'));
    
    console.log(`\n📋 Found ${processedIssues.length} processed issues`);
    
    // 各処理済みIssueに対してラベル更新リクエストを作成
    const timestamp = Date.now();
    const requestsPath = path.join(__dirname, '../state/requests');
    
    // requestsディレクトリが存在しない場合は作成
    try {
      await fs.access(requestsPath);
    } catch {
      await fs.mkdir(requestsPath, { recursive: true });
    }
    
    for (const issueNumber of processedIssues) {
      console.log(`\n🔍 Checking Issue #${issueNumber}`);
      
      // issue-status.jsonでの状態を確認
      const status = issueStatus.issues[issueNumber];
      if (status) {
        console.log(`   Status: ${status.status}`);
        console.log(`   Task Type: ${status.taskType}`);
        
        // エラーがある場合は表示
        if (status.result && status.result.error) {
          console.log(`   ⚠️  Error: ${status.result.error}`);
        }
      }
      
      // awaiting-responseラベルを付けるリクエストを作成
      const labelRequest = {
        requestId: `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date().toISOString(),
        issueNumber: issueNumber,
        action: 'update',
        addLabels: ['awaiting-response'],
        removeLabels: [],
        requestedBy: 'fix-missing-labels-script',
        processId: process.pid.toString(),
        reason: 'fix-missing-labels'
      };
      
      const requestFile = path.join(requestsPath, `label-update-${timestamp}-${issueNumber}.json`);
      await fs.writeFile(requestFile, JSON.stringify(labelRequest, null, 2));
      console.log(`   ✅ Created label update request: ${path.basename(requestFile)}`);
      
      // issue-status.jsonの状態も更新
      if (issueStatus.issues[issueNumber]) {
        // processing状態でないものは、awaiting-responseに更新
        if (issueStatus.issues[issueNumber].status !== 'processing') {
          issueStatus.issues[issueNumber].status = 'awaiting-response';
          issueStatus.issues[issueNumber].lastUpdated = new Date().toISOString();
        }
      } else {
        // エントリがない場合は新規作成
        issueStatus.issues[issueNumber] = {
          status: 'awaiting-response',
          lastUpdated: new Date().toISOString(),
          processId: null,
          pid: null,
          startTime: new Date().toISOString(),
          lastHeartbeat: null,
          taskType: 'claude-cli',
          metadata: {
            retryCount: 0,
            errorCount: 0
          },
          endTime: new Date().toISOString(),
          result: {
            taskType: 'claude-cli',
            fixedByScript: true
          }
        };
      }
    }
    
    // 更新されたissue-status.jsonを保存
    await fs.writeFile(issueStatusPath, JSON.stringify(issueStatus, null, 2));
    console.log('\n✅ Updated issue-status.json');
    
    console.log('\n📢 Summary:');
    console.log(`   - Created ${processedIssues.length} label update requests`);
    console.log(`   - Updated issue statuses in issue-status.json`);
    console.log('\n💡 Next steps:');
    console.log('   1. Start MirinOrphanManager to process the label update requests:');
    console.log('      node scripts/start-mirin.js --once');
    console.log('   2. Or wait for the next scheduled MirinOrphanManager run');
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();