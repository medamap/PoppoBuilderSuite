const AgentBase = require('../shared/agent-base');
const PRAnalyzer = require('./pr-analyzer');
const CodeQualityChecker = require('./code-quality-checker');
const SecurityScanner = require('./security-scanner');
const ReviewGenerator = require('./review-generator');
const GitHubClient = require('../../src/github-client');
const path = require('path');
const fs = require('fs').promises;

/**
 * CCRA (Code Change Review Agent)
 * PRレビューの自動化、コード品質チェック、フィードバック生成を行うエージェント
 */
class CCRAAgent extends AgentBase {
  constructor(config = {}) {
    super('CCRA', config);
    
    // GitHubクライアントの初期化
    const [owner, repo] = (config.repository || process.env.GITHUB_REPOSITORY || 'medamap/PoppoBuilderSuite').split('/');
    this.github = new GitHubClient({ owner, repo });
    
    // モジュールの初期化
    this.prAnalyzer = new PRAnalyzer(this.logger, this.github);
    this.qualityChecker = new CodeQualityChecker(this.logger);
    this.securityScanner = new SecurityScanner(this.logger);
    this.reviewGenerator = new ReviewGenerator(this.logger);
    
    // 設定
    this.config = {
      repository: config.repository || process.env.GITHUB_REPOSITORY || 'medamap/PoppoBuilderSuite',
      checkInterval: config.checkInterval || 300000, // 5分
      reviewCriteria: config.reviewCriteria || {
        minCoverage: 80,
        maxComplexity: 10,
        maxFileLength: 500,
        maxDuplication: 5
      },
      excludePatterns: config.excludePatterns || [
        '**/node_modules/**',
        '**/test/**',
        '**/tests/**',
        '**/*.test.js',
        '**/*.spec.js'
      ],
      ...config
    };
    
    // 状態管理
    this.reviewedPRs = new Set();
    this.checkTimer = null;
  }
  
  /**
   * 初期化処理
   */
  async onInitialize() {
    this.logger.info('CCRA エージェントを初期化中...');
    
    // GitHub認証の確認
    if (!process.env.GITHUB_TOKEN) {
      throw new Error('GITHUB_TOKEN環境変数が設定されていません');
    }
    
    // 処理済みPRリストの読み込み
    await this.loadReviewedPRs();
    
    // 定期チェックの開始
    this.startPRCheck();
    
    this.logger.info('CCRA エージェントの初期化完了');
  }
  
  /**
   * PR定期チェックの開始
   */
  startPRCheck() {
    // 即座に最初のチェック
    this.checkPullRequests();
    
    // 定期実行
    this.checkTimer = setInterval(() => {
      this.checkPullRequests();
    }, this.config.checkInterval);
  }
  
  /**
   * オープンなPRをチェック
   */
  async checkPullRequests() {
    try {
      this.logger.info('オープンなPRをチェック中...');
      
      const [owner, repo] = this.config.repository.split('/');
      const prs = await this.github.listPullRequests(owner, repo, 'open');
      
      for (const pr of prs) {
        if (!this.reviewedPRs.has(pr.number) && !this.shouldSkipPR(pr)) {
          this.logger.info(`PR #${pr.number} のレビューを開始: ${pr.title}`);
          
          // タスクとして処理
          await this.handleTaskAssignment({
            taskId: `pr-review-${pr.number}`,
            type: 'PR_REVIEW',
            pr: pr,
            priority: this.calculatePriority(pr),
            deadline: this.calculateDeadline(pr)
          });
        }
      }
    } catch (error) {
      this.logger.error(`PRチェックエラー: ${error.message}`);
    }
  }
  
  /**
   * PRをスキップすべきか判定
   */
  shouldSkipPR(pr) {
    // ドラフトPRはスキップ
    if (pr.draft) return true;
    
    // 特定のラベルがある場合はスキップ
    const skipLabels = ['skip-review', 'wip', 'do-not-review'];
    if (pr.labels.some(label => skipLabels.includes(label.name.toLowerCase()))) {
      return true;
    }
    
    // 自動生成されたPRはスキップ（dependabot等）
    if (pr.user.type === 'Bot') {
      return true;
    }
    
    return false;
  }
  
