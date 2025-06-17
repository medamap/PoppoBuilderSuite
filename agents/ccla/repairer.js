/**
 * 自動修復エンジン
 * エラーパターンと修復方法のマッチング、修復案の生成と適用を行う
 */

const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const { repairPatterns, repairStats } = require('./patterns');
const RollbackManager = require('./rollback');
const TestGenerator = require('./test-generator');
const LearningErrorRecognizer = require('./learning-recognizer');
const AutoPRCreator = require('./pr-creator');
const { getRepairStrategy } = require('./repair-strategies');

class AutoRepairEngine {
  constructor(logger = console, config = {}) {
    this.logger = logger;
    this.repairPatterns = repairPatterns;
    this.repairStats = repairStats;
    this.rollbackManager = new RollbackManager(logger);
    this.testGenerator = new TestGenerator(logger);
    this.learningRecognizer = new LearningErrorRecognizer(logger);
    this.prCreator = new AutoPRCreator(logger);
    
    // 修復の設定
    this.config = {
      maxRetries: config.maxRetries || 3,
      testTimeout: config.testTimeout || 60000, // 60秒
      enableTestGeneration: config.enableTestGeneration !== false,
      enableRollback: config.enableRollback !== false,
      dryRun: config.dryRun || false, // trueの場合、実際の修復は行わない
      autoCreatePR: config.autoCreatePR || false,
      requireValidation: config.requireValidation !== false,
      learningEnabled: config.learningEnabled || false,
      confidenceThreshold: config.confidenceThreshold || 0.8
    };
    
    // 修復履歴
    this.repairHistory = [];
    
    // 修復戦略を登録
    this.repairStrategies = {};
    this.loadRepairStrategies();
  }
  
