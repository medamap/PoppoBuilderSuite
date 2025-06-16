const { execSync } = require('child_process');

class GitHubClient {
  constructor(config) {
    this.owner = config.owner;
    this.repo = config.repo;
  }

  /**
   * Issueリストを取得
   */
  listIssues(options = {}) {
    try {
      const { state = 'open', labels = [] } = options;
      
      let cmd = `gh issue list --repo ${this.owner}/${this.repo} --json number,title,body,labels,author,createdAt,updatedAt --state ${state}`;
      
      if (labels.length > 0) {
        cmd += ` --label "${labels.join(',')}"`;
      }
      
      const output = execSync(cmd).toString();
      return JSON.parse(output);
    } catch (error) {
      console.error('Failed to list issues:', error.message);
      return [];
    }
  }

  /**
   * Issueにコメントを追加
   */
  addComment(issueNumber, body) {
    try {
      // ファイル経由でコメントを投稿（特殊文字対応）
      const fs = require('fs');
      const path = require('path');
      const tempFile = path.join(__dirname, '../temp', `comment-${issueNumber}-${Date.now()}.txt`);
      
      fs.writeFileSync(tempFile, body, 'utf8');
      execSync(`gh issue comment ${issueNumber} --repo ${this.owner}/${this.repo} --body-file "${tempFile}"`);
      
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
  addLabels(issueNumber, labels) {
    try {
      const labelsStr = labels.join(',');
      execSync(`gh issue edit ${issueNumber} --repo ${this.owner}/${this.repo} --add-label "${labelsStr}"`);
      return true;
    } catch (error) {
      console.error(`Failed to add labels to issue #${issueNumber}:`, error.message);
      return false;
    }
  }

  /**
   * Issueからラベルを削除
   */
  removeLabels(issueNumber, labels) {
    try {
      const labelsStr = labels.join(',');
      execSync(`gh issue edit ${issueNumber} --repo ${this.owner}/${this.repo} --remove-label "${labelsStr}"`);
      return true;
    } catch (error) {
      console.error(`Failed to remove labels from issue #${issueNumber}:`, error.message);
      return false;
    }
  }

  /**
   * Issueをクローズ
   */
  closeIssue(issueNumber) {
    try {
      execSync(`gh issue close ${issueNumber} --repo ${this.owner}/${this.repo}`);
      return true;
    } catch (error) {
      console.error(`Failed to close issue #${issueNumber}:`, error.message);
      return false;
    }
  }

  /**
   * Issueの詳細を取得
   */
  getIssue(issueNumber) {
    try {
      const output = execSync(`gh issue view ${issueNumber} --repo ${this.owner}/${this.repo} --json number,title,body,labels,author,createdAt,updatedAt`).toString();
      return JSON.parse(output);
    } catch (error) {
      console.error(`Failed to get issue #${issueNumber}:`, error.message);
      return null;
    }
  }

  /**
   * Issueのコメントリストを取得
   */
  listComments(issueNumber) {
    try {
      const output = execSync(`gh issue view ${issueNumber} --repo ${this.owner}/${this.repo} --json comments`).toString();
      const data = JSON.parse(output);
      return data.comments || [];
    } catch (error) {
      console.error(`Failed to list comments for issue #${issueNumber}:`, error.message);
      return [];
    }
  }
}

module.exports = GitHubClient;