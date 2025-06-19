const AgentBase = require('../shared/agent-base');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const AutoRepairEngine = require('./repairer');
const AdvancedAnalyzer = require('./advanced-analyzer');
const ErrorGrouper = require('./error-grouper');
const ErrorStatistics = require('./statistics');
const LogArchiver = require('./log-archiver');

/**
 * CCLA (Code Change Log Analyzer) エージェント
 * エラーログを収集・分析し、GitHub Issueとして登録する
 */
class CCLAAgent extends AgentBase {
  constructor(config = {}) {
    super('CCLA', config);
    
    // エラーログ収集の設定
    this.errorLogConfig = {
      pollingInterval: config.errorLogCollection?.pollingInterval || 300000, // 5分
      logSources: config.errorLogCollection?.logSources || ['poppo-*.log'],
      errorLevels: config.errorLogCollection?.errorLevels || ['ERROR', 'FATAL'],
      labels: config.errorLogCollection?.labels || {
        bug: 'task:bug',
        defect: 'task:defect',
        specIssue: 'task:spec-issue'
      }
    };
    
    // ログディレクトリ
    this.logsDir = path.join(__dirname, '../../logs');
    this.processedDir = path.join(this.logsDir, 'processed');
    
    // 処理済みエラー記録ファイル
    this.processedErrorsFile = path.join(__dirname, '../../.poppo/processed-errors.json');
    this.processedErrors = new Map();
    
    // エラーパターン定義（設計書に基づく詳細版）
    this.errorPatterns = [
      {
        id: 'EP001',
        name: 'Type Error - Property Access',
        pattern: /TypeError.*cannot read property/i,
        type: 'bug',
        severity: 'high',
        category: 'Type Error',
        suggestedAction: 'プロパティアクセス前のnullチェックを追加'
      },
      {
        id: 'EP002',
        name: 'Reference Error - Undefined Variable',
        pattern: /ReferenceError.*is not defined/i,
        type: 'bug',
        severity: 'high',
        category: 'Reference Error',
        suggestedAction: '変数の定義を確認、またはimport文の追加'
      },
      {
        id: 'EP003',
        name: 'Syntax Error',
        pattern: /SyntaxError/i,
        type: 'bug',
        severity: 'critical',
        category: 'Syntax Error',
        suggestedAction: '構文エラーの修正が必要'
      },
      {
        id: 'EP004',
        name: 'File Not Found',
        pattern: /ENOENT.*no such file or directory/i,
        type: 'defect',
        severity: 'medium',
        category: 'File Not Found',
        suggestedAction: 'ファイルパスの確認、またはファイルの作成'
      },
      {
        id: 'EP005',
        name: 'API Rate Limit',
        pattern: /GitHub API.*rate limit|API rate limit exceeded/i,
        type: 'defect',
        severity: 'low',
        category: 'Rate Limit',
        suggestedAction: 'レート制限の待機、またはAPI呼び出しの最適化'
      },
      {
        id: 'EP006',
        name: 'Timeout Error',
        pattern: /timeout|ETIMEDOUT|ESOCKETTIMEDOUT/i,
        type: 'defect',
        severity: 'medium',
        category: 'Timeout',
        suggestedAction: 'タイムアウト値の増加、またはネットワーク状態の確認'
      },
      {
        id: 'EP007',
        name: 'Specification Conflict',
        pattern: /spec.*conflict|specification.*mismatch|requirement.*conflict/i,
        type: 'specIssue',
        severity: 'medium',
        category: 'Specification Issue',
        suggestedAction: '仕様の確認と修正が必要'
      },
      {
        id: 'EP008',
        name: 'Memory Error',
        pattern: /ENOMEM|out of memory|JavaScript heap out of memory/i,
        type: 'defect',
        severity: 'critical',
        category: 'Memory Error',
        suggestedAction: 'メモリリークの調査、またはメモリ制限の増加'
      },
      {
        id: 'EP009',
        name: 'Permission Denied',
        pattern: /EACCES|Permission denied|access denied/i,
        type: 'defect',
        severity: 'high',
        category: 'Permission Error',
        suggestedAction: 'ファイル/ディレクトリの権限設定を確認'
      },
      {
        id: 'EP010',
        name: 'JSON Parse Error',
        pattern: /JSON.*parse.*error|Unexpected.*JSON|Invalid JSON/i,
        type: 'bug',
        severity: 'medium',
        category: 'Parse Error',
        suggestedAction: 'JSONフォーマットの検証とエラーハンドリングの追加'
      }
    ];
    
    // ログ監視タイマー
    this.logMonitorTimer = null;
    
    // 自動修復エンジン（Phase 3）
    this.autoRepairEngine = null;
    if (config.errorLogCollection?.autoRepair?.enabled) {
      this.autoRepairEngine = new AutoRepairEngine(this.logger, config.errorLogCollection.autoRepair);
    }
    
    // Phase 2: 高度な分析機能
    this.advancedAnalyzer = null;
    this.errorGrouper = null;
    this.errorStatistics = null;
    
    if (config.errorLogCollection?.advanced?.claudeAnalysis) {
      this.advancedAnalyzer = new AdvancedAnalyzer(this.logger);
    }
    
    if (config.errorLogCollection?.advanced?.groupSimilarErrors) {
      this.errorGrouper = new ErrorGrouper(this.logger);
    }
    
    if (config.errorLogCollection?.advanced?.statisticsEnabled) {
      this.errorStatistics = new ErrorStatistics(this.logger);
    }
    
    // ログアーカイバーの初期化
    if (config.errorLogCollection?.archiving?.enabled !== false) {
      this.logArchiver = new LogArchiver(config, this.logger);
      this.archiveRotationInterval = config.errorLogCollection?.archiving?.rotationInterval || 86400000; // 24時間
    }
  }
  