  /**
   * エラーに対する自動修復を試みる
   */
  async attemptAutoRepair(errorInfo, options = {}) {
    const startTime = Date.now();
    const repairOptions = { ...this.config, ...options };
    
    this.logger.info(`自動修復を開始: ${errorInfo.analysis.category} (${errorInfo.hash})`);
    
    // 学習エンジンにエラーを記録
    if (this.config.learningEnabled && this.learningRecognizer) {
      await this.learningRecognizer.recordError(errorInfo);
    }
    
    // 修復可能かチェック
    const repairability = this.checkRepairability(errorInfo);
    if (!repairability.canRepair) {
      this.logger.warn(`自動修復不可: ${repairability.reason}`);
      return {
        success: false,
        reason: repairability.reason,
        duration: Date.now() - startTime
      };
    }
    
    // 修復パターンを取得
    const pattern = this.repairPatterns[errorInfo.analysis.patternId];
    const strategy = this.repairStrategies[errorInfo.analysis.patternId];
    
    if (!pattern && !strategy) {
      return {
        success: false,
        reason: `修復パターンが見つかりません: ${errorInfo.analysis.patternId}`,
        duration: Date.now() - startTime
      };
    }
    
    // 修復試行を記録
    const patternId = errorInfo.analysis.patternId;
    this.repairStats.recordAttempt(patternId);
    
    try {
      // ドライランモード
      if (repairOptions.dryRun) {
        this.logger.info('ドライランモード: 実際の修復は行いません');
        return {
          success: true,
          dryRun: true,
          pattern: pattern.name,
          description: pattern.description,
          duration: Date.now() - startTime
        };
      }
      
      // 修復を実行
      let repairResult;
      
      // 新しい戦略システムを優先
      if (strategy) {
        repairResult = await strategy.repair(errorInfo, {
          logger: this.logger,
          testGenerator: this.testGenerator,
          rollbackManager: this.rollbackManager
        });
      } else if (pattern) {
        // 旧パターンシステムのフォールバック
        repairResult = await pattern.repair(errorInfo, {
          logger: this.logger,
          testGenerator: this.testGenerator
        });
      }
      
      if (!repairResult.success) {
        throw new Error(repairResult.error || '修復に失敗しました');
      }
      
      // 修復後のテスト
      if (pattern.testRequired && !repairOptions.skipTest) {
        const testResult = await this.runPostRepairTests(repairResult, errorInfo);
        
        if (!testResult.success) {
          // テスト失敗時のロールバック
          if (repairOptions.enableRollback && pattern.rollbackSupported) {
            await this.rollbackManager.rollback(repairResult);
          }
          
          this.repairStats.recordFailure(pattern.id);
          
          return {
            success: false,
            reason: 'テストが失敗しました',
            testOutput: testResult.output,
            rollbackPerformed: repairOptions.enableRollback,
            duration: Date.now() - startTime
          };
        }
      }
      
      // テストケースの自動生成
      if (repairOptions.enableTestGeneration && pattern.testRequired) {
        try {
          const testFile = await this.testGenerator.generateTest(errorInfo, repairResult);
          repairResult.generatedTest = testFile;
        } catch (error) {
          this.logger.warn(`テスト生成エラー: ${error.message}`);
        }
      }
      
      // 修復成功を記録
      this.repairStats.recordSuccess(patternId);
      this.recordRepairHistory(errorInfo, repairResult, true);
      
      // 学習エンジンに成功を記録
      if (this.config.learningEnabled && this.learningRecognizer) {
        await this.learningRecognizer.recordRepairResult(errorInfo.hash, patternId, true);
      }
      
      // 自動PR作成
      let prResult = null;
      if (this.config.autoCreatePR && this.prCreator) {
        const canCreate = await this.prCreator.canCreatePR();
        if (canCreate.canCreate) {
          this.logger.info('自動PR作成を開始します...');
          
          const prInfo = {
            ...errorInfo,
            repairDetails: repairResult,
            testResults: {
              validation: { valid: true },
              testsGenerated: repairResult.generatedTest ? 1 : 0,
              rollbackAvailable: this.config.enableRollback
            },
            testFiles: repairResult.generatedTest ? [repairResult.generatedTest] : []
          };
          
          prResult = await this.prCreator.createPRFromRepair(prInfo);
          
          if (prResult.success) {
            this.logger.info(`PR作成成功: ${prResult.prUrl}`);
          } else {
            this.logger.warn(`PR作成失敗: ${prResult.error}`);
          }
        } else {
          this.logger.warn(`PR作成不可: ${canCreate.reason}`);
        }
      }
      
      return {
        success: true,
        pattern: pattern?.name || errorInfo.analysis.category,
        result: repairResult,
        successRate: this.repairStats.getSuccessRate(patternId),
        duration: Date.now() - startTime,
        prCreated: prResult?.success || false,
        prUrl: prResult?.prUrl
      };
      
    } catch (error) {
      this.logger.error(`修復エラー: ${error.message}`);
      this.repairStats.recordFailure(patternId);
      this.recordRepairHistory(errorInfo, { error: error.message }, false);
      
      // 学習エンジンに失敗を記録
      if (this.config.learningEnabled && this.learningRecognizer) {
        await this.learningRecognizer.recordRepairResult(errorInfo.hash, patternId, false);
      }
      
      return {
        success: false,
        reason: error.message,
        pattern: pattern?.name || errorInfo.analysis.category,
        duration: Date.now() - startTime
      };
    }
  }
  
  /**
   * 修復可能性をチェック
   */
  checkRepairability(errorInfo) {
    // 基本チェック
    if (!errorInfo.analysis || !errorInfo.analysis.patternId) {
      return {
        canRepair: false,
        reason: 'エラー分析情報が不足しています'
      };
    }
    
    const pattern = this.repairPatterns[errorInfo.analysis.patternId];
    if (!pattern) {
      return {
        canRepair: false,
        reason: '対応する修復パターンがありません'
      };
    }
    
    // パターン固有のチェック
    if (!pattern.canAutoRepair(errorInfo)) {
      return {
        canRepair: false,
        reason: 'このエラーは自動修復の条件を満たしていません'
      };
    }
    
    // 修復成功率のチェック
    const successRate = this.repairStats.getSuccessRate(pattern.id);
    const attempts = this.repairStats.attempts[pattern.id] || 0;
    
    if (attempts > 10 && successRate < 0.3) {
      return {
        canRepair: false,
        reason: `修復成功率が低すぎます (${(successRate * 100).toFixed(1)}%)`
      };
    }
    
    return {
      canRepair: true,
      pattern: pattern.name,
      successRate
    };
  }
  
