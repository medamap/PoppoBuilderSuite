const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const path = require('path');
const fs = require('fs').promises;
const Logger = require('../../src/logger');

/**
 * コード品質チェックモジュール
 */
class QualityChecker {
  constructor(config = {}) {
    this.config = config;
    this.logger = new Logger('CCQA-QualityChecker');
    
    // リンターとフォーマッターの設定
    this.linters = config.linters || ['eslint'];
    this.formatters = config.formatters || ['prettier'];
    this.complexityAnalyzer = config.complexityAnalyzer || 'eslint';
    
    // 閾値設定
    this.thresholds = {
      maxComplexity: config.maxComplexity || 20,
      maxDuplicateLines: config.maxDuplicateLines || 50,
      maxFileLength: config.maxFileLength || 500
    };
  }
  
  /**
   * 初期化
   */
  async initialize() {
    this.logger.info('QualityCheckerを初期化中...');
    
    // 利用可能なツールを確認
    this.availableTools = await this.detectTools();
    this.logger.info(`利用可能なツール: ${Object.keys(this.availableTools).join(', ')}`);
  }
  
  /**
   * 利用可能なツールの検出
   */
  async detectTools() {
    const tools = {};
    
    // ESLint
    if (this.linters.includes('eslint')) {
      try {
        await execAsync('npx eslint --version');
        tools.eslint = true;
      } catch (error) {
        this.logger.debug('ESLintは利用できません');
      }
    }
    
    // Prettier
    if (this.formatters.includes('prettier')) {
      try {
        await execAsync('npx prettier --version');
        tools.prettier = true;
      } catch (error) {
        this.logger.debug('Prettierは利用できません');
      }
    }
    
    return tools;
  }
  
  /**
   * コード品質チェックの実行
   */
  async checkQuality(projectDir, changedFiles = []) {
    this.logger.info(`コード品質をチェック: ${projectDir}`);
    
    const results = {
      issues: [],
      metrics: {},
      suggestions: []
    };
    
    try {
      // 1. リンターチェック
      if (this.availableTools.eslint) {
        const lintResults = await this.runESLint(projectDir, changedFiles);
        results.issues.push(...lintResults.issues);
        results.metrics.linting = lintResults.metrics;
      }
      
      // 2. フォーマットチェック
      if (this.availableTools.prettier) {
        const formatResults = await this.checkFormatting(projectDir, changedFiles);
        results.issues.push(...formatResults.issues);
        results.metrics.formatting = formatResults.metrics;
      }
      
      // 3. 複雑度分析
      const complexityResults = await this.analyzeComplexity(projectDir, changedFiles);
      results.issues.push(...complexityResults.issues);
      results.metrics.complexity = complexityResults.metrics;
      
      // 4. コード重複検出
      const duplicationResults = await this.detectDuplication(projectDir, changedFiles);
      results.issues.push(...duplicationResults.issues);
      results.metrics.duplication = duplicationResults.metrics;
      
      // 5. コーディング規約チェック
      const conventionResults = await this.checkConventions(projectDir, changedFiles);
      results.issues.push(...conventionResults.issues);
      results.metrics.conventions = conventionResults.metrics;
      
      // 改善提案の生成
      results.suggestions = this.generateSuggestions(results);
      
      return results;
      
    } catch (error) {
      this.logger.error(`品質チェックエラー: ${error.message}`);
      return results;
    }
  }
  
