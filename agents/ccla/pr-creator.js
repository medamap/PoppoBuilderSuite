/**
 * 自動PR作成機能
 * 修復成功時に自動的にPull Requestを作成する
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

class AutoPRCreator {
  constructor(logger = console) {
    this.logger = logger;
    
    // PR作成設定
    this.config = {
      branchPrefix: 'auto-repair/',
      commitPrefix: '🔧 fix: Auto-repair ',
      prLabelPrefix: 'auto-repair',
      baseBranch: 'develop'
    };
  }
  
  /**
   * 修復結果からPRを作成
   */
  async createPRFromRepair(repairInfo) {
    try {
      this.logger.info('自動PR作成を開始します...');
      
      // 1. 現在のブランチを保存
      const originalBranch = this.getCurrentBranch();
      
      // 2. 新しいブランチを作成
      const branchName = this.generateBranchName(repairInfo);
      await this.createBranch(branchName);
      
      // 3. コミットを作成
      const commitMessage = this.generateCommitMessage(repairInfo);
      await this.createCommit(commitMessage, repairInfo);
      
      // 4. PRを作成
      const prInfo = await this.createPullRequest(branchName, repairInfo);
      
      // 5. 元のブランチに戻る
      await this.checkoutBranch(originalBranch);
      
      this.logger.info(`PR作成完了: ${prInfo.url}`);
      
      return {
        success: true,
        prUrl: prInfo.url,
        prNumber: prInfo.number,
        branch: branchName
      };
      
    } catch (error) {
      this.logger.error(`PR creation error: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * 現在のブランチを取得
   */
  getCurrentBranch() {
    try {
      const branch = execSync('git symbolic-ref --short HEAD', { encoding: 'utf8' }).trim();
      return branch;
    } catch {
      return 'main';
    }
  }
  
  /**
   * ブランチ名の生成
   */
  generateBranchName(repairInfo) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const errorType = repairInfo.errorType || 'unknown';
    const hash = repairInfo.errorHash || 'nohash';
    
    return `${this.config.branchPrefix}${errorType}-${hash}-${timestamp}`;
  }
  
  /**
   * 新しいブランチを作成
   */
  async createBranch(branchName) {
    try {
      // 最新の変更を取得
      execSync('git fetch origin', { encoding: 'utf8' });
      
      // ベースブランチから新しいブランチを作成
      execSync(`git checkout -b ${branchName} origin/${this.config.baseBranch}`, { encoding: 'utf8' });
      
      this.logger.info(`ブランチを作成しました: ${branchName}`);
    } catch (error) {
      throw new Error(`ブランチ作成エラー: ${error.message}`);
    }
  }
  
  /**
   * ブランチをチェックアウト
   */
  async checkoutBranch(branchName) {
    try {
      execSync(`git checkout ${branchName}`, { encoding: 'utf8' });
    } catch (error) {
      throw new Error(`チェックアウトエラー: ${error.message}`);
    }
  }
  
  /**
   * コミットメッセージの生成
   */
  generateCommitMessage(repairInfo) {
    const errorType = repairInfo.analysis?.category || 'error';
    const action = repairInfo.repairDetails?.action || 'repair';
    
    const message = `${this.config.commitPrefix}${errorType} ${action}

## Repair Details
- Error Pattern: ${repairInfo.analysis?.patternId || 'Unknown'}
- Category: ${errorType}
- Hash: ${repairInfo.errorHash || 'N/A'}

## Changes Made
${this.formatRepairDetails(repairInfo.repairDetails)}

## Test Results
${this.formatTestResults(repairInfo.testResults)}

---
🤖 This fix was automatically performed by CCLA agent
`;
    
    return message;
  }
  
  /**
   * 修復詳細のフォーマット
   */
  formatRepairDetails(details) {
    if (!details) return '- No details available';
    
    const lines = [];
    
    if (details.filePath) {
      lines.push(`- File: ${details.filePath}`);
    }
    
    if (details.action) {
      lines.push(`- Action: ${details.action}`);
    }
    
    if (details.method) {
      lines.push(`- Repair Method: ${details.method}`);
    }
    
    if (details.originalCode && details.repairedCode) {
      lines.push('- Changes:');
      lines.push('```diff');
      lines.push(`- ${details.originalCode}`);
      lines.push(`+ ${details.repairedCode}`);
      lines.push('```');
    }
    
    return lines.join('\n');
  }
  
  /**
   * テスト結果のフォーマット
   */
  formatTestResults(results) {
    if (!results) return '- Tests not executed';
    
    const lines = [];
    
    if (results.validation) {
      lines.push(`- Validation: ${results.validation.valid ? '✅ Success' : '❌ Failed'}`);
      if (!results.validation.valid && results.validation.reason) {
        lines.push(`  - Reason: ${results.validation.reason}`);
      }
    }
    
    if (results.testsGenerated) {
      lines.push(`- Tests Generated: ${results.testsGenerated}`);
    }
    
    if (results.rollbackAvailable !== undefined) {
      lines.push(`- Rollback: ${results.rollbackAvailable ? 'Available' : 'Not available'}`);
    }
    
    return lines.join('\n') || '- No test information';
  }
  
  /**
   * コミットの作成
   */
  async createCommit(message, repairInfo) {
    try {
      // 変更されたファイルを追加
      if (repairInfo.repairDetails?.filePath) {
        execSync(`git add "${repairInfo.repairDetails.filePath}"`, { encoding: 'utf8' });
      }
      
      // テストファイルがあれば追加
      if (repairInfo.testFiles && repairInfo.testFiles.length > 0) {
        for (const testFile of repairInfo.testFiles) {
          execSync(`git add "${testFile}"`, { encoding: 'utf8' });
        }
      }
      
      // コミットメッセージをファイルに書き込む
      const tempFile = path.join(process.cwd(), `.commit-msg-${Date.now()}.txt`);
      await fs.writeFile(tempFile, message, 'utf8');
      
      // コミットを作成
      execSync(`git commit --file="${tempFile}"`, { encoding: 'utf8' });
      
      // 一時ファイルを削除
      await fs.unlink(tempFile);
      
      this.logger.info('コミットを作成しました');
    } catch (error) {
      throw new Error(`コミット作成エラー: ${error.message}`);
    }
  }
  
  /**
   * Pull Requestの作成
   */
  async createPullRequest(branchName, repairInfo) {
    try {
      // ブランチをプッシュ
      execSync(`git push -u origin ${branchName}`, { encoding: 'utf8' });
      
      // PR本文の生成
      const prBody = this.generatePRBody(repairInfo);
      
      // PR作成（ghコマンドを使用）
      const prBodyFile = path.join(process.cwd(), `.pr-body-${Date.now()}.txt`);
      await fs.writeFile(prBodyFile, prBody, 'utf8');
      
      const errorType = repairInfo.analysis?.category || 'error';
      const prTitle = `🔧 fix: Auto-repair ${errorType} (#${repairInfo.errorHash || 'unknown'})`;
      
      const output = execSync(
        `gh pr create --title "${prTitle}" --body-file "${prBodyFile}" --base ${this.config.baseBranch} --label "${this.config.prLabelPrefix}"`,
        { encoding: 'utf8' }
      );
      
      // 一時ファイルを削除
      await fs.unlink(prBodyFile);
      
      // PR URLを抽出
      const prUrl = output.trim();
      const prNumber = prUrl.match(/\/pull\/(\d+)$/)?.[1];
      
      return {
        url: prUrl,
        number: prNumber || 'unknown'
      };
      
    } catch (error) {
      throw new Error(`PR作成エラー: ${error.message}`);
    }
  }
  
  /**
   * PR本文の生成
   */
  generatePRBody(repairInfo) {
    return `## Summary
CCLA agent detected error logs and executed automatic repair.

## Error Information
- **Category**: ${repairInfo.analysis?.category || 'Unknown'}
- **Pattern ID**: ${repairInfo.analysis?.patternId || 'Unknown'}
- **Severity**: ${repairInfo.analysis?.severity || 'medium'}
- **Error Hash**: ${repairInfo.errorHash || 'N/A'}

## Repair Details
${this.formatRepairDetails(repairInfo.repairDetails)}

## Error Message
\`\`\`
${repairInfo.message || 'No error message'}
\`\`\`

## Stack Trace
\`\`\`
${repairInfo.stackTrace?.slice(0, 5).join('\n') || 'No stack trace'}
\`\`\`

## Test Results
${this.formatTestResults(repairInfo.testResults)}

## Rollback Instructions
${repairInfo.rollbackInfo ? this.formatRollbackInfo(repairInfo.rollbackInfo) : 'No rollback information'}

## Checklist
- [ ] Reviewed repair changes
- [ ] Verified tests pass
- [ ] Confirmed no side effects

---
🤖 This PR was automatically created by CCLA agent
📝 Details: Issue #${repairInfo.issueNumber || 'N/A'}
`;
  }
  
  /**
   * ロールバック情報のフォーマット
   */
  formatRollbackInfo(rollbackInfo) {
    if (!rollbackInfo) return 'No rollback information';
    
    const lines = [];
    
    if (rollbackInfo.backupId) {
      lines.push(`1. Backup ID: ${rollbackInfo.backupId}`);
      lines.push(`2. Rollback available with the following command:`);
      lines.push(`   \`npm run ccla:rollback ${rollbackInfo.backupId}\``);
    }
    
    if (rollbackInfo.manualSteps) {
      lines.push('3. 手動ロールバック手順:');
      rollbackInfo.manualSteps.forEach((step, index) => {
        lines.push(`   ${index + 1}. ${step}`);
      });
    }
    
    return lines.join('\n');
  }
  
  /**
   * 検証：PRが作成可能かチェック
   */
  async canCreatePR() {
    try {
      // gitリポジトリかチェック
      execSync('git rev-parse --git-dir', { encoding: 'utf8' });
      
      // ghコマンドが利用可能かチェック
      execSync('gh --version', { encoding: 'utf8' });
      
      // 認証済みかチェック
      execSync('gh auth status', { encoding: 'utf8' });
      
      return { canCreate: true };
    } catch (error) {
      return { 
        canCreate: false, 
        reason: error.message 
      };
    }
  }
}

module.exports = AutoPRCreator;