  /**
   * 修復後のテストを実行
   */
  async runPostRepairTests(repairResult, errorInfo) {
    this.logger.info('修復後のテストを実行中...');
    
    try {
      // プロジェクトのテストコマンドを検出
      const testCommand = await this.detectTestCommand();
      
      if (!testCommand) {
        this.logger.warn('テストコマンドが見つかりません');
        
        // 基本的な構文チェックのみ実行
        return await this.runBasicValidation(repairResult);
      }
      
      // テストを実行
      const result = await this.executeCommand(testCommand.cmd, testCommand.args, {
        timeout: this.config.testTimeout
      });
      
      return {
        success: result.code === 0,
        output: result.output,
        command: `${testCommand.cmd} ${testCommand.args.join(' ')}`
      };
      
    } catch (error) {
      return {
        success: false,
        output: error.message,
        error: true
      };
    }
  }
  
  /**
   * テストコマンドを検出
   */
  async detectTestCommand() {
    try {
      // package.jsonを確認
      const packageJson = await fs.readFile('package.json', 'utf8');
      const pkg = JSON.parse(packageJson);
      
      if (pkg.scripts) {
        if (pkg.scripts.test) {
          return { cmd: 'npm', args: ['test'] };
        }
        if (pkg.scripts['test:unit']) {
          return { cmd: 'npm', args: ['run', 'test:unit'] };
        }
      }
      
    } catch (error) {
      // package.jsonが見つからない場合は他の方法を試す
    }
    
    // 一般的なテストツールを探す
    const testTools = [
      { cmd: 'jest', args: [] },
      { cmd: 'mocha', args: [] },
      { cmd: 'npm', args: ['test'] }
    ];
    
    for (const tool of testTools) {
      const exists = await this.commandExists(tool.cmd);
      if (exists) {
        return tool;
      }
    }
    
    return null;
  }
  
  /**
   * 基本的な検証を実行
   */
  async runBasicValidation(repairResult) {
    const validations = [];
    
    // 修復されたファイルの構文チェック
    if (repairResult.file) {
      const ext = path.extname(repairResult.file);
      
      if (ext === '.js' || ext === '.ts') {
        // Node.jsの構文チェック
        const result = await this.executeCommand('node', ['--check', repairResult.file], {
          timeout: 5000
        });
        
        validations.push({
          type: 'syntax',
          file: repairResult.file,
          success: result.code === 0,
          output: result.output
        });
      } else if (ext === '.json') {
        // JSONの検証
        try {
          const content = await fs.readFile(repairResult.file, 'utf8');
          JSON.parse(content);
          validations.push({
            type: 'json',
            file: repairResult.file,
            success: true
          });
        } catch (error) {
          validations.push({
            type: 'json',
            file: repairResult.file,
            success: false,
            output: error.message
          });
        }
      }
    }
    
    const allPassed = validations.every(v => v.success);
    
    return {
      success: allPassed,
      output: validations.map(v => 
        `${v.type} validation for ${v.file}: ${v.success ? 'PASSED' : 'FAILED'}\n${v.output || ''}`
      ).join('\n'),
      validations
    };
  }
  
  /**
   * コマンドを実行
   */
  executeCommand(cmd, args, options = {}) {
    return new Promise((resolve) => {
      const child = spawn(cmd, args, {
        shell: true,
        timeout: options.timeout || 30000
      });
      
      let output = '';
      let errorOutput = '';
      
      child.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      child.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      child.on('close', (code) => {
        resolve({
          code,
          output: output + errorOutput,
          stdout: output,
          stderr: errorOutput
        });
      });
      
      child.on('error', (error) => {
        resolve({
          code: -1,
          output: error.message,
          error: true
        });
      });
    });
  }
  
  /**
   * コマンドが存在するかチェック
   */
  async commandExists(cmd) {
    const result = await this.executeCommand('which', [cmd], { timeout: 5000 });
    return result.code === 0;
  }
  
  /**
   * 修復戦略の読み込み
   */
  loadRepairStrategies() {
    // 組み込みパターンの修復戦略を登録
    const patterns = ['EP001', 'EP004', 'EP010'];
    patterns.forEach(patternId => {
      const strategy = getRepairStrategy(patternId, this.logger);
      if (strategy) {
        this.repairStrategies[patternId] = strategy;
        this.logger.info(`修復戦略をロード: ${patternId}`);
      }
    });
    
    // デフォルト戦略の登録
    this.registerDefaultStrategies();
  }
  