  /**
   * ESLintの実行
   */
  async runESLint(projectDir, changedFiles) {
    const results = {
      issues: [],
      metrics: {
        totalIssues: 0,
        errors: 0,
        warnings: 0
      }
    };
    
    try {
      // ESLint設定ファイルの確認
      const configFile = await this.findESLintConfig(projectDir);
      
      // 対象ファイルの決定
      const targetFiles = changedFiles.length > 0 ? 
        changedFiles.filter(f => f.endsWith('.js') || f.endsWith('.ts')) :
        ['src/**/*.js', 'src/**/*.ts'];
      
      // ESLintコマンドの構築
      const command = [
        'npx eslint',
        configFile ? `--config ${configFile}` : '',
        '--format json',
        targetFiles.join(' ')
      ].filter(Boolean).join(' ');
      
      this.logger.debug(`ESLintコマンド: ${command}`);
      
      const { stdout } = await execAsync(command, {
        cwd: projectDir,
        maxBuffer: 10 * 1024 * 1024
      }).catch(error => {
        // ESLintはエラーがある場合も正常な出力を返す
        return { stdout: error.stdout || '[]' };
      });
      
      // 結果の解析
      const eslintResults = JSON.parse(stdout);
      
      for (const fileResult of eslintResults) {
        for (const message of fileResult.messages) {
          results.issues.push({
            type: 'linting',
            severity: message.severity === 2 ? 'error' : 'warning',
            file: path.relative(projectDir, fileResult.filePath),
            line: message.line,
            column: message.column,
            rule: message.ruleId,
            message: message.message,
            fixable: message.fix !== undefined
          });
          
          results.metrics.totalIssues++;
          if (message.severity === 2) {
            results.metrics.errors++;
          } else {
            results.metrics.warnings++;
          }
        }
      }
      
    } catch (error) {
      this.logger.error(`ESLint実行エラー: ${error.message}`);
    }
    
    return results;
  }
  
  /**
   * ESLint設定ファイルの検索
   */
  async findESLintConfig(projectDir) {
    const configFiles = [
      '.eslintrc.js',
      '.eslintrc.json',
      '.eslintrc.yml',
      '.eslintrc.yaml',
      '.eslintrc'
    ];
    
    for (const file of configFiles) {
      const filePath = path.join(projectDir, file);
      try {
        await fs.access(filePath);
        return filePath;
      } catch (error) {
        // ファイルが存在しない
      }
    }
    
    // package.jsonのeslintConfig
    try {
      const packagePath = path.join(projectDir, 'package.json');
      const content = await fs.readFile(packagePath, 'utf8');
      const packageJson = JSON.parse(content);
      if (packageJson.eslintConfig) {
        return packagePath;
      }
    } catch (error) {
      // package.jsonが存在しないか解析エラー
    }
    
    return null;
  }
  
  /**
   * フォーマットチェック
   */
  async checkFormatting(projectDir, changedFiles) {
    const results = {
      issues: [],
      metrics: {
        unformattedFiles: 0,
        totalFiles: 0
      }
    };
    
    try {
      // Prettier設定ファイルの確認
      const configFile = await this.findPrettierConfig(projectDir);
      
      // 対象ファイルの決定
      const targetFiles = changedFiles.length > 0 ? changedFiles : ['src/**/*.{js,ts,jsx,tsx}'];
      
      // Prettierチェックコマンド
      const command = [
        'npx prettier',
        configFile ? `--config ${configFile}` : '',
        '--check',
        targetFiles.join(' ')
      ].filter(Boolean).join(' ');
      
      const { stdout, stderr } = await execAsync(command, {
        cwd: projectDir
      }).catch(error => {
        // Prettierは未フォーマットファイルがある場合エラーを返す
        return { stdout: error.stdout || '', stderr: error.stderr || '' };
      });
      
      // 未フォーマットファイルの抽出
      const unformattedFiles = stderr.match(/\[warn\]\s+(.+)/g) || [];
      
      for (const warning of unformattedFiles) {
        const file = warning.replace(/\[warn\]\s+/, '');
        results.issues.push({
          type: 'formatting',
          severity: 'warning',
          file: path.relative(projectDir, file),
          message: 'ファイルがフォーマットされていません',
          fixable: true
        });
        results.metrics.unformattedFiles++;
      }
      
      results.metrics.totalFiles = targetFiles.length;
      
    } catch (error) {
      this.logger.error(`Prettierチェックエラー: ${error.message}`);
    }
    
    return results;
  }
  
