const path = require('path');

/**
 * PR分析モジュール
 * PRの変更内容を詳細に分析する
 */
class PRAnalyzer {
  constructor(logger, github) {
    this.logger = logger;
    this.github = github;
  }
  
  /**
   * PRを分析
   */
  async analyze(pr) {
    try {
      const [owner, repo] = pr.base.repo.full_name.split('/');
      
      // PR詳細情報の取得
      const prDetails = await this.github.getPullRequest(owner, repo, pr.number);
      
      // 変更ファイルの取得
      const files = await this.github.getPullRequestFiles(owner, repo, pr.number);
      
      // コミット履歴の取得
      const commits = await this.github.getPullRequestCommits(owner, repo, pr.number);
      
      // 分析結果の構築
      const analysis = {
        pr: {
          number: pr.number,
          title: pr.title,
          description: pr.body,
          author: pr.user.login,
          created: pr.created_at,
          updated: pr.updated_at,
          baseRef: pr.base.ref,
          headRef: pr.head.ref,
          mergeable: prDetails.mergeable,
          rebaseable: prDetails.rebaseable,
          draft: pr.draft
        },
        
        stats: {
          files: files.length,
          additions: pr.additions,
          deletions: pr.deletions,
          commits: commits.length,
          changedFiles: this.categorizeFiles(files),
          languages: this.detectLanguages(files)
        },
        
        files: files.map(file => ({
          filename: file.filename,
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
          changes: file.changes,
          patch: file.patch,
          previousFilename: file.previous_filename,
          language: this.detectFileLanguage(file.filename),
          category: this.categorizeFile(file.filename)
        })),
        
        commits: commits.map(commit => ({
          sha: commit.sha,
          message: commit.commit.message,
          author: commit.commit.author.name,
          date: commit.commit.author.date,
          verified: commit.commit.verification?.verified || false
        })),
        
        insights: this.generateInsights(pr, files, commits)
      };
      
      return analysis;
      
    } catch (error) {
      this.logger.error(`PR分析エラー: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * ファイルをカテゴリ分類
   */
  categorizeFiles(files) {
    const categories = {
      source: [],
      test: [],
      config: [],
      documentation: [],
      dependency: [],
      other: []
    };
    
    for (const file of files) {
      const category = this.categorizeFile(file.filename);
      categories[category].push(file.filename);
    }
    
    return categories;
  }
  
  /**
   * 個別ファイルのカテゴリを判定
   */
  categorizeFile(filename) {
    const lower = filename.toLowerCase();
    
    // テストファイル
    if (lower.includes('test') || lower.includes('spec') || 
        lower.endsWith('.test.js') || lower.endsWith('.spec.js')) {
      return 'test';
    }
    
    // 設定ファイル
    if (lower.includes('config') || lower.endsWith('.json') || 
        lower.endsWith('.yaml') || lower.endsWith('.yml') ||
        lower.endsWith('.env') || filename.startsWith('.')) {
      return 'config';
    }
    
    // ドキュメント
    if (lower.endsWith('.md') || lower.endsWith('.txt') || 
        lower.includes('readme') || lower.includes('doc')) {
      return 'documentation';
    }
    
    // 依存関係
    if (filename === 'package.json' || filename === 'package-lock.json' ||
        filename === 'yarn.lock' || filename.includes('requirements')) {
      return 'dependency';
    }
    
    // ソースコード
    const sourceExtensions = ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.cpp', '.c', '.go'];
    if (sourceExtensions.some(ext => lower.endsWith(ext))) {
      return 'source';
    }
    
    return 'other';
  }
  
  /**
   * 使用言語を検出
   */
  detectLanguages(files) {
    const languages = new Map();
    
    for (const file of files) {
      const lang = this.detectFileLanguage(file.filename);
      if (lang) {
        languages.set(lang, (languages.get(lang) || 0) + 1);
      }
    }
    
    // 使用頻度でソート
    return Array.from(languages.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([lang, count]) => ({ language: lang, files: count }));
  }
  
  /**
   * ファイルの言語を検出
   */
  detectFileLanguage(filename) {
    const ext = path.extname(filename).toLowerCase();
    
    const languageMap = {
      '.js': 'JavaScript',
      '.jsx': 'JavaScript',
      '.ts': 'TypeScript',
      '.tsx': 'TypeScript',
      '.py': 'Python',
      '.java': 'Java',
      '.cpp': 'C++',
      '.c': 'C',
      '.go': 'Go',
      '.rb': 'Ruby',
      '.php': 'PHP',
      '.cs': 'C#',
      '.swift': 'Swift',
      '.rs': 'Rust',
      '.kt': 'Kotlin',
      '.scala': 'Scala',
      '.sh': 'Shell',
      '.bash': 'Bash',
      '.md': 'Markdown',
      '.json': 'JSON',
      '.yaml': 'YAML',
      '.yml': 'YAML',
      '.xml': 'XML',
      '.html': 'HTML',
      '.css': 'CSS',
      '.scss': 'SCSS',
      '.less': 'LESS'
    };
    
    return languageMap[ext] || null;
  }
  
  /**
   * インサイトを生成
   */
  generateInsights(pr, files, commits) {
    const insights = [];
    
    // 大規模な変更
    if (pr.additions + pr.deletions > 1000) {
      insights.push({
        type: 'large_change',
        severity: 'warning',
        message: '大規模な変更です。レビューに時間がかかる可能性があります。'
      });
    }
    
    // 多数のファイル変更
    if (files.length > 20) {
      insights.push({
        type: 'many_files',
        severity: 'warning',
        message: `${files.length}個のファイルが変更されています。変更を複数のPRに分割することを検討してください。`
      });
    }
    
    // マージコンフリクトの可能性
    if (pr.mergeable === false) {
      insights.push({
        type: 'merge_conflict',
        severity: 'error',
        message: 'マージコンフリクトが発生しています。解決が必要です。'
      });
    }
    
    // 依存関係の変更
    const hasDependencyChanges = files.some(f => 
      f.filename === 'package.json' || 
      f.filename === 'package-lock.json' ||
      f.filename === 'requirements.txt'
    );
    
    if (hasDependencyChanges) {
      insights.push({
        type: 'dependency_change',
        severity: 'info',
        message: '依存関係が変更されています。セキュリティとバージョン互換性を確認してください。'
      });
    }
    
    // テスト不足の可能性
    const testFiles = files.filter(f => this.categorizeFile(f.filename) === 'test');
    const sourceFiles = files.filter(f => this.categorizeFile(f.filename) === 'source');
    
    if (sourceFiles.length > 0 && testFiles.length === 0) {
      insights.push({
        type: 'missing_tests',
        severity: 'warning',
        message: 'ソースコードの変更がありますが、テストの追加・更新がありません。'
      });
    }
    
    // コミットメッセージの品質
    const poorCommitMessages = commits.filter(c => 
      c.commit.message.length < 10 || 
      c.commit.message.toLowerCase().includes('wip') ||
      c.commit.message.toLowerCase().includes('fix')
    );
    
    if (poorCommitMessages.length > commits.length / 2) {
      insights.push({
        type: 'poor_commit_messages',
        severity: 'info',
        message: 'コミットメッセージが簡潔すぎます。より詳細な説明を推奨します。'
      });
    }
    
    return insights;
  }
}

module.exports = PRAnalyzer;