  /**
   * デフォルトの修復戦略を登録
   */
  registerDefaultStrategies() {
    // EP002: Reference Error - Undefined Variable
    if (!this.repairStrategies['EP002']) {
      this.repairStrategies['EP002'] = {
        repair: async (errorInfo) => {
          // 基本的な自動インポート機能
          this.logger.info('EP002: Reference Error修復戦略（基本実装）');
          return {
            success: false,
            error: 'EP002の詳細実装は将来実装予定です'
          };
        }
      };
    }
    
    // EP003: Syntax Error
    if (!this.repairStrategies['EP003']) {
      this.repairStrategies['EP003'] = {
        repair: async (errorInfo) => {
          // 基本的な構文エラー修正
          this.logger.info('EP003: Syntax Error修復戦略（基本実装）');
          return {
            success: false,
            error: 'EP003の詳細実装は将来実装予定です'
          };
        }
      };
    }
  }
  
  /**
   * 修復履歴を記録
   */
  recordRepairHistory(errorInfo, repairResult, success) {
    const entry = {
      timestamp: new Date().toISOString(),
      errorHash: errorInfo.hash,
      category: errorInfo.analysis.category,
      patternId: errorInfo.analysis.patternId,
      success,
      result: success ? {
        file: repairResult.file,
        action: repairResult.action,
        changes: repairResult.changes
      } : {
        error: repairResult.error || repairResult
      }
    };
    
    this.repairHistory.push(entry);
    
    // 履歴が大きくなりすぎないように制限
    if (this.repairHistory.length > 100) {
      this.repairHistory = this.repairHistory.slice(-100);
    }
  }
  
  /**
   * 修復統計を取得
   */
  getStatistics() {
    const stats = {
      totalAttempts: 0,
      totalSuccesses: 0,
      totalFailures: 0,
      byPattern: {}
    };
    
    for (const patternId in this.repairStats.attempts) {
      const attempts = this.repairStats.attempts[patternId] || 0;
      const successes = this.repairStats.successes[patternId] || 0;
      const failures = this.repairStats.failures[patternId] || 0;
      
      stats.totalAttempts += attempts;
      stats.totalSuccesses += successes;
      stats.totalFailures += failures;
      
      stats.byPattern[patternId] = {
        pattern: this.repairPatterns[patternId]?.name || patternId,
        attempts,
        successes,
        failures,
        successRate: attempts > 0 ? (successes / attempts) : 0
      };
    }
    
    stats.overallSuccessRate = stats.totalAttempts > 0 
      ? (stats.totalSuccesses / stats.totalAttempts) 
      : 0;
    
    return stats;
  }
  
  /**
   * 学習データをエクスポート
   */
  async exportLearningData(filePath) {
    const data = {
      statistics: this.getStatistics(),
      history: this.repairHistory,
      patterns: Object.keys(this.repairPatterns).map(id => ({
        id,
        name: this.repairPatterns[id].name,
        description: this.repairPatterns[id].description,
        successRate: this.repairStats.getSuccessRate(id)
      })),
      exportedAt: new Date().toISOString()
    };
    
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    
    return data;
  }
  
  /**
   * 学習データをインポート
   */
  async importLearningData(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const data = JSON.parse(content);
      
      // 統計情報をマージ
      if (data.statistics && data.statistics.byPattern) {
        for (const patternId in data.statistics.byPattern) {
          const patternStats = data.statistics.byPattern[patternId];
          
          // 既存の統計に追加
          this.repairStats.attempts[patternId] = 
            (this.repairStats.attempts[patternId] || 0) + patternStats.attempts;
          this.repairStats.successes[patternId] = 
            (this.repairStats.successes[patternId] || 0) + patternStats.successes;
          this.repairStats.failures[patternId] = 
            (this.repairStats.failures[patternId] || 0) + patternStats.failures;
        }
      }
      
      // 履歴をマージ（重複を避ける）
      if (data.history && Array.isArray(data.history)) {
        const existingHashes = new Set(this.repairHistory.map(h => h.errorHash));
        const newEntries = data.history.filter(h => !existingHashes.has(h.errorHash));
        this.repairHistory.push(...newEntries);
      }
      
      this.logger.info(`学習データをインポートしました: ${filePath}`);
      
      return {
        patternsUpdated: Object.keys(data.statistics?.byPattern || {}).length,
        historyAdded: data.history?.length || 0
      };
      
    } catch (error) {
      this.logger.error(`学習データのインポートエラー: ${error.message}`);
      throw error;
    }
  }
}

module.exports = AutoRepairEngine;