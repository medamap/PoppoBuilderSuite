const fs = require('fs').promises;
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

class TraceabilityGitHubSync {
  constructor(traceabilityManager) {
    this.tm = traceabilityManager;
    // PBS-XXX-nnn形式のID検出パターン
    this.idPattern = /PBS-[A-Z]{2,4}-\d{3}/g;
    // Issue/PR番号検出パターン
    this.issuePattern = /#(\d+)/g;
    this.prPattern = /PR\s*#?(\d+)/gi;
  }

  /**
   * Issueの本文からトレーサビリティIDを抽出
   */
  extractIdsFromText(text) {
    const matches = text.match(this.idPattern) || [];
    return [...new Set(matches)]; // 重複を削除
  }

  /**
   * テキストからIssue/PR番号を抽出
   */
  extractIssueNumbers(text) {
    const issueMatches = text.match(this.issuePattern) || [];
    const prMatches = text.match(this.prPattern) || [];
    
    const issues = issueMatches.map(m => parseInt(m.replace('#', '')));
    const prs = prMatches.map(m => parseInt(m.replace(/PR\s*#?/i, '')));
    
    return {
      issues: [...new Set(issues)],
      prs: [...new Set(prs)]
    };
  }

  /**
   * GitHub Issueの情報を取得
   */
  async getIssueInfo(issueNumber) {
    try {
      const { stdout } = await execAsync(
        `gh issue view ${issueNumber} --json number,title,body,labels,state,author,createdAt,updatedAt`
      );
      return JSON.parse(stdout);
    } catch (error) {
      console.error(`Issue #${issueNumber} の取得に失敗しました:`, error.message);
      return null;
    }
  }

  /**
   * GitHub PRの情報を取得
   */
  async getPRInfo(prNumber) {
    try {
      const { stdout } = await execAsync(
        `gh pr view ${prNumber} --json number,title,body,labels,state,author,createdAt,updatedAt,commits`
      );
      return JSON.parse(stdout);
    } catch (error) {
      console.error(`PR #${prNumber} の取得に失敗しました:`, error.message);
      return null;
    }
  }

  /**
   * コミットメッセージからトレーサビリティIDを抽出
   */
  async extractIdsFromCommits(limit = 50) {
    try {
      const { stdout } = await execAsync(
        `git log --oneline -${limit} --pretty=format:"%H %s"`
      );
      
      const commitIds = new Map(); // ID -> commit hash[]
      const lines = stdout.split('\n').filter(line => line.trim());
      
      lines.forEach(line => {
        const [hash, ...messageParts] = line.split(' ');
        const message = messageParts.join(' ');
        const ids = this.extractIdsFromText(message);
        
        ids.forEach(id => {
          if (!commitIds.has(id)) {
            commitIds.set(id, []);
          }
          commitIds.get(id).push(hash.substring(0, 7)); // 短縮形
        });
      });
      
      return commitIds;
    } catch (error) {
      console.error('コミット履歴の取得に失敗しました:', error.message);
      return new Map();
    }
  }

  /**
   * トレーサビリティアイテムとGitHubリソースをリンク
   */
  async linkItemToGitHub(itemId, githubType, githubNumber) {
    await this.tm.load();
    
    const item = this.tm.getItem(itemId);
    if (!item) {
      throw new Error(`アイテム ${itemId} が見つかりません`);
    }

    // GitHubメタデータを追加
    if (!item.github) {
      item.github = {
        issues: [],
        prs: [],
        commits: []
      };
    }

    if (githubType === 'issue' && !item.github.issues.includes(githubNumber)) {
      item.github.issues.push(githubNumber);
    } else if (githubType === 'pr' && !item.github.prs.includes(githubNumber)) {
      item.github.prs.push(githubNumber);
    }

    // 直接データを更新
    this.tm.data.items[itemId] = item;
    await this.tm.save();
    
    return item;
  }

  /**
   * GitHub Issueを同期
   */
  async syncIssue(issueNumber) {
    const issue = await this.getIssueInfo(issueNumber);
    if (!issue) return;

    // Issue本文からトレーサビリティIDを抽出
    const ids = this.extractIdsFromText(issue.body || '');
    
    console.log(`Issue #${issueNumber} から ${ids.length} 個のIDを検出しました`);
    
    // 各IDをIssueにリンク
    for (const id of ids) {
      try {
        await this.linkItemToGitHub(id, 'issue', issueNumber);
        console.log(`  - ${id} を Issue #${issueNumber} にリンクしました`);
      } catch (error) {
        console.error(`  - ${id} のリンクに失敗: ${error.message}`);
      }
    }

    return ids;
  }

  /**
   * GitHub PRを同期
   */
  async syncPR(prNumber) {
    const pr = await this.getPRInfo(prNumber);
    if (!pr) return;

    // PR本文からトレーサビリティIDを抽出
    const bodyIds = this.extractIdsFromText(pr.body || '');
    
    // コミットメッセージからもIDを抽出
    const commitIds = new Set();
    if (pr.commits && pr.commits.nodes) {
      pr.commits.nodes.forEach(commit => {
        const ids = this.extractIdsFromText(commit.commit.message);
        ids.forEach(id => commitIds.add(id));
      });
    }

    const allIds = [...new Set([...bodyIds, ...commitIds])];
    console.log(`PR #${prNumber} から ${allIds.length} 個のIDを検出しました`);
    
    // 各IDをPRにリンク
    for (const id of allIds) {
      try {
        await this.linkItemToGitHub(id, 'pr', prNumber);
        console.log(`  - ${id} を PR #${prNumber} にリンクしました`);
      } catch (error) {
        console.error(`  - ${id} のリンクに失敗: ${error.message}`);
      }
    }

    return allIds;
  }

  /**
   * すべてのオープンIssueを同期
   */
  async syncAllIssues() {
    try {
      const { stdout } = await execAsync(
        'gh issue list --state all --limit 100 --json number'
      );
      const issues = JSON.parse(stdout);
      
      console.log(`${issues.length} 個のIssueを同期します...`);
      
      for (const issue of issues) {
        await this.syncIssue(issue.number);
      }
    } catch (error) {
      console.error('Issue一覧の取得に失敗しました:', error.message);
    }
  }

  /**
   * トレーサビリティの更新をGitHubにコメント
   */
  async postTraceabilityComment(issueNumber, itemId, action = 'linked') {
    const item = this.tm.getItem(itemId);
    if (!item) return;

    const comment = `## 🔗 トレーサビリティ更新

${action === 'linked' ? 'このIssueは以下のトレーサビリティアイテムにリンクされました:' : 'トレーサビリティ情報が更新されました:'}

- **ID**: ${item.id}
- **フェーズ**: ${item.phase}
- **タイトル**: ${item.title}
${item.description ? `- **説明**: ${item.description}` : ''}

### 関連アイテム
${this.formatRelatedItems(item)}

---
*このコメントはトレーサビリティシステムによって自動生成されました*`;

    try {
      // 一時ファイルに書き込み
      const tempFile = `/tmp/trace-comment-${Date.now()}.md`;
      await fs.writeFile(tempFile, comment, 'utf8');
      
      await execAsync(
        `gh issue comment ${issueNumber} --body-file "${tempFile}"`
      );
      
      // 一時ファイルを削除
      await fs.unlink(tempFile);
      
      console.log(`Issue #${issueNumber} にトレーサビリティコメントを投稿しました`);
    } catch (error) {
      console.error('コメントの投稿に失敗しました:', error.message);
    }
  }

  /**
   * 関連アイテムをフォーマット
   */
  formatRelatedItems(item) {
    const lines = [];
    
    Object.entries(item.links).forEach(([linkType, ids]) => {
      if (ids.length > 0) {
        lines.push(`- **${linkType}**: ${ids.join(', ')}`);
      }
    });

    if (item.github) {
      if (item.github.issues?.length > 0) {
        lines.push(`- **関連Issue**: ${item.github.issues.map(n => `#${n}`).join(', ')}`);
      }
      if (item.github.prs?.length > 0) {
        lines.push(`- **関連PR**: ${item.github.prs.map(n => `#${n}`).join(', ')}`);
      }
    }

    return lines.length > 0 ? lines.join('\n') : '*関連アイテムなし*';
  }

  /**
   * 同期サマリーレポートを生成
   */
  async generateSyncReport() {
    await this.tm.load();
    const items = this.tm.getAllItems();
    
    let report = '# トレーサビリティ GitHub同期レポート\n\n';
    report += `生成日時: ${new Date().toLocaleString('ja-JP')}\n\n`;
    
    // GitHub連携統計
    let linkedItems = 0;
    let totalIssues = 0;
    let totalPRs = 0;
    
    items.forEach(item => {
      if (item.github) {
        linkedItems++;
        totalIssues += item.github.issues?.length || 0;
        totalPRs += item.github.prs?.length || 0;
      }
    });
    
    report += `## 統計情報\n\n`;
    report += `- トレーサビリティアイテム総数: ${items.length}\n`;
    report += `- GitHub連携済みアイテム: ${linkedItems}\n`;
    report += `- 関連Issue総数: ${totalIssues}\n`;
    report += `- 関連PR総数: ${totalPRs}\n\n`;
    
    // 詳細情報
    report += `## 連携詳細\n\n`;
    
    items.forEach(item => {
      if (item.github && (item.github.issues?.length > 0 || item.github.prs?.length > 0)) {
        report += `### ${item.id}: ${item.title}\n\n`;
        
        if (item.github.issues?.length > 0) {
          report += `- Issues: ${item.github.issues.map(n => `#${n}`).join(', ')}\n`;
        }
        if (item.github.prs?.length > 0) {
          report += `- PRs: ${item.github.prs.map(n => `#${n}`).join(', ')}\n`;
        }
        report += '\n';
      }
    });
    
    return report;
  }
}

module.exports = TraceabilityGitHubSync;