  /**
   * Prettier設定ファイルの検索
   */
  async findPrettierConfig(projectDir) {
    const configFiles = [
      '.prettierrc',
      '.prettierrc.json',
      '.prettierrc.yml',
      '.prettierrc.yaml',
      '.prettierrc.js',
      'prettier.config.js'
    ];
    
    for (const file of configFiles) {
      const filePath = path.join(projectDir, file);
      try {
        await fs.access(filePath);
        return filePath;
      } catch (error) {
        // ファイルが存在しない
      }
    }
    
    return null;
  }
  
  /**
   * 複雑度分析
   */
  async analyzeComplexity(projectDir, changedFiles) {
    const results = {
      issues: [],
      metrics: {
        averageComplexity: 0,
        maxComplexity: 0,
        complexFunctions: []
      }
    };
    
    // 簡易的な複雑度計算（実際の実装では、より高度なツールを使用）
    for (const file of changedFiles) {
      if (!file.endsWith('.js') && !file.endsWith('.ts')) continue;
      
      try {
        const filePath = path.join(projectDir, file);
        const content = await fs.readFile(filePath, 'utf8');
        
        // 条件文とループの数をカウント（簡易版）
        const complexity = this.calculateCyclomaticComplexity(content);
        
        if (complexity > this.thresholds.maxComplexity) {
          results.issues.push({
            type: 'complexity',
            severity: 'warning',
            file,
            message: `サイクロマティック複雑度が高すぎます (${complexity} > ${this.thresholds.maxComplexity})`,
            complexity
          });
        }
        
        results.metrics.maxComplexity = Math.max(results.metrics.maxComplexity, complexity);
        results.metrics.complexFunctions.push({ file, complexity });
        
      } catch (error) {
        this.logger.warn(`複雑度分析エラー (${file}): ${error.message}`);
      }
    }
    
    // 平均複雑度の計算
    if (results.metrics.complexFunctions.length > 0) {
      const total = results.metrics.complexFunctions.reduce((sum, func) => sum + func.complexity, 0);
      results.metrics.averageComplexity = total / results.metrics.complexFunctions.length;
    }
    
    return results;
  }
  