  /**
   * エージェントの初期化処理
   */
  async onInitialize() {
    // 処理済みディレクトリの作成
    await fs.mkdir(this.processedDir, { recursive: true });
    
    // 処理済みエラーの読み込み
    await this.loadProcessedErrors();
    
    // 自動修復エンジンの初期化
    if (this.autoRepairEngine) {
      // ロールバックマネージャーの初期化
      await this.autoRepairEngine.rollbackManager.initialize();
      this.logger.info('自動修復エンジンを有効化しました');
    }
    
    // Phase 2: 高度な分析機能の初期化
    if (this.advancedAnalyzer) {
      await this.advancedAnalyzer.initialize();
      this.logger.info('高度な分析機能を有効化しました');
    }
    
    if (this.errorGrouper) {
      await this.errorGrouper.initialize();
      this.logger.info('エラーグループ化機能を有効化しました');
    }
    
    if (this.errorStatistics) {
      await this.errorStatistics.initialize();
      this.logger.info('統計分析機能を有効化しました');
    }
    
    // ログアーカイバーの初期化
    if (this.logArchiver) {
      await this.logArchiver.initialize();
      this.logger.info('ログアーカイブ機能を有効化しました');
      
      // アーカイブローテーションの開始
      this.startArchiveRotation();
    }
    
    // ログ監視の開始
    this.startLogMonitoring();
    
    this.logger.info('CCLAエージェントの初期化完了');
  }
  
  /**
   * 処理済みエラー記録の読み込み
   */
  async loadProcessedErrors() {
    try {
      const data = await fs.readFile(this.processedErrorsFile, 'utf8');
      const processed = JSON.parse(data);
      this.processedErrors = new Map(Object.entries(processed));
      this.logger.info(`${this.processedErrors.size}件の処理済みエラーを読み込みました`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.logger.error(`処理済みエラーの読み込みエラー: ${error.message}`);
      }
    }
  }
  