  /**
   * タスク処理
   */
  async processTask(message) {
    const { type, pr } = message;
    
    if (type !== 'PR_REVIEW') {
      throw new Error(`未対応のタスクタイプ: ${type}`);
    }
    
    try {
      // 進捗報告
      await this.reportProgress(message.taskId, 10, 'PR情報を分析中...');
      
      // 1. PR分析
      const analysis = await this.prAnalyzer.analyze(pr);
      
      await this.reportProgress(message.taskId, 30, 'コード品質をチェック中...');
      
      // 2. コード品質チェック
      const qualityResults = await this.qualityChecker.check(pr, analysis.files);
      
      await this.reportProgress(message.taskId, 50, 'セキュリティスキャンを実行中...');
      
      // 3. セキュリティスキャン
      const securityResults = await this.securityScanner.scan(pr, analysis.files);
      
      await this.reportProgress(message.taskId, 70, 'レビューコメントを生成中...');
      
      // 4. レビュー結果の統合
      const reviewData = {
        pr,
        analysis,
        quality: qualityResults,
        security: securityResults,
        timestamp: new Date().toISOString()
      };
      
      // 5. レビューコメントの生成
      const review = await this.reviewGenerator.generate(reviewData);
      
      await this.reportProgress(message.taskId, 90, 'GitHubにレビューを投稿中...');
      
      // 6. GitHubへの投稿
      await this.postReview(pr, review);
      
      // 処理済みとして記録
      this.reviewedPRs.add(pr.number);
      await this.saveReviewedPRs();
      
      await this.reportProgress(message.taskId, 100, 'レビュー完了');
      
      return {
        success: true,
        prNumber: pr.number,
        reviewSummary: review.summary,
        issuesFound: review.issues.length,
        securityIssues: review.securityIssues.length
      };
      
    } catch (error) {
      this.logger.error(`PR #${pr.number} のレビューエラー: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * GitHubにレビューを投稿
   */
  async postReview(pr, review) {
    const [owner, repo] = this.config.repository.split('/');
    
    // レビューコメントの投稿
    if (review.comments && review.comments.length > 0) {
      for (const comment of review.comments) {
        await this.github.createReviewComment(
          owner,
          repo,
          pr.number,
          comment.commit_id || pr.head.sha,
          comment.path,
          comment.line || comment.position,
          comment.body
        );
      }
    }
    
    // 全体的なレビューサマリーの投稿
    const reviewEvent = this.determineReviewEvent(review);
    await this.github.createReview(
      owner,
      repo,
      pr.number,
      {
        body: review.body,
        event: reviewEvent,
        comments: review.inlineComments || []
      }
    );
    
    // ステータスチェックの更新
    await this.github.createStatus(
      owner,
      repo,
      pr.head.sha,
      {
        state: review.status || 'success',
        context: 'CCRA/code-review',
        description: review.statusDescription || 'コードレビュー完了',
        target_url: review.detailsUrl
      }
    );
  }
  
  /**
   * レビューイベントの決定
   */
  determineReviewEvent(review) {
    if (review.mustFix && review.mustFix.length > 0) {
      return 'REQUEST_CHANGES';
    }
    if (review.suggestions && review.suggestions.length > 0) {
      return 'COMMENT';
    }
    return 'APPROVE';
  }
  
  /**
   * PRの優先度を計算
   */
  calculatePriority(pr) {
    let priority = 50; // 基本優先度
    
    // ラベルによる優先度調整
    if (pr.labels.some(l => l.name === 'urgent')) priority += 30;
    if (pr.labels.some(l => l.name === 'hotfix')) priority += 20;
    if (pr.labels.some(l => l.name === 'security')) priority += 25;
    if (pr.labels.some(l => l.name === 'low-priority')) priority -= 20;
    
    // 変更規模による調整
    if (pr.additions + pr.deletions > 1000) priority += 10;
    if (pr.additions + pr.deletions < 50) priority -= 10;
    
    // PR年齢による調整（古いPRは優先度を上げる）
    const ageInDays = (Date.now() - new Date(pr.created_at)) / (1000 * 60 * 60 * 24);
    if (ageInDays > 7) priority += 15;
    if (ageInDays > 14) priority += 10;
    
    return Math.max(0, Math.min(100, priority));
  }
  
  /**
   * デッドラインを計算
   */
  calculateDeadline(pr) {
    const now = new Date();
    const deadline = new Date(now);
    
    // デフォルトは24時間後
    deadline.setHours(deadline.getHours() + 24);
    
    // ラベルによる調整
    if (pr.labels.some(l => l.name === 'urgent')) {
      deadline.setHours(now.getHours() + 2);
    } else if (pr.labels.some(l => l.name === 'hotfix')) {
      deadline.setHours(now.getHours() + 4);
    }
    
    return deadline.toISOString();
  }
  
  /**
   * 処理済みPRリストの読み込み
   */
  async loadReviewedPRs() {
    const filePath = path.join(__dirname, '../../state/ccra-reviewed-prs.json');
    try {
      const data = await fs.readFile(filePath, 'utf8');
      const prs = JSON.parse(data);
      this.reviewedPRs = new Set(prs);
    } catch (error) {
      // ファイルがない場合は空のSetを使用
      this.reviewedPRs = new Set();
    }
  }
  
  /**
   * 処理済みPRリストの保存
   */
  async saveReviewedPRs() {
    const filePath = path.join(__dirname, '../../state/ccra-reviewed-prs.json');
    const data = JSON.stringify(Array.from(this.reviewedPRs), null, 2);
    await fs.writeFile(filePath, data);
  }
  
  /**
   * タスク実行時間の見積もり
   */
  estimateTaskDuration(message) {
    const { pr } = message;
    
    // 変更行数に基づいて見積もり
    const changes = pr.additions + pr.deletions;
    
    if (changes < 100) return 300000; // 5分
    if (changes < 500) return 600000; // 10分
    if (changes < 1000) return 900000; // 15分
    return 1200000; // 20分
  }
  
  /**
   * シャットダウン処理
   */
  async onShutdown() {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
    }
    
    // 処理済みPRリストを保存
    await this.saveReviewedPRs();
    
    this.logger.info('CCRA エージェントのシャットダウン完了');
  }
}

module.exports = CCRAAgent;