  /**
   * サイクロマティック複雑度の計算（簡易版）
   */
  calculateCyclomaticComplexity(code) {
    let complexity = 1; // 基本複雑度
    
    // 条件文のパターン
    const patterns = [
      /\bif\s*\(/g,
      /\belse\s+if\s*\(/g,
      /\bfor\s*\(/g,
      /\bwhile\s*\(/g,
      /\bdo\s*{/g,
      /\bcase\s+/g,
      /\bcatch\s*\(/g,
      /\?\s*[^:]+:/g, // 三項演算子
      /&&/g,
      /\|\|/g
    ];
    
    for (const pattern of patterns) {
      const matches = code.match(pattern);
      if (matches) {
        complexity += matches.length;
      }
    }
    
    return complexity;
  }
  
  /**
   * コード重複検出（簡易版）
   */
  async detectDuplication(projectDir, changedFiles) {
    const results = {
      issues: [],
      metrics: {
        duplicateBlocks: 0,
        duplicateLines: 0
      }
    };
    
    // 簡易的な重複検出（実際の実装では、より高度なツールを使用）
    const codeBlocks = new Map();
    
    for (const file of changedFiles) {
      if (!file.endsWith('.js') && !file.endsWith('.ts')) continue;
      
      try {
        const filePath = path.join(projectDir, file);
        const content = await fs.readFile(filePath, 'utf8');
        const lines = content.split('\n');
        
        // 10行以上の連続したコードブロックをチェック
        for (let i = 0; i < lines.length - 10; i++) {
          const block = lines.slice(i, i + 10).join('\n').trim();
          if (block.length < 100) continue; // 短いブロックは無視
          
          const blockHash = this.hashCode(block);
          
          if (codeBlocks.has(blockHash)) {
            const original = codeBlocks.get(blockHash);
            results.issues.push({
              type: 'duplication',
              severity: 'info',
              file,
              line: i + 1,
              message: `コードの重複が検出されました (${original.file}:${original.line}と同じ)`,
              duplicateFile: original.file,
              duplicateLine: original.line
            });
            results.metrics.duplicateBlocks++;
            results.metrics.duplicateLines += 10;
          } else {
            codeBlocks.set(blockHash, { file, line: i + 1 });
          }
        }
        
      } catch (error) {
        this.logger.warn(`重複検出エラー (${file}): ${error.message}`);
      }
    }
    
    return results;
  }
  
  /**
   * 簡易ハッシュ関数
   */
  hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(16);
  }
  
  /**
   * コーディング規約チェック
   */
  async checkConventions(projectDir, changedFiles) {
    const results = {
      issues: [],
      metrics: {
        namingViolations: 0,
        fileLengthViolations: 0
      }
    };
    
    for (const file of changedFiles) {
      if (!file.endsWith('.js') && !file.endsWith('.ts')) continue;
      
      try {
        const filePath = path.join(projectDir, file);
        const content = await fs.readFile(filePath, 'utf8');
        const lines = content.split('\n');
        
        // ファイル長チェック
        if (lines.length > this.thresholds.maxFileLength) {
          results.issues.push({
            type: 'convention',
            severity: 'info',
            file,
            message: `ファイルが長すぎます (${lines.length}行 > ${this.thresholds.maxFileLength}行)`,
            lines: lines.length
          });
          results.metrics.fileLengthViolations++;
        }
        
        // 命名規則チェック（簡易版）
        const variablePattern = /(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
        let match;
        while ((match = variablePattern.exec(content)) !== null) {
          const varName = match[1];
          
          // スネークケースのチェック
          if (varName.includes('_') && varName !== varName.toUpperCase()) {
            const lineNumber = content.substring(0, match.index).split('\n').length;
            results.issues.push({
              type: 'convention',
              severity: 'info',
              file,
              line: lineNumber,
              message: `変数名 '${varName}' はキャメルケースを使用してください`,
              variable: varName
            });
            results.metrics.namingViolations++;
          }
        }
        
      } catch (error) {
        this.logger.warn(`規約チェックエラー (${file}): ${error.message}`);
      }
    }
    
    return results;
  }
  
  /**
   * 改善提案の生成
   */
  generateSuggestions(results) {
    const suggestions = [];
    
    // リンティングエラーが多い場合
    if (results.metrics.linting && results.metrics.linting.errors > 5) {
      suggestions.push({
        type: 'linting',
        priority: 'high',
        message: 'ESLintエラーが多数検出されました。自動修正を実行することをお勧めします',
        action: 'npx eslint --fix を実行してください'
      });
    }
    
    // フォーマットされていないファイルがある場合
    if (results.metrics.formatting && results.metrics.formatting.unformattedFiles > 0) {
      suggestions.push({
        type: 'formatting',
        priority: 'medium',
        message: 'フォーマットされていないファイルがあります',
        action: 'npx prettier --write を実行してください'
      });
    }
    
    // 複雑度が高い場合
    if (results.metrics.complexity && results.metrics.complexity.maxComplexity > this.thresholds.maxComplexity) {
      suggestions.push({
        type: 'complexity',
        priority: 'medium',
        message: '複雑度の高い関数があります。リファクタリングを検討してください',
        action: '関数を小さく分割することを検討してください'
      });
    }
    
    // コード重複が多い場合
    if (results.metrics.duplication && results.metrics.duplication.duplicateBlocks > 3) {
      suggestions.push({
        type: 'duplication',
        priority: 'low',
        message: 'コードの重複が検出されました',
        action: '共通関数やモジュールとして抽出することを検討してください'
      });
    }
    
    return suggestions;
  }
}

module.exports = QualityChecker;