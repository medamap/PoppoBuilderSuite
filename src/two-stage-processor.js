const InstructionAnalyzer = require('./instruction-analyzer');
const GitHubClient = require('./github-client');

/**
 * 2段階処理システム
 * 第1段階: 指示内容を分析してアクションを決定
 * 第2段階: 決定されたアクションを実行
 */
class TwoStageProcessor {
  constructor(config, redisConfig, customLogger = null) {
    this.config = config.twoStageProcessing || {};
    
    // Redis設定（claudeClientの代わり）
    this.redisConfig = redisConfig || {
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379
    };
    
    // loggerの初期化
    if (customLogger) {
      this.logger = customLogger;
    } else {
      try {
        // loggerモジュールは同じディレクトリにある
        const Logger = require('./logger');
        this.logger = new Logger();
      } catch (e) {
        // テスト環境などでloggerが存在しない場合のダミー実装
        this.logger = {
          info: () => {},
          error: () => {},
          warn: () => {},
          debug: () => {}
        };
      }
    }
    
    // InstructionAnalyzerにRedis設定を渡す
    this.analyzer = new InstructionAnalyzer(this.redisConfig, this.logger);
    this.githubClient = null;
    this.enabled = this.config.enabled !== false;
    this.confidenceThreshold = this.config.confidenceThreshold || 0.7;
    this.analyzeTimeout = this.config.analyzeTimeout || 30000;
  }

  /**
   * 初期化
   */
  async init() {
    if (!this.enabled) {
      this.logger.info('Two-stage processing is disabled');
      return;
    }

    try {
      await this.analyzer.init();
      
      // GitHub クライアントの初期化
      if (this.config.githubToken || process.env.GITHUB_TOKEN) {
        this.githubClient = new GitHubClient(
          this.config.githubToken || process.env.GITHUB_TOKEN,
          this.config.githubOwner || process.env.GITHUB_OWNER,
          this.config.githubRepo || process.env.GITHUB_REPO
        );
      }
      
      this.logger.info('Two-stage processor initialized');
    } catch (error) {
      this.logger.error('Failed to initialize two-stage processor:', error);
      throw error;
    }
  }

  /**
   * 指示を処理
   * @param {string} instruction - 処理する指示内容
   * @param {Object} context - 処理コンテキスト
   * @returns {Object} 処理結果
   */
  async processInstruction(instruction, context = {}) {
    if (!this.enabled) {
      // 2段階処理が無効の場合は、デフォルトの処理を返す
      return {
        action: 'execute_code',
        executed: false,
        reason: 'Two-stage processing disabled'
      };
    }

    try {
      this.logger.info('Starting two-stage processing...');
      
      // 第1段階: 分析
      const analysisResult = await this.analyzeWithTimeout(instruction, context);
      
      // 分析結果をログ
      this.logger.info('Stage 1 - Analysis complete:', {
        action: analysisResult.action,
        confidence: analysisResult.confidence,
        reasoning: analysisResult.reasoning
      });
      
      // 信頼度チェック
      if (analysisResult.confidence < this.confidenceThreshold) {
        this.logger.warn('Confidence below threshold, defaulting to execute_code', {
          confidence: analysisResult.confidence,
          threshold: this.confidenceThreshold
        });
        return {
          action: 'execute_code',
          executed: false,
          reason: `Low confidence: ${analysisResult.confidence}`,
          analysisResult
        };
      }
      
      // 第2段階: 実行
      const executionResult = await this.executeAction(analysisResult, context);
      
      this.logger.info('Stage 2 - Execution complete:', {
        action: analysisResult.action,
        success: executionResult.success
      });
      
      return {
        action: analysisResult.action,
        executed: true,
        analysisResult,
        executionResult
      };
      
    } catch (error) {
      this.logger.error('Two-stage processing failed:', error);
      // エラーの場合はデフォルトの処理を返す
      return {
        action: 'execute_code',
        executed: false,
        error: error.message
      };
    }
  }

