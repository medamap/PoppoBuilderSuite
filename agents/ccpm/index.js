const AgentBase = require('../shared/agent-base');
const Redis = require('ioredis');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const path = require('path');

/**
 * CCPM (Code Change Process Manager)
 * コードレビュー、修正提案、リファクタリング提案を担当
 */
class CCPMAgent extends AgentBase {
  constructor(config = {}) {
    super('CCPM', config);
    
    // Redis接続を追加（processManagerの代わり）
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379
    });
    this.responseQueue = 'ccsp:responses:ccpm';
    this.reviewPatterns = {
      security: [
        /password|secret|key|token/i,
        /eval\s*\(/,
        /innerHTML\s*=/
      ],
      performance: [
        /for\s*\(.*in\s+/,
        /document\.write/,
        /synchronous\s+xhr/i
      ],
      quality: [
        /console\.(log|debug|info)/,
        /TODO|FIXME|HACK/,
        /magic\s+number/i
      ]
    };
  }
  
  /**
   * 初期化処理
   */
  async onInitialize() {
    this.logger.info('CCPM エージェントの専用初期化を実行中...');
    // 必要に応じて追加の初期化処理
  }
  
  /**
   * タスク処理のメイン実装
   */
  async processTask(message) {
    const { taskType, context, payload } = message;
    
    this.logger.info(`タスク処理開始: ${taskType} (${message.taskId})`);
    
    switch (taskType) {
      case 'code-review':
        return await this.performCodeReview(context, payload);
        
      case 'refactoring-suggestion':
        return await this.suggestRefactoring(context, payload);
        
      case 'security-audit':
        return await this.performSecurityAudit(context, payload);
        
      default:
        throw new Error(`未対応のタスクタイプ: ${taskType}`);
    }
  }
  
  /**
   * コードレビューの実行
   */
  async performCodeReview(context, payload) {
    const { files, issueNumber, issueBody } = payload;
    const reviewResults = [];
    
    await this.reportProgress(context.taskId, 10, 'コードレビューを開始します');
    
    // ファイルごとにレビュー
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      await this.reportProgress(
        context.taskId, 
        10 + (80 * (i / files.length)),
        `ファイルをレビュー中: ${file}`
      );
      
      try {
        const content = await fs.readFile(file, 'utf8');
        const issues = await this.analyzeCode(file, content);
        
        if (issues.length > 0) {
          reviewResults.push({
            file,
            issues,
            severity: this.calculateSeverity(issues)
          });
        }
      } catch (error) {
        this.logger.warn(`ファイル読み取りエラー: ${file} - ${error.message}`);
      }
    }
    
    // Claudeを使用した高度な分析
    const advancedAnalysis = await this.performAdvancedAnalysis(context, reviewResults);
    
    await this.reportProgress(context.taskId, 100, 'コードレビュー完了');
    
    return {
      success: true,
      reviewCount: files.length,
      issuesFound: reviewResults.length,
      results: reviewResults,
      advancedAnalysis,
      summary: this.generateReviewSummary(reviewResults)
    };
  }
  
  /**
   * コードの静的解析
   */
  async analyzeCode(filePath, content) {
    const issues = [];
    const lines = content.split('\n');
    
    // セキュリティパターンのチェック
    for (const [category, patterns] of Object.entries(this.reviewPatterns)) {
      for (const pattern of patterns) {
        lines.forEach((line, index) => {
          if (pattern.test(line)) {
            issues.push({
              type: category,
              line: index + 1,
              message: `${category}の潜在的な問題: ${pattern.source}`,
              code: line.trim(),
              severity: category === 'security' ? 'high' : 'medium'
            });
          }
        });
      }
    }
    
    // 追加のチェック
    // - 長すぎる関数
    const functionMatches = content.match(/function\s+\w+\s*\([^)]*\)\s*{[^}]+}/g) || [];
    functionMatches.forEach(func => {
      const lineCount = func.split('\n').length;
      if (lineCount > 50) {
        issues.push({
          type: 'quality',
          message: `関数が長すぎます (${lineCount}行)。分割を検討してください。`,
          severity: 'low'
        });
      }
    });
    
    return issues;
  }
  
  /**
   * Claudeを使用した高度な分析
   */
  async performAdvancedAnalysis(context, reviewResults) {
    if (reviewResults.length === 0) {
      return { message: '静的解析で問題は見つかりませんでした。' };
    }
    
    const prompt = `
以下のコードレビュー結果を分析し、改善提案を行ってください：

${JSON.stringify(reviewResults, null, 2)}

以下の観点で分析してください：
1. 最も重要な問題とその修正方法
2. コード品質向上のための提案
3. セキュリティリスクの評価
4. パフォーマンス最適化の可能性
`;
    
    try {
      // パイちゃんへのリクエスト作成
      const requestId = uuidv4();
      const request = {
        requestId,
        fromAgent: 'ccpm',
        type: 'advanced-analysis',
        prompt: prompt,
        context: {
          workingDirectory: process.cwd(),
          timeout: 600000, // 10分
          priority: 'high'
        },
        timestamp: new Date().toISOString()
      };
      
      this.logger.info(`[CCPM] Sending analysis request to CCSP: ${requestId}`);
      
      // リクエスト送信
      await this.redis.lpush('ccsp:requests', JSON.stringify(request));
      
      // レスポンス待機
      const timeout = Date.now() + 600000;
      let response = null;
      
      while (Date.now() < timeout) {
        const data = await this.redis.rpop(this.responseQueue);
        
        if (data) {
          const parsed = JSON.parse(data);
          
          if (parsed.requestId === requestId) {
            if (parsed.success) {
              this.logger.info('[CCPM] Received analysis from CCSP');
              response = parsed.result;
              break;
            } else {
              this.logger.error('[CCPM] CCSP error:', parsed.error);
              throw new Error(parsed.error || 'CCSP analysis failed');
            }
          } else {
            // 他のリクエストのレスポンスは戻す
            await this.redis.lpush(this.responseQueue, data);
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      if (!response) {
        throw new Error('Timeout waiting for CCSP response');
      }
      
      return {
        success: true,
        analysis: response
      };
    } catch (error) {
      this.logger.error(`[CCPM] Claude分析エラー: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * リファクタリング提案
   */
  async suggestRefactoring(context, payload) {
    const { targetFile, focusArea } = payload;
    
    await this.reportProgress(context.taskId, 20, 'コードを分析中...');
    
    const content = await fs.readFile(targetFile, 'utf8');
    
    const prompt = `
以下のコードをリファクタリングしてください。
フォーカスエリア: ${focusArea || '全般的な改善'}

\`\`\`javascript
${content}
\`\`\`

改善提案:
1. より読みやすく保守しやすいコードに
2. パフォーマンスの最適化
3. 最新のベストプラクティスの適用
`;
    
    await this.reportProgress(context.taskId, 50, 'リファクタリング提案を生成中...');
    
    const result = await this.processManager.executeWithContext(
      prompt,
      '',
      null,
      60000 // 1分のタイムアウト
    );
    
    await this.reportProgress(context.taskId, 100, '提案生成完了');
    
    return {
      success: true,
      originalFile: targetFile,
      suggestions: result.output,
      metrics: {
        analysisTime: result.duration,
        focusArea
      }
    };
  }
  
  /**
   * セキュリティ監査
   */
  async performSecurityAudit(context, payload) {
    const { targetDir } = payload;
    const vulnerabilities = [];
    
    await this.reportProgress(context.taskId, 10, 'セキュリティ監査を開始...');
    
    // ディレクトリ内のJavaScriptファイルを検索
    const files = await this.findJavaScriptFiles(targetDir);
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      await this.reportProgress(
        context.taskId,
        10 + (80 * (i / files.length)),
        `ファイルを監査中: ${path.basename(file)}`
      );
      
      const content = await fs.readFile(file, 'utf8');
      const issues = await this.auditSecurity(file, content);
      
      if (issues.length > 0) {
        vulnerabilities.push({ file, issues });
      }
    }
    
    await this.reportProgress(context.taskId, 100, 'セキュリティ監査完了');
    
    return {
      success: true,
      filesAudited: files.length,
      vulnerabilitiesFound: vulnerabilities.length,
      vulnerabilities,
      riskLevel: this.calculateRiskLevel(vulnerabilities)
    };
  }
  
  /**
   * JavaScriptファイルの検索
   */
  async findJavaScriptFiles(dir, files = []) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        await this.findJavaScriptFiles(fullPath, files);
      } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.jsx'))) {
        files.push(fullPath);
      }
    }
    
    return files;
  }
  
  /**
   * セキュリティ監査の実行
   */
  async auditSecurity(filePath, content) {
    const issues = [];
    
    // 危険な関数の使用
    const dangerousPatterns = [
      { pattern: /eval\s*\(/, message: 'eval()の使用は避けてください' },
      { pattern: /Function\s*\(/, message: 'Function constructorの使用は避けてください' },
      { pattern: /innerHTML\s*=/, message: 'innerHTMLはXSSのリスクがあります' },
      { pattern: /document\.write/, message: 'document.writeの使用は避けてください' }
    ];
    
    dangerousPatterns.forEach(({ pattern, message }) => {
      if (pattern.test(content)) {
        issues.push({
          type: 'security',
          severity: 'high',
          message,
          pattern: pattern.source
        });
      }
    });
    
    // ハードコードされた認証情報
    const secretPatterns = [
      /api[_-]?key\s*[:=]\s*["'][^"']+["']/i,
      /password\s*[:=]\s*["'][^"']+["']/i,
      /secret\s*[:=]\s*["'][^"']+["']/i
    ];
    
    secretPatterns.forEach(pattern => {
      if (pattern.test(content)) {
        issues.push({
          type: 'security',
          severity: 'critical',
          message: 'ハードコードされた認証情報が見つかりました',
          pattern: pattern.source
        });
      }
    });
    
    return issues;
  }
  
  /**
   * 重要度の計算
   */
  calculateSeverity(issues) {
    const severityScores = {
      critical: 10,
      high: 5,
      medium: 3,
      low: 1
    };
    
    const totalScore = issues.reduce((sum, issue) => 
      sum + (severityScores[issue.severity] || 0), 0
    );
    
    if (totalScore >= 10) return 'critical';
    if (totalScore >= 5) return 'high';
    if (totalScore >= 3) return 'medium';
    return 'low';
  }
  
  /**
   * リスクレベルの計算
   */
  calculateRiskLevel(vulnerabilities) {
    let criticalCount = 0;
    let highCount = 0;
    
    vulnerabilities.forEach(({ issues }) => {
      issues.forEach(issue => {
        if (issue.severity === 'critical') criticalCount++;
        if (issue.severity === 'high') highCount++;
      });
    });
    
    if (criticalCount > 0) return 'critical';
    if (highCount > 2) return 'high';
    if (highCount > 0) return 'medium';
    return 'low';
  }
  
  /**
   * レビューサマリーの生成
   */
  generateReviewSummary(reviewResults) {
    const issueCounts = {
      security: 0,
      performance: 0,
      quality: 0
    };
    
    reviewResults.forEach(({ issues }) => {
      issues.forEach(issue => {
        if (issueCounts[issue.type] !== undefined) {
          issueCounts[issue.type]++;
        }
      });
    });
    
    return {
      totalIssues: reviewResults.reduce((sum, r) => sum + r.issues.length, 0),
      byCategory: issueCounts,
      recommendation: this.generateRecommendation(issueCounts)
    };
  }
  
  /**
   * 推奨事項の生成
   */
  generateRecommendation(issueCounts) {
    if (issueCounts.security > 0) {
      return 'セキュリティの問題を優先的に修正してください。';
    }
    if (issueCounts.performance > 3) {
      return 'パフォーマンスの最適化を検討してください。';
    }
    if (issueCounts.quality > 5) {
      return 'コード品質の改善が必要です。';
    }
    return 'コードは概ね良好です。';
  }
  
  /**
   * タスク実行時間の見積もり
   */
  estimateTaskDuration(message) {
    const { taskType, payload } = message;
    
    switch (taskType) {
      case 'code-review':
        const fileCount = payload.files?.length || 1;
        return Math.min(fileCount * 60000, 3600000); // ファイルあたり1分、最大1時間
        
      case 'refactoring-suggestion':
        return 300000; // 5分
        
      case 'security-audit':
        return 600000; // 10分
        
      default:
        return 300000; // デフォルト5分
    }
  }
  
  /**
   * クリーンアップ処理
   */
  async cleanup() {
    if (this.redis) {
      await this.redis.quit();
    }
    await super.cleanup();
  }
}

// エージェントの起動
if (require.main === module) {
  const agent = new CCPMAgent();
  
  agent.initialize().catch(error => {
    console.error('エージェント起動エラー:', error);
    process.exit(1);
  });
  
  // グレースフルシャットダウン
  process.on('SIGINT', async () => {
    console.log('\nシャットダウン中...');
    await agent.shutdown();
    process.exit(0);
  });
}

module.exports = CCPMAgent;