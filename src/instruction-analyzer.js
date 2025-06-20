const fs = require('fs').promises;
const path = require('path');
const Redis = require('ioredis');
const { v4: uuidv4 } = require('uuid');

/**
 * 指示内容分析器
 * CCSPエージェント（パイちゃん）を使用してユーザーの指示を分析し、適切なアクションを決定する
 */
class InstructionAnalyzer {
  constructor(redisConfig, customLogger = null) {
    // Redis設定（claudeClientの代わり）
    this.redisConfig = redisConfig || {
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379
    };
    this.redis = new Redis(this.redisConfig);
    this.responseQueue = 'ccsp:responses:instruction-analyzer';
    this.promptTemplate = null;
    
    // loggerの初期化
    if (customLogger) {
      this.logger = customLogger;
    } else {
      try {
        this.logger = require('./logger');
      } catch (e) {
        // テスト環境などでloggerが存在しない場合のダミー実装
        this.logger = {
          info: () => {},
          error: () => {},
          debug: () => {}
        };
      }
    }
  }

  /**
   * 初期化
   */
  async init() {
    try {
      // プロンプトテンプレートを読み込み
      const promptPath = path.join(__dirname, '..', 'prompts', 'analysis-prompt.md');
      this.promptTemplate = await fs.readFile(promptPath, 'utf-8');
      this.logger.info('InstructionAnalyzer initialized');
    } catch (error) {
      this.logger.error('Failed to initialize InstructionAnalyzer:', error);
      throw error;
    }
  }

  /**
   * 指示内容を分析
   * @param {string} instruction - 分析する指示内容
   * @param {Object} context - 追加のコンテキスト情報
   * @returns {Object} 分析結果
   */
  async analyze(instruction, context = {}) {
    if (!this.promptTemplate) {
      await this.init();
    }

    try {
      this.logger.info('Analyzing instruction...');
      
      // プロンプトを生成
      const prompt = this.promptTemplate.replace('{{INSTRUCTION}}', instruction);
      
      // パイちゃんへのリクエストを作成
      const requestId = uuidv4();
      const request = {
        requestId,
        fromAgent: 'instruction-analyzer',
        type: 'analyze',
        prompt: prompt,
        context: {
          workingDirectory: process.cwd(),
          timeout: 300000, // 5分
          priority: 'normal'
        },
        timestamp: new Date().toISOString()
      };
      
      this.logger.info(`Sending analysis request to CCSP: ${requestId}`);
      
      // リクエストを送信
      await this.redis.lpush('ccsp:requests', JSON.stringify(request));
      
      // レスポンスを待機
      const timeout = Date.now() + 300000; // 5分のタイムアウト
      let response = null;
      
      while (Date.now() < timeout) {
        // FIFOのため、lpopで取得
        const data = await this.redis.lpop(this.responseQueue);
        
        if (data) {
          const parsed = JSON.parse(data);
          
          // 自分のリクエストのレスポンスか確認
          if (parsed.requestId === requestId) {
            if (parsed.success) {
              response = parsed.result;
              break;
            } else {
              throw new Error(parsed.error || 'CCSP returned error');
            }
          } else {
            // 他のリクエストのレスポンスは戻す（末尾に追加）
            await this.redis.rpush(this.responseQueue, data);
          }
        }
        
        // 100ミリ秒待機
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      if (!response) {
        throw new Error('Timeout waiting for CCSP response');
      }
      
      // レスポンスをパース
      const result = this.parseResponse(response);
      
      // 分析結果をログ
      this.logger.info('Analysis result:', {
        action: result.action,
        confidence: result.confidence,
        reasoning: result.reasoning
      });
      
      return result;
    } catch (error) {
      this.logger.error('Failed to analyze instruction:', error);
      // エラーの場合はデフォルトのレスポンスを返す
      return {
        action: 'unknown',
        confidence: 0.0,
        reasoning: 'Analysis failed',
        data: {
          instruction: instruction,
          error: error.message
        }
      };
    }
  }

  /**
   * Claude APIのレスポンスをパース
   * @param {string} response - Claude APIのレスポンス
   * @returns {Object} パースされた結果
   */
  parseResponse(response) {
    try {
      // JSONブロックを抽出
      const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        const jsonStr = jsonMatch[1];
        const parsed = JSON.parse(jsonStr);
        
        // バリデーション
        if (!this.validateAnalysisResult(parsed)) {
          throw new Error('Invalid analysis result format');
        }
        
        return parsed;
      }
      
      // JSONブロックが見つからない場合は、全体をJSONとしてパース
      const parsed = JSON.parse(response);
      if (!this.validateAnalysisResult(parsed)) {
        throw new Error('Invalid analysis result format');
      }
      
      return parsed;
    } catch (error) {
      this.logger.error('Failed to parse response:', error);
      this.logger.debug('Raw response:', response);
      
      // パースエラーの場合のフォールバック
      return {
        action: 'unknown',
        confidence: 0.0,
        reasoning: 'Failed to parse analysis response',
        data: {
          error: error.message,
          rawResponse: response
        }
      };
    }
  }