  /**
   * タイムアウト付きで分析を実行
   * @param {string} instruction - 分析する指示内容
   * @param {Object} context - コンテキスト
   * @returns {Object} 分析結果
   */
  async analyzeWithTimeout(instruction, context) {
    return new Promise(async (resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.logger.warn('Analysis timed out, using default action');
        resolve({
          action: 'execute_code',
          confidence: 0.5,
          reasoning: 'Analysis timed out',
          data: {
            instruction: instruction,
            context: context
          }
        });
      }, this.analyzeTimeout);

      try {
        const result = await this.analyzer.analyze(instruction, context);
        clearTimeout(timeoutId);
        resolve(result);
      } catch (error) {
        clearTimeout(timeoutId);
        reject(error);
      }
    });
  }

  /**
   * アクションを実行
   * @param {Object} analysisResult - 分析結果
   * @param {Object} context - 実行コンテキスト
   * @returns {Object} 実行結果
   */
  async executeAction(analysisResult, context) {
    switch (analysisResult.action) {
      case 'create_issue':
        return await this.createIssue(analysisResult.data, context);
      
      case 'execute_code':
        return {
          success: true,
          action: 'execute_code',
          instruction: analysisResult.data.instruction
        };
      
      case 'unknown':
      default:
        return {
          success: true,
          action: 'unknown',
          instruction: analysisResult.data.instruction || context.instruction
        };
    }
  }

  /**
   * GitHubにIssueを作成
   * @param {Object} issueData - Issue作成データ
   * @param {Object} context - コンテキスト
   * @returns {Object} 作成結果
   */
  async createIssue(issueData, context) {
    if (!this.githubClient) {
      this.logger.error('GitHub client not initialized');
      return {
        success: false,
        error: 'GitHub client not initialized'
      };
    }

    try {
      // デフォルトラベルを適用
      const labels = this.analyzer.applyDefaultLabels(
        issueData.labels || [], 
        issueData.title + ' ' + issueData.body
      );
      
      // Issueを作成
      const issue = await this.githubClient.createIssue({
        title: issueData.title,
        body: issueData.body,
        labels: labels
      });
      
      this.logger.info('Issue created successfully:', {
        number: issue.number,
        title: issue.title,
        labels: labels
      });
      
      // 元のIssueにコメントを投稿（コンテキストにIssue番号がある場合）
      if (context.issueNumber) {
        try {
          await this.githubClient.createComment(
            context.issueNumber,
            `✅ 新しいIssueを作成しました: #${issue.number}\n\n` +
            `**タイトル**: ${issue.title}\n` +
            `**ラベル**: ${labels.join(', ')}\n\n` +
            `詳細は #${issue.number} をご確認ください。`
          );
        } catch (error) {
          this.logger.error('Failed to post comment on original issue:', error);
        }
      }
      
      return {
        success: true,
        action: 'create_issue',
        issue: {
          number: issue.number,
          title: issue.title,
          url: issue.html_url,
          labels: labels
        }
      };
      
    } catch (error) {
      this.logger.error('Failed to create issue:', error);
      return {
        success: false,
        action: 'create_issue',
        error: error.message
      };
    }
  }

  /**
   * 処理が必要かどうかを判定
   * @param {string} instruction - 指示内容
   * @returns {boolean} 2段階処理が必要な場合true
   */
  shouldProcess(instruction) {
    if (!this.enabled) {
      return false;
    }

    // Issue作成の可能性がある指示をチェック
    const keywords = [
      'issue', 'イシュー', '作成', 'create', '登録', 'タスク', 'task',
      'バグ', 'bug', '機能', 'feature', 'ドキュメント', 'document',
      'dogfooding', '改善', 'improvement'
    ];
    
    const instructionLower = instruction.toLowerCase();
    return keywords.some(keyword => instructionLower.includes(keyword));
  }
  
  /**
   * クリーンアップ処理
   */
  async cleanup() {
    if (this.analyzer && this.analyzer.cleanup) {
      await this.analyzer.cleanup();
    }
  }
}

module.exports = TwoStageProcessor;