  /**
   * 処理済みエラー記録の保存
   */
  async saveProcessedErrors() {
    try {
      const data = Object.fromEntries(this.processedErrors);
      await fs.writeFile(this.processedErrorsFile, JSON.stringify(data, null, 2));
    } catch (error) {
      this.logger.error(`処理済みエラーの保存エラー: ${error.message}`);
    }
  }
  
  /**
   * ログ監視の開始
   */
  startLogMonitoring() {
    // 即座に最初のチェック
    this.checkLogs();
    
    // 定期的なチェック
    this.logMonitorTimer = setInterval(() => {
      this.checkLogs();
    }, this.errorLogConfig.pollingInterval);
  }
  
  /**
   * アーカイブローテーションの開始
   */
  startArchiveRotation() {
    // 即座に最初のローテーション
    this.rotateProcessedLogs();
    
    // 定期的なローテーション
    this.archiveRotationTimer = setInterval(() => {
      this.rotateProcessedLogs();
    }, this.archiveRotationInterval);
  }
  
  /**
   * ログファイルのチェック
   */
  async checkLogs() {
    try {
      this.logger.info('エラーログの監視を開始...');
      
      // ログソースごとに処理
      for (const pattern of this.errorLogConfig.logSources) {
        await this.processLogPattern(pattern);
      }
      
    } catch (error) {
      this.logger.error(`ログチェックエラー: ${error.message}`);
    }
  }
  
  /**
   * ログパターンの処理
   */
  async processLogPattern(pattern) {
    try {
      const files = await fs.readdir(this.logsDir);
      const regex = new RegExp(pattern.replace('*', '.*'));
      const logFiles = files.filter(f => regex.test(f));
      
      for (const file of logFiles) {
        const filePath = path.join(this.logsDir, file);
        await this.processLogFile(filePath);
      }
    } catch (error) {
      this.logger.error(`ログパターン処理エラー: ${error.message}`);
    }
  }
  