  /**
   * 分析結果のバリデーション
   * @param {Object} result - 分析結果
   * @returns {boolean} 有効な場合true
   */
  validateAnalysisResult(result) {
    // 必須フィールドのチェック
    if (!result.action || !['create_issue', 'execute_code', 'unknown'].includes(result.action)) {
      return false;
    }
    
    if (typeof result.confidence !== 'number' || result.confidence < 0 || result.confidence > 1) {
      return false;
    }
    
    if (!result.data || typeof result.data !== 'object') {
      return false;
    }
    
    // アクション別のバリデーション
    if (result.action === 'create_issue') {
      if (!result.data.title || !result.data.body || !Array.isArray(result.data.labels)) {
        return false;
      }
    } else if (result.action === 'execute_code') {
      if (!result.data.instruction) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * デフォルトのラベルを適用
   * @param {Array} labels - 既存のラベル
   * @param {string} instruction - 指示内容
   * @returns {Array} 更新されたラベル
   */
  applyDefaultLabels(labels, instruction) {
    const updatedLabels = [...labels];
    
    // task:* ラベルがない場合はデフォルトを追加
    if (!updatedLabels.some(label => label.startsWith('task:'))) {
      // キーワードに基づいて判定
      const instructionLower = instruction.toLowerCase();
      
      if (instructionLower.includes('dogfooding')) {
        updatedLabels.push('task:dogfooding');
      } else if (instructionLower.includes('バグ') || instructionLower.includes('エラー') || 
                 instructionLower.includes('修正') || instructionLower.includes('bug') || 
                 instructionLower.includes('error') || instructionLower.includes('fix')) {
        updatedLabels.push('task:bug');
      } else if (instructionLower.includes('機能') || instructionLower.includes('実装') || 
                 instructionLower.includes('追加') || instructionLower.includes('feature') || 
                 instructionLower.includes('implement') || instructionLower.includes('add')) {
        updatedLabels.push('task:feature');
      } else if (instructionLower.includes('ドキュメント') || instructionLower.includes('文書') || 
                 instructionLower.includes('readme') || instructionLower.includes('document') || 
                 instructionLower.includes('docs')) {
        updatedLabels.push('task:documentation');
      } else if (instructionLower.includes('テスト') || instructionLower.includes('test')) {
        updatedLabels.push('task:test');
      } else if (instructionLower.includes('リファクタリング') || instructionLower.includes('整理') || 
                 instructionLower.includes('改善') || instructionLower.includes('refactor')) {
        updatedLabels.push('task:refactoring');
      } else {
        updatedLabels.push('task:misc');
      }
    }
    
    // priority:* ラベルがない場合はデフォルトを追加
    if (!updatedLabels.some(label => label.startsWith('priority:'))) {
      const instructionLower = instruction.toLowerCase();
      
      if (instructionLower.includes('緊急') || instructionLower.includes('至急') || 
          instructionLower.includes('重要') || instructionLower.includes('critical') || 
          instructionLower.includes('urgent')) {
        updatedLabels.push('priority:high');
      } else if (instructionLower.includes('低優先度') || instructionLower.includes('後回し') || 
                 instructionLower.includes('いつか') || instructionLower.includes('low priority')) {
        updatedLabels.push('priority:low');
      } else {
        updatedLabels.push('priority:medium');
      }
    }
    
    return updatedLabels;
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

module.exports = InstructionAnalyzer;