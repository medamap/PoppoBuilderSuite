const { execSync } = require('child_process');
const GitHubRateLimiter = require('./github-rate-limiter');

class GitHubClient {
  constructor(config) {
    console.log('GitHubClient 初期化:', config);
    this.owner = config?.owner || 'medamap';
    this.repo = config?.repo || 'PoppoBuilderSuite';
    console.log(`GitHub設定: ${this.owner}/${this.repo}`);
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
   * 新しいIssueを作成
   */
  async createIssue(options = {}) {
    try {
      const { title, body, labels = [] } = options;
      
      // コマンドを構築
      let cmd = `gh issue create --repo ${this.owner}/${this.repo}`;
      
      if (title) {
        cmd += ` --title "${title}"`;
      }
      
      if (body) {
        cmd += ` --body "${body}"`;
      }
      
      if (labels.length > 0) {
        cmd += ` --label "${labels.join(',')}"`;
      }
      
      const output = await this.executeWithRateLimit(cmd, 1);
      
      // 作成されたIssueの番号を抽出
      const match = output.match(/issues\/(\d+)/);
      if (match) {
        const issueNumber = parseInt(match[1]);
        return await this.getIssue(issueNumber);
      }
      
      return JSON.parse(output);
    } catch (error) {
      console.error('Failed to create issue:', error.message);
      throw error;
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
   * 特定のラベルが付いたIssueリストを取得
   */
  async listIssuesWithLabel(labelName) {
    try {
      return await this.listIssues({ labels: [labelName] });
    } catch (error) {
      console.error(`Failed to list issues with label ${labelName}:`, error.message);
      return [];
    }
  }

  /**
   * Issueのラベルを更新（既存ラベルを新しいラベルで置き換え）
   */
  async updateLabels(issueNumber, newLabels) {
    try {
      // 現在のIssueを取得
      const issue = await this.getIssue(issueNumber);
      if (!issue) {
        throw new Error(`Issue #${issueNumber} not found`);
      }

      const currentLabels = issue.labels.map(l => l.name);
      const newLabelsSet = new Set(newLabels);

      // 削除すべきラベル
      const labelsToRemove = currentLabels.filter(label => !newLabelsSet.has(label));
      
      // 追加すべきラベル
      const labelsToAdd = newLabels.filter(label => !currentLabels.includes(label));

      // ラベルを削除
      if (labelsToRemove.length > 0) {
        await this.removeLabels(issueNumber, labelsToRemove);
      }

      // ラベルを追加
      if (labelsToAdd.length > 0) {
        await this.addLabels(issueNumber, labelsToAdd);
      }

      return true;
    } catch (error) {
      console.error(`Failed to update labels for issue #${issueNumber}:`, error.message);
      throw error;
    }
  }

  /**
   * Issueにコメントを作成（addCommentのエイリアス）
   */
  async createComment(issueNumber, body) {
    return await this.addComment(issueNumber, body);
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

  /**
   * Pull Requestリストを取得
   */
  async listPullRequests(owner, repo, state = 'open') {
    try {
      const targetRepo = `${owner || this.owner}/${repo || this.repo}`;
      const output = await this.executeWithRateLimit(
        `gh pr list --repo ${targetRepo} --state ${state} --json number,title,body,labels,author,createdAt,updatedAt,draft,additions,deletions,head,base,user`,
        1
      );
      return JSON.parse(output);
    } catch (error) {
      console.error('Failed to list pull requests:', error.message);
      return [];
    }
  }

  /**
   * Pull Requestの詳細を取得
   */
  async getPullRequest(owner, repo, number) {
    try {
      const targetRepo = `${owner || this.owner}/${repo || this.repo}`;
      const output = await this.executeWithRateLimit(
        `gh pr view ${number} --repo ${targetRepo} --json number,title,body,labels,author,createdAt,updatedAt,draft,additions,deletions,head,base,mergeable,rebaseable`,
        1
      );
      return JSON.parse(output);
    } catch (error) {
      console.error(`Failed to get PR #${number}:`, error.message);
      return null;
    }
  }

  /**
   * Pull Requestのファイル一覧を取得
   */
  async getPullRequestFiles(owner, repo, number) {
    try {
      const targetRepo = `${owner || this.owner}/${repo || this.repo}`;
      const output = await this.executeWithRateLimit(
        `gh api repos/${targetRepo}/pulls/${number}/files`,
        1
      );
      return JSON.parse(output);
    } catch (error) {
      console.error(`Failed to get PR files for #${number}:`, error.message);
      return [];
    }
  }

  /**
   * Pull Requestのコミット一覧を取得
   */
  async getPullRequestCommits(owner, repo, number) {
    try {
      const targetRepo = `${owner || this.owner}/${repo || this.repo}`;
      const output = await this.executeWithRateLimit(
        `gh api repos/${targetRepo}/pulls/${number}/commits`,
        1
      );
      return JSON.parse(output);
    } catch (error) {
      console.error(`Failed to get PR commits for #${number}:`, error.message);
      return [];
    }
  }

  /**
   * Pull Requestにレビューを作成
   */
  async createReview(owner, repo, number, review) {
    try {
      const targetRepo = `${owner || this.owner}/${repo || this.repo}`;
      const fs = require('fs');
      const path = require('path');
      const tempFile = path.join(__dirname, '../temp', `review-${number}-${Date.now()}.json`);
      
      // レビューデータをJSONファイルに保存
      fs.writeFileSync(tempFile, JSON.stringify(review), 'utf8');
      
      const output = await this.executeWithRateLimit(
        `gh api repos/${targetRepo}/pulls/${number}/reviews --input ${tempFile}`,
        1
      );
      
      // 一時ファイルを削除
      fs.unlinkSync(tempFile);
      
      return JSON.parse(output);
    } catch (error) {
      console.error(`Failed to create review for PR #${number}:`, error.message);
      return null;
    }
  }

  /**
   * Pull Requestにレビューコメントを作成
   */
  async createReviewComment(owner, repo, number, commitId, path, line, body) {
    try {
      const targetRepo = `${owner || this.owner}/${repo || this.repo}`;
      const commentData = {
        body: body,
        commit_id: commitId,
        path: path,
        line: line || 1
      };
      
      const fs = require('fs');
      const pathModule = require('path');
      const tempFile = pathModule.join(__dirname, '../temp', `review-comment-${number}-${Date.now()}.json`);
      
      fs.writeFileSync(tempFile, JSON.stringify(commentData), 'utf8');
      
      const output = await this.executeWithRateLimit(
        `gh api repos/${targetRepo}/pulls/${number}/comments --input ${tempFile}`,
        1
      );
      
      // 一時ファイルを削除
      fs.unlinkSync(tempFile);
      
      return JSON.parse(output);
    } catch (error) {
      console.error(`Failed to create review comment for PR #${number}:`, error.message);
      return null;
    }
  }

  /**
   * コミットのステータスを作成
   */
  async createStatus(owner, repo, sha, status) {
    try {
      const targetRepo = `${owner || this.owner}/${repo || this.repo}`;
      const statusData = {
        state: status.state,
        context: status.context,
        description: status.description,
        target_url: status.target_url
      };
      
      const fs = require('fs');
      const path = require('path');
      const tempFile = path.join(__dirname, '../temp', `status-${sha}-${Date.now()}.json`);
      
      fs.writeFileSync(tempFile, JSON.stringify(statusData), 'utf8');
      
      const output = await this.executeWithRateLimit(
        `gh api repos/${targetRepo}/statuses/${sha} --input ${tempFile}`,
        1
      );
      
      // 一時ファイルを削除
      fs.unlinkSync(tempFile);
      
      return JSON.parse(output);
    } catch (error) {
      console.error(`Failed to create status for commit ${sha}:`, error.message);
      return null;
    }
  }
}

module.exports = GitHubClient;