  /**
   * ログファイルの処理
   */
  async processLogFile(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const lines = content.split('\n');
      
      const errors = [];
      let currentError = null;
      
      for (const line of lines) {
        // エラーレベルのログをチェック
        const isError = this.errorLogConfig.errorLevels.some(level => 
          line.includes(`[${level}]`)
        );
        
        if (isError) {
          // 新しいエラーの開始
          if (currentError) {
            errors.push(currentError);
          }
          
          currentError = {
            timestamp: this.extractTimestamp(line),
            level: this.extractLevel(line),
            message: line,
            stackTrace: []
          };
        } else if (currentError && line.trim() && line.startsWith('    ')) {
          // スタックトレースの一部
          currentError.stackTrace.push(line);
        }
      }
      
      // 最後のエラーを追加
      if (currentError) {
        errors.push(currentError);
      }
      
      // エラーの分析と処理
      for (const error of errors) {
        await this.analyzeAndProcessError(error);
      }
      
    } catch (error) {
      this.logger.error(`ログファイル処理エラー: ${error.message}`);
    }
  }
  
  /**
   * タイムスタンプの抽出
   */
  extractTimestamp(line) {
    const match = line.match(/\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]/);
    return match ? match[1] : new Date().toISOString();
  }
  
  /**
   * ログレベルの抽出
   */
  extractLevel(line) {
    const match = line.match(/\[(ERROR|FATAL|WARN)\]/);
    return match ? match[1] : 'ERROR';
  }
  
  /**
   * エラーの分析と処理
   */
  async analyzeAndProcessError(error) {
    try {
      // エラーのハッシュを生成
      const errorHash = this.generateErrorHash(error);
      
      // 既に処理済みかチェック
      if (this.processedErrors.has(errorHash)) {
        return;
      }
      
      // エラーパターンの分析
      const analysis = this.analyzeErrorPattern(error);
      
      // エラー情報の拡張
      const errorInfo = {
        ...error,
        hash: errorHash,
        category: analysis.category,
        severity: analysis.severity,
        type: analysis.type,
        file: this.extractFileFromError(error),
        line: this.extractLineFromError(error)
      };
      
      // Phase 2: エラーグループ化
      let groupInfo = null;
      if (this.errorGrouper) {
        groupInfo = await this.errorGrouper.groupError(errorInfo);
        this.logger.info(`エラーグループ: ${groupInfo.groupId} (新規: ${groupInfo.isNew})`);
        
        // 既存グループの場合は、Issue作成をスキップ
        if (!groupInfo.isNew && groupInfo.group.issueUrl) {
          this.logger.info(`既存Issue ${groupInfo.group.issueUrl} に関連付け`);
          
          // 統計のみ更新
          if (this.errorStatistics) {
            await this.errorStatistics.addError(errorInfo, groupInfo);
          }
          
          return;
        }
      }
      
      // Phase 2: 高度な分析
      let advancedAnalysis = null;
      if (this.advancedAnalyzer && (!groupInfo || groupInfo.isNew)) {
        const context = {
          projectName: 'PoppoBuilderSuite',
          recentChanges: await this.getRecentChanges(),
          relatedIssues: groupInfo ? [groupInfo.groupId] : []
        };
        
        advancedAnalysis = await this.advancedAnalyzer.analyzeWithClaude(errorInfo, context);
        this.logger.info(`Claude分析完了 (信頼度: ${(advancedAnalysis.confidence * 100).toFixed(0)}%)`);
      }
      
      // Phase 2: 統計更新
      if (this.errorStatistics) {
        await this.errorStatistics.addError(errorInfo, groupInfo);
      }
      
      // Phase 3: 自動修復を試みる
      if (this.autoRepairEngine && analysis.matched) {
        this.logger.info(`自動修復を試みます: ${analysis.category} (${errorHash})`);
        
        const repairContext = {
          ...error,
          hash: errorHash,
          analysis,
          file: errorInfo.file,
          line: errorInfo.line,
          stackTrace: error.stackTrace
        };
        
        const repairResult = await this.autoRepairEngine.attemptAutoRepair(repairContext, {
          skipTest: false,
          enableRollback: true
        });
        
        if (repairResult.success) {
          this.logger.info(`自動修復に成功しました: ${repairResult.pattern}`);
          
          // PR作成された場合の情報を含める
          const repairSummary = {
            pattern: repairResult.pattern,
            duration: repairResult.duration,
            successRate: repairResult.successRate,
            prUrl: repairResult.prUrl,
            prCreated: repairResult.prCreated
          };
          
          // 修復成功をIssueとして報告
          await this.sendMessage('core', {
            type: 'CREATE_ISSUE',
            errorInfo: {
              ...error,
              hash: errorHash,
              analysis,
              autoRepaired: true,
              repairDetails: repairResult.result,
              repairSummary,
              prUrl: repairResult.prUrl
            },
            priority: 'low',
            labels: ['task:auto-repaired', this.errorLogConfig.labels[analysis.type] || 'task:bug']
          });
          
          // 処理済みとして記録
          this.processedErrors.set(errorHash, {
            timestamp: new Date().toISOString(),
            issueUrl: null,
            errorInfo: {
              level: error.level,
              category: analysis.category,
              firstOccurrence: error.timestamp,
              occurrenceCount: 1,
              autoRepaired: true,
              prUrl: repairResult.prUrl
            }
          });
          
          await this.saveProcessedErrors();
          return;
        } else {
          this.logger.warn(`自動修復に失敗しました: ${repairResult.reason}`);
        }
      }
      
      // 自動修復できなかった場合は通常のIssue作成
      const issueBody = this.buildIssueBody(errorInfo, analysis, advancedAnalysis, groupInfo);
      
      await this.sendMessage('core', {
        type: 'CREATE_ISSUE',
        errorInfo: {
          ...errorInfo,
          analysis,
          advancedAnalysis,
          groupInfo,
          body: issueBody
        },
        priority: this.getPriorityFromSeverity(analysis.severity),
        labels: [this.errorLogConfig.labels[analysis.type] || 'task:bug']
      });
      
      // 処理済みとして記録（設計書に基づくフォーマット）
      this.processedErrors.set(errorHash, {
        timestamp: new Date().toISOString(),
        issueUrl: null, // 後でコーディネーターから更新される
        errorInfo: {
          level: error.level,
          category: analysis.category,
          firstOccurrence: error.timestamp,
          occurrenceCount: 1
        }
      });
      
      await this.saveProcessedErrors();
      
      this.logger.info(`新しいエラーを検出: ${analysis.category} (${errorHash})`);
      
    } catch (error) {
      this.logger.error(`エラー分析処理エラー: ${error.message}`);
    }
  }
  
  /**
   * エラーハッシュの生成
   */
  generateErrorHash(error) {
    const key = `${error.level}:${error.message}:${error.stackTrace.slice(0, 3).join(':')}`;
    return crypto.createHash('md5').update(key).digest('hex').substring(0, 8);
  }
  
  /**
   * エラーパターンの分析
   */
  analyzeErrorPattern(error) {
    const fullText = error.message + '\n' + error.stackTrace.join('\n');
    
    // パターンマッチング
    for (const pattern of this.errorPatterns) {
      if (pattern.pattern.test(fullText)) {
        return {
          patternId: pattern.id,
          name: pattern.name,
          type: pattern.type,
          severity: pattern.severity,
          category: pattern.category,
          suggestedAction: pattern.suggestedAction,
          matched: true
        };
      }
    }
    
    // マッチしない場合のデフォルト
    return {
      patternId: 'EP000',
      name: 'Unknown Error',
      type: 'bug',
      severity: 'medium',
      category: 'Unknown Error',
      suggestedAction: 'エラーの詳細を調査してください',
      matched: false
    };
  }
  
  /**
   * 重要度から優先度への変換
   */
  getPriorityFromSeverity(severity) {
    const mapping = {
      critical: 'high',
      high: 'high',
      medium: 'medium',
      low: 'low'
    };
    return mapping[severity] || 'medium';
  }
  
  /**
   * タスク処理（エラーログ分析リクエスト）
   */
  async processTask(message) {
    const { taskType, data } = message;
    
    switch (taskType) {
      case 'analyze-error-logs':
        // 即座にログをチェック
        await this.checkLogs();
        return {
          success: true,
          message: 'エラーログの分析を完了しました'
        };
        
      case 'update-issue-reference':
        // 処理済みエラーにIssue番号を記録
        const { errorHash, issueUrl } = data;
        if (this.processedErrors.has(errorHash)) {
          const entry = this.processedErrors.get(errorHash);
          entry.issueUrl = issueUrl;
          await this.saveProcessedErrors();
        }
        return {
          success: true,
          message: `エラー ${errorHash} のIssue参照を更新しました`
        };
        
      case 'get-repair-statistics':
        // 修復統計を取得
        if (this.autoRepairEngine) {
          const stats = this.autoRepairEngine.getStatistics();
          return {
            success: true,
            statistics: stats
          };
        } else {
          return {
            success: false,
            message: '自動修復エンジンが無効です'
          };
        }
        
      case 'export-learning-data':
        // 学習データのエクスポート
        if (this.autoRepairEngine && data.filePath) {
          const exportData = await this.autoRepairEngine.exportLearningData(data.filePath);
          
          // 学習エンジンのデータも含める
          if (this.autoRepairEngine.learningRecognizer) {
            const learningData = await this.autoRepairEngine.learningRecognizer.exportLearningData();
            exportData.learningPatterns = learningData;
          }
          
          return {
            success: true,
            message: `学習データをエクスポートしました: ${data.filePath}`,
            data: exportData
          };
        } else {
          return {
            success: false,
            message: '自動修復エンジンが無効またはファイルパスが指定されていません'
          };
        }
        
      // Phase 2: 新しいAPIエンドポイント
      case 'get-statistics':
        // 統計情報の取得
        if (this.errorStatistics) {
          return {
            success: true,
            statistics: this.errorStatistics.getStatistics()
          };
        } else {
          return {
            success: false,
            message: '統計機能が無効です'
          };
        }
        
      case 'get-analysis':
        // 特定エラーの分析結果取得
        if (this.advancedAnalyzer && data.errorHash) {
          const analysis = await this.advancedAnalyzer.analysisCache.get(data.errorHash);
          return {
            success: true,
            analysis: analysis || null
          };
        } else {
          return {
            success: false,
            message: '高度な分析機能が無効またはエラーハッシュが指定されていません'
          };
        }
        
      case 'analyze-error':
        // エラーを分析（手動トリガー）
        if (this.advancedAnalyzer && data.errorInfo) {
          const analysis = await this.advancedAnalyzer.analyzeWithClaude(data.errorInfo, data.context);
          return {
            success: true,
            analysis
          };
        } else {
          return {
            success: false,
            message: '高度な分析機能が無効またはエラー情報が指定されていません'
          };
        }
        
      default:
        throw new Error(`未対応のタスクタイプ: ${taskType}`);
    }
  }
  
  /**
   * エラーからファイル情報を抽出
   */
  extractFileFromError(error) {
    if (!error.stackTrace || error.stackTrace.length === 0) return null;
    
    const filePattern = /at\s+.*?\s+\(([^:)]+):\d+:\d+\)/;
    for (const line of error.stackTrace) {
      const match = line.match(filePattern);
      if (match && !match[1].includes('node_modules')) {
        return match[1];
      }
    }
    
    return null;
  }
  
  /**
   * エラーから行番号を抽出
   */
  extractLineFromError(error) {
    if (!error.stackTrace || error.stackTrace.length === 0) return null;
    
    const linePattern = /at\s+.*?\s+\([^:)]+:(\d+):\d+\)/;
    for (const line of error.stackTrace) {
      const match = line.match(linePattern);
      if (match) {
        return parseInt(match[1], 10);
      }
    }
    
    return null;
  }
  
  /**
   * 最近の変更を取得（簡易版）
   */
  async getRecentChanges() {
    // TODO: gitログから最近の変更を取得
    return '最近24時間以内の変更情報は現在利用できません';
  }
  
  /**
   * Issue本文の構築（Phase 2対応）
   */
  buildIssueBody(errorInfo, analysis, advancedAnalysis, groupInfo) {
    let body = `## エラー概要
- **カテゴリ**: ${errorInfo.category}
- **タイプ**: ${errorInfo.type}
- **重要度**: ${errorInfo.severity}
- **エラーハッシュ**: ${errorInfo.hash.substring(0, 8)}
- **発生日時**: ${errorInfo.timestamp}
- **ログレベル**: ${errorInfo.level}`;

    if (groupInfo) {
      body += `
- **エラーグループ**: ${groupInfo.groupId}
- **グループ内発生回数**: ${groupInfo.group.occurrenceCount}
- **初回発生**: ${groupInfo.group.createdAt}`;
    }

    body += `

## エラーメッセージ
\`\`\`
${errorInfo.message}
\`\`\`

## スタックトレース
\`\`\`
${errorInfo.stackTrace.join('\n')}
\`\`\``;

    if (advancedAnalysis) {
      body += `

${this.advancedAnalyzer.generateAnalysisSummary(advancedAnalysis)}`;
    } else {
      body += `

## 自動分析結果
このエラーは自動的に検出・分類されました。
- パターンマッチング: ${analysis.matched ? '成功' : '失敗'}
- 推奨アクション: ${analysis.suggestedAction || 'エラーの調査と修正が必要です'}`;
    }

    body += `

## 対処方法
このエラーの調査と修正が必要です。`;

    if (this.errorStatistics) {
      const stats = this.errorStatistics.getStatistics();
      if (stats.currentTrends && stats.currentTrends.length > 0) {
        body += `

## トレンド情報`;
        for (const trend of stats.currentTrends.slice(0, 3)) {
          body += `
- ${trend.message}`;
        }
      }
    }

    body += `

---
*このIssueはCCLAエージェント${advancedAnalysis ? '（高度な分析機能付き）' : ''}によって自動的に作成されました*`;

    return body;
  }
  
  /**
   * ログローテーション
   */
  async rotateProcessedLogs() {
    if (!this.logArchiver) {
      this.logger.debug('ログアーカイブ機能が無効です');
      return;
    }
    
    try {
      this.logger.info('処理済みログのアーカイブを開始します...');
      
      // 処理済みエラー記録ファイルを処理済みディレクトリに移動
      const processedErrors = await this.getProcessedErrorFiles();
      for (const file of processedErrors) {
        const sourcePath = path.join(this.logsDir, file);
        const destPath = path.join(this.logArchiver.processedPath, file);
        
        try {
          await fs.rename(sourcePath, destPath);
          this.logger.debug(`処理済みファイルを移動: ${file}`);
        } catch (error) {
          if (error.code !== 'ENOENT') {
            this.logger.error(`ファイル移動エラー: ${file}`, error);
          }
        }
      }
      
      // アーカイブ処理を実行
      await this.logArchiver.archiveProcessedLogs();
      
      this.logger.info('処理済みログのアーカイブが完了しました');
    } catch (error) {
      this.logger.error('ログローテーションエラー:', error);
    }
  }
  
  /**
   * 処理済みエラーファイルの取得
   */
  async getProcessedErrorFiles() {
    try {
      const files = await fs.readdir(this.logsDir);
      return files.filter(file => 
        file.startsWith('processed-') && 
        (file.endsWith('.json') || file.endsWith('.log'))
      );
    } catch (error) {
      this.logger.error('処理済みファイル取得エラー:', error);
      return [];
    }
  }
  
  /**
   * シャットダウン処理
   */
  async onShutdown() {
    // ログ監視タイマーの停止
    if (this.logMonitorTimer) {
      clearInterval(this.logMonitorTimer);
    }
    
    // アーカイブローテーションタイマーの停止
    if (this.archiveRotationTimer) {
      clearInterval(this.archiveRotationTimer);
    }
    
    // 最後のアーカイブ処理を実行
    if (this.logArchiver) {
      try {
        await this.rotateProcessedLogs();
      } catch (error) {
        this.logger.error('最終アーカイブ処理エラー:', error);
      }
    }
    
    // 処理済みエラーの最終保存
    await this.saveProcessedErrors();
    
    // 自動修復エンジンの学習データを保存
    if (this.autoRepairEngine) {
      try {
        const learningDataPath = path.join(this.logsDir, 'repair-learning-data.json');
        const exportData = await this.autoRepairEngine.exportLearningData(learningDataPath);
        
        // 学習エンジンのデータも保存
        if (this.autoRepairEngine.learningRecognizer) {
          const learningPatternsPath = path.join(this.logsDir, 'learning-patterns.json');
          await this.autoRepairEngine.learningRecognizer.saveLearningData(learningPatternsPath);
          this.logger.info(`学習パターンを保存しました: ${learningPatternsPath}`);
        }
        
        this.logger.info(`学習データを保存しました: ${learningDataPath}`);
      } catch (error) {
        this.logger.error(`学習データの保存エラー: ${error.message}`);
      }
    }
    
    this.logger.info('CCLAエージェントのシャットダウン完了');
  }
}

// メイン実行（エージェントとして起動される場合）
if (require.main === module) {
  const config = require('../../config/config.json');
  const agent = new CCLAAgent(config);
  
  agent.initialize().catch(error => {
    console.error('CCLAエージェントの起動に失敗:', error);
    process.exit(1);
  });
  
  // シグナルハンドリング
  process.on('SIGINT', async () => {
    await agent.shutdown();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    await agent.shutdown();
    process.exit(0);
  });
}

module.exports = CCLAAgent;