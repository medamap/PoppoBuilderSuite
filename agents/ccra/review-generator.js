const Redis = require('ioredis');
const { v4: uuidv4 } = require('uuid');

/**
 * レビュー生成モジュール
 * 分析結果からレビューコメントを生成する
 */
class ReviewGenerator {
  constructor(logger) {
    this.logger = logger;
    // Redisクライアントの初期化
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379
    });
    this.responseQueue = 'ccsp:responses:ccra';
  }
  
  /**
   * レビューを生成
   */
  async generate(reviewData) {
    const { pr, analysis, quality, security } = reviewData;
    
    // レビュー結果の初期化
    const review = {
      summary: '',
      body: '',
      status: 'success',
      statusDescription: '',
      issues: [],
      securityIssues: [],
      suggestions: [],
      mustFix: [],
      comments: [],
      inlineComments: []
    };
    
    // 1. 問題の分類と優先度付け
    this.categorizeIssues(quality, security, review);
    
    // 2. インラインコメントの生成
    this.generateInlineComments(quality, security, review);
    
    // 3. 全体的なレビューサマリーの生成
    await this.generateReviewSummary(pr, analysis, review);
    
    // 4. ステータスの決定
    this.determineReviewStatus(review);
    
    return review;
  }
  
  /**
   * 問題を分類
   */
  categorizeIssues(quality, security, review) {
    // セキュリティ問題
    if (security.vulnerabilities) {
      security.vulnerabilities.forEach(vuln => {
        const issue = {
          type: 'security',
          severity: vuln.severity,
          message: vuln.message,
          file: vuln.file,
          line: vuln.line,
          suggestion: vuln.suggestion
        };
        
        review.securityIssues.push(issue);
        
        if (vuln.severity === 'critical' || vuln.severity === 'high') {
          review.mustFix.push(issue);
        }
      });
    }
    
    // 品質問題
    const allQualityIssues = [
      ...(quality.complexity || []),
      ...(quality.duplication || []),
      ...(quality.style || []),
      ...(quality.bestPractices || [])
    ];
    
    allQualityIssues.forEach(issue => {
      review.issues.push({
        type: issue.type,
        severity: issue.severity,
        message: issue.message,
        file: issue.file,
        line: issue.line,
        suggestion: issue.suggestion
      });
      
      if (issue.severity === 'error') {
        review.mustFix.push(issue);
      } else if (issue.severity === 'warning') {
        review.suggestions.push({
          type: issue.type,
          message: issue.message,
          suggestion: issue.suggestion
        });
      }
    });
  }
  
  /**
   * インラインコメントを生成
   */
  generateInlineComments(quality, security, review) {
    // セキュリティ問題のコメント
    security.vulnerabilities?.forEach(vuln => {
      if (vuln.line !== undefined) {
        const comment = this.formatSecurityComment(vuln);
        review.comments.push({
          path: vuln.file,
          line: vuln.line,
          body: comment
        });
      }
    });
    
    // 品質問題のコメント（重要なもののみ）
    const importantQualityIssues = [
      ...(quality.complexity || []),
      ...(quality.bestPractices || [])
    ].filter(issue => issue.severity === 'error' || issue.severity === 'warning');
    
    importantQualityIssues.forEach(issue => {
      if (issue.line !== undefined) {
        const comment = this.formatQualityComment(issue);
        review.comments.push({
          path: issue.file,
          line: issue.line,
          body: comment
        });
      }
    });
  }
  
  /**
   * セキュリティコメントのフォーマット
   */
  formatSecurityComment(vuln) {
    const severityEmoji = {
      critical: '🚨',
      high: '⚠️',
      medium: '⚡',
      low: '💡'
    };
    
    const emoji = severityEmoji[vuln.severity] || '📝';
    
    let comment = `${emoji} **セキュリティ: ${vuln.message}**\n\n`;
    
    if (vuln.code) {
      comment += `\`\`\`javascript\n${vuln.code}\n\`\`\`\n\n`;
    }
    
    if (vuln.suggestion) {
      comment += `**推奨事項:** ${vuln.suggestion}\n`;
    }
    
    if (vuln.detectedValue) {
      comment += `\n検出された値: \`${vuln.detectedValue}\``;
    }
    
    return comment;
  }
  
  /**
   * 品質コメントのフォーマット
   */
  formatQualityComment(issue) {
    const typeEmoji = {
      complexity: '🔄',
      duplication: '📋',
      style: '🎨',
      best_practice: '✨'
    };
    
    const severityLabel = {
      error: 'エラー',
      warning: '警告',
      info: '情報'
    };
    
    const emoji = typeEmoji[issue.type] || '📝';
    const label = severityLabel[issue.severity] || issue.severity;
    
    let comment = `${emoji} **${label}: ${issue.message}**\n\n`;
    
    if (issue.suggestion) {
      comment += `💡 ${issue.suggestion}`;
    }
    
    return comment;
  }
  
  /**
   * レビューサマリーを生成
   */
  async generateReviewSummary(pr, analysis, review) {
    // パイちゃん経由で自然なレビューコメントを生成
    try {
      const prompt = this.buildReviewPrompt(pr, analysis, review);
      
      // パイちゃんへのリクエスト作成
      const requestId = uuidv4();
      const request = {
        requestId,
        fromAgent: 'ccra',
        type: 'code-review',
        prompt: prompt,
        context: {
          workingDirectory: process.cwd(),
          timeout: 300000, // 5分
          priority: 'normal'
        },
        timestamp: new Date().toISOString()
      };
      
      this.logger.info(`[CCRA] Sending review request to CCSP: ${requestId}`);
      
      // リクエスト送信
      await this.redis.lpush('ccsp:requests', JSON.stringify(request));
      
      // レスポンス待機
      const timeout = Date.now() + 300000;
      let response = null;
      
      while (Date.now() < timeout) {
        const data = await this.redis.rpop(this.responseQueue);
        
        if (data) {
          const parsed = JSON.parse(data);
          
          if (parsed.requestId === requestId) {
            if (parsed.success) {
              this.logger.info('[CCRA] Received review from CCSP');
              response = parsed.result;
              break;
            } else {
              throw new Error(`CCSP error: ${parsed.error}`);
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
      
      review.body = response;
      
    } catch (error) {
      this.logger.error(`レビュー生成エラー: ${error.message}`);
      // フォールバック: テンプレートベースのレビュー
      review.body = this.generateTemplateReview(pr, analysis, review);
    }
    
    // サマリーの生成
    review.summary = this.generateSummary(review);
  }
  
  /**
   * Claudeプロンプトの構築
   */
  buildReviewPrompt(pr, analysis, review) {
    return `【重要】Claude APIの使用は禁止されています。レビューコメントやコード提案を行う際は、Claude APIを呼び出すコードを含めないでください。

以下のPRレビュー結果を基に、建設的で親切なレビューコメントを日本語で生成してください。

PR情報:
- タイトル: ${pr.pr.title}
- 説明: ${pr.pr.description || 'なし'}
- 変更ファイル数: ${analysis.stats.files}
- 追加行数: ${analysis.stats.additions}
- 削除行数: ${analysis.stats.deletions}

問題サマリー:
- セキュリティ問題: ${review.securityIssues.length}個（重大: ${review.securityIssues.filter(i => i.severity === 'critical').length}個）
- 品質問題: ${review.issues.length}個
- 必須修正: ${review.mustFix.length}個

主な問題:
${review.mustFix.slice(0, 3).map(issue => `- ${issue.message}`).join('\n')}

以下の点を含めてレビューを作成してください：
1. 全体的な評価（良い点も含める）
2. 必須修正項目の説明
3. 改善提案
4. 次のステップ

トーンは親切で建設的にしてください。`;
  }
  
  /**
   * テンプレートベースのレビュー生成
   */
  generateTemplateReview(pr, analysis, review) {
    let body = `## 🔍 コードレビュー結果\n\n`;
    
    // 概要
    body += `PR #${pr.pr.number} のレビューを完了しました。\n\n`;
    
    // 統計情報
    body += `### 📊 変更の概要\n`;
    body += `- 変更ファイル数: ${analysis.stats.files}\n`;
    body += `- 追加行数: ${analysis.stats.additions}\n`;
    body += `- 削除行数: ${analysis.stats.deletions}\n`;
    body += `- 主な言語: ${analysis.stats.languages.slice(0, 3).map(l => l.language).join(', ')}\n\n`;
    
    // セキュリティ
    if (review.securityIssues.length > 0) {
      body += `### 🔐 セキュリティ\n`;
      const criticalCount = review.securityIssues.filter(i => i.severity === 'critical').length;
      const highCount = review.securityIssues.filter(i => i.severity === 'high').length;
      
      if (criticalCount > 0) {
        body += `⚠️ **${criticalCount}個の重大なセキュリティ問題が検出されました**\n`;
      }
      if (highCount > 0) {
        body += `⚠️ ${highCount}個の高リスクセキュリティ問題があります\n`;
      }
      
      // 主な問題を列挙
      review.securityIssues.slice(0, 3).forEach(issue => {
        body += `- ${issue.message}\n`;
      });
      body += '\n';
    } else {
      body += `### 🔐 セキュリティ\n`;
      body += `✅ セキュリティ問題は検出されませんでした\n\n`;
    }
    
    // コード品質
    body += `### 📝 コード品質\n`;
    if (review.issues.length > 0) {
      const errorCount = review.issues.filter(i => i.severity === 'error').length;
      const warningCount = review.issues.filter(i => i.severity === 'warning').length;
      
      if (errorCount > 0) {
        body += `- エラー: ${errorCount}個\n`;
      }
      if (warningCount > 0) {
        body += `- 警告: ${warningCount}個\n`;
      }
      
      // 品質スコア
      const qualityScore = quality.overall?.score || 100;
      body += `- 品質スコア: ${qualityScore}/100\n`;
    } else {
      body += `✅ 品質問題は検出されませんでした\n`;
    }
    body += '\n';
    
    // 必須修正項目
    if (review.mustFix.length > 0) {
      body += `### ❗ 必須修正項目\n`;
      review.mustFix.forEach((issue, index) => {
        body += `${index + 1}. **${issue.message}**\n`;
        if (issue.suggestion) {
          body += `   - ${issue.suggestion}\n`;
        }
      });
      body += '\n';
    }
    
    // 改善提案
    if (review.suggestions.length > 0) {
      body += `### 💡 改善提案\n`;
      review.suggestions.slice(0, 5).forEach(suggestion => {
        body += `- ${suggestion.message}\n`;
      });
      body += '\n';
    }
    
    // 良い点
    body += `### 👍 良い点\n`;
    if (analysis.insights) {
      const positiveInsights = analysis.insights.filter(i => i.severity === 'info');
      if (positiveInsights.length > 0) {
        positiveInsights.forEach(insight => {
          body += `- ${insight.message}\n`;
        });
      } else {
        body += `- コードは読みやすく整理されています\n`;
      }
    }
    body += '\n';
    
    // 次のステップ
    body += `### 📋 次のステップ\n`;
    if (review.mustFix.length > 0) {
      body += `1. 上記の必須修正項目を対応してください\n`;
      body += `2. 修正後、再レビューを依頼してください\n`;
    } else if (review.suggestions.length > 0) {
      body += `1. 改善提案を検討してください\n`;
      body += `2. 必要に応じて修正を行ってください\n`;
    } else {
      body += `このPRは問題なくマージ可能です！🎉\n`;
    }
    
    // フッター
    body += `\n---\n`;
    body += `*このレビューは CCRA (Code Change Review Agent) により自動生成されました*`;
    
    return body;
  }
  
  /**
   * サマリーを生成
   */
  generateSummary(review) {
    if (review.mustFix.length > 0) {
      return `${review.mustFix.length}個の必須修正項目があります`;
    } else if (review.suggestions.length > 0) {
      return `${review.suggestions.length}個の改善提案があります`;
    } else {
      return 'コードレビューを完了しました。問題は検出されませんでした';
    }
  }
  
  /**
   * レビューステータスを決定
   */
  determineReviewStatus(review) {
    if (review.securityIssues.some(i => i.severity === 'critical')) {
      review.status = 'failure';
      review.statusDescription = '重大なセキュリティ問題が検出されました';
    } else if (review.mustFix.length > 0) {
      review.status = 'failure';
      review.statusDescription = `${review.mustFix.length}個の必須修正項目があります`;
    } else if (review.suggestions.length > 5) {
      review.status = 'pending';
      review.statusDescription = '改善提案を確認してください';
    } else {
      review.status = 'success';
      review.statusDescription = 'レビュー完了 - 問題なし';
    }
  }
  
  /**
   * クリーンアップ処理
   */
  async cleanup() {
    if (this.redis) {
      await this.redis.quit();
    }
  }
}

module.exports = ReviewGenerator;