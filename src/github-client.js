const { execSync } = require('child_process');
const GitHubRateLimiter = require('./github-rate-limiter');

class GitHubClient {
  constructor(config) {
    this.owner = config.owner;
    this.repo = config.repo;
    this.rateLimiter = new GitHubRateLimiter();
  }

  /**
   * レート制限チェック付きでコマンドを実行
   */
  async executeWithRateLimit(command, requiredCalls = 1) {
    // レート制限チェック
    if (!await this.rateLimiter.canMakeAPICalls(requiredCalls)) {
      await this.rateLimiter.waitForReset();
    }
    
    return execSync(command).toString();
  }

  /**
   * Issueリストを取得
   */
  async listIssues(options = {}) {
    try {
      const { state = 'open', labels = [] } = options;
      
      let cmd = `gh issue list --repo ${this.owner}/${this.repo} --json number,title,body,labels,author,createdAt,updatedAt --state ${state}`;
      
      if (labels.length > 0) {
        cmd += ` --label "${labels.join(',')}"`;
      }
      
      const output = await this.executeWithRateLimit(cmd, 1);
      return JSON.parse(output);
    } catch (error) {
      console.error('Failed to list issues:', error.message);
      return [];
    }
  }

  /**
   * Issueにコメントを追加
   */
  async addComment(issueNumber, body) {
    try {
      // ファイル経由でコメントを投稿（特殊文字対応）
      const fs = require('fs');
      const path = require('path');
      const tempFile = path.join(__dirname, '../temp', `comment-${issueNumber}-${Date.now()}.txt`);
      
      fs.writeFileSync(tempFile, body, 'utf8');
      await this.executeWithRateLimit(`gh issue comment ${issueNumber} --repo ${this.owner}/${this.repo} --body-file "${tempFile}"`, 1);
      
      // 一時ファイルを削除
      fs.unlinkSync(tempFile);
      return true;
    } catch (error) {
      console.error(`Failed to add comment to issue #${issueNumber}:`, error.message);
      return false;
    }
  }

  /**
   * Issueにラベルを追加
   */
  async addLabels(issueNumber, labels) {
    try {
      const labelsStr = labels.join(',');
      await this.executeWithRateLimit(`gh issue edit ${issueNumber} --repo ${this.owner}/${this.repo} --add-label "${labelsStr}"`, 1);
      return true;
    } catch (error) {
      console.error(`Failed to add labels to issue #${issueNumber}:`, error.message);
      return false;
    }
  }

  /**
   * Issueからラベルを削除
   */
  async removeLabels(issueNumber, labels) {
    try {
      const labelsStr = labels.join(',');
      await this.executeWithRateLimit(`gh issue edit ${issueNumber} --repo ${this.owner}/${this.repo} --remove-label "${labelsStr}"`, 1);
      return true;
    } catch (error) {
      console.error(`Failed to remove labels from issue #${issueNumber}:`, error.message);
      return false;
    }
  }

  /**
   * Issueをクローズ
   */
  async closeIssue(issueNumber) {
    try {
      await this.executeWithRateLimit(`gh issue close ${issueNumber} --repo ${this.owner}/${this.repo}`, 1);
      return true;
    } catch (error) {
      console.error(`Failed to close issue #${issueNumber}:`, error.message);
      return false;
    }
  }

  /**
   * Issueの詳細を取得
   */
  async getIssue(issueNumber) {
    try {
      const output = await this.executeWithRateLimit(`gh issue view ${issueNumber} --repo ${this.owner}/${this.repo} --json number,title,body,labels,author,createdAt,updatedAt`, 1);
      return JSON.parse(output);
    } catch (error) {
      console.error(`Failed to get issue #${issueNumber}:`, error.message);
      return null;
    }
  }

  /**
   * Issueのコメントリストを取得
   */
  async listComments(issueNumber) {
    try {
      const output = await this.executeWithRateLimit(`gh issue view ${issueNumber} --repo ${this.owner}/${this.repo} --json comments`, 1);
      const data = JSON.parse(output);
      return data.comments || [];
    } catch (error) {
      console.error(`Failed to list comments for issue #${issueNumber}:`, error.message);
      return [];
    }
  }
}

module.exports = GitHubClient;