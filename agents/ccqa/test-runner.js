const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const path = require('path');
const fs = require('fs').promises;
const Logger = require('../../src/logger');

/**
 * テスト実行モジュール
 */
class TestRunner {
  constructor(config = {}) {
    this.config = config;
    this.logger = new Logger('CCQA-TestRunner');
    
    // テストランナーの設定
    this.runners = config.runners || ['jest', 'mocha'];
    this.coverageReporter = config.coverageReporter || 'lcov';
    this.timeout = config.timeout || 60000;
    
    // テスト結果のキャッシュ
    this.cache = new Map();
  }
  
  /**
   * 初期化
   */
  async initialize() {
    this.logger.info('TestRunnerを初期化中...');
    
    // 利用可能なテストランナーを確認
    this.availableRunners = await this.detectTestRunners();
    this.logger.info(`利用可能なテストランナー: ${this.availableRunners.join(', ')}`);
  }
  
  /**
   * 利用可能なテストランナーの検出
   */
  async detectTestRunners() {
    const available = [];
    
    for (const runner of this.runners) {
      try {
        await execAsync(`npx ${runner} --version`);
        available.push(runner);
      } catch (error) {
        this.logger.debug(`${runner} は利用できません`);
      }
    }
    
    return available;
  }
  
  /**
   * テストの実行
   */
  async runTests(projectDir, changedFiles = []) {
    this.logger.info(`テストを実行: ${projectDir}`);
    
    try {
      // package.jsonからテスト情報を取得
      const packageInfo = await this.getPackageInfo(projectDir);
      
      // テストコマンドの決定
      const testCommand = await this.determineTestCommand(projectDir, packageInfo);
      
      if (!testCommand) {
        this.logger.warn('テストコマンドが見つかりません');
        return {
          success: false,
          total: 0,
          passed: 0,
          failed: 0,
          coverage: 0,
          message: 'テストコマンドが見つかりません'
        };
      }
      
      // テスト実行
      const startTime = Date.now();
      const result = await this.executeTests(projectDir, testCommand);
      const duration = Date.now() - startTime;
      
      // カバレッジ情報の取得
      const coverage = await this.getCoverageInfo(projectDir);
      
      // 変更されたファイルに関連するテストの特定
      const affectedTests = await this.findAffectedTests(projectDir, changedFiles);
      
      return {
        success: result.success,
        total: result.total || 0,
        passed: result.passed || 0,
        failed: result.failed || 0,
        skipped: result.skipped || 0,
        coverage: coverage.percentage || 0,
        duration,
        testRunner: result.runner,
        affectedTests,
        coverageDetails: coverage.details,
        failedTests: result.failedTests || []
      };
      
    } catch (error) {
      this.logger.error(`テスト実行エラー: ${error.message}`);
      return {
        success: false,
        total: 0,
        passed: 0,
        failed: 0,
        coverage: 0,
        error: error.message
      };
    }
  }
  
  /**
   * package.json情報の取得
   */
  async getPackageInfo(projectDir) {
    try {
      const packagePath = path.join(projectDir, 'package.json');
      const content = await fs.readFile(packagePath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      this.logger.warn('package.jsonが読み込めません');
      return {};
    }
  }
  
  /**
   * テストコマンドの決定
   */
  async determineTestCommand(projectDir, packageInfo) {
    // package.jsonのscriptsからテストコマンドを探す
    if (packageInfo.scripts?.test) {
      return packageInfo.scripts.test;
    }
    
    // 一般的なテストファイルパターンを探す
    const testPatterns = [
      'test/**/*.test.js',
      'test/**/*.spec.js',
      '__tests__/**/*.js',
      'spec/**/*.js'
    ];
    
    for (const pattern of testPatterns) {
      try {
        const files = await this.findFiles(projectDir, pattern);
        if (files.length > 0) {
          // テストファイルが見つかった場合、適切なランナーを選択
          if (this.availableRunners.includes('jest')) {
            return 'jest';
          } else if (this.availableRunners.includes('mocha')) {
            return 'mocha';
          }
        }
      } catch (error) {
        // パターンマッチングエラーは無視
      }
    }
    
    return null;
  }
  
  /**
   * テストの実行
   */
  async executeTests(projectDir, testCommand) {
    try {
      // カバレッジオプションを追加
      let command = testCommand;
      if (!command.includes('coverage') && !command.includes('nyc')) {
        if (command.includes('jest')) {
          command += ' --coverage';
        } else if (command.includes('mocha')) {
          command = `nyc ${command}`;
        }
      }
      
      this.logger.info(`テストコマンド実行: ${command}`);
      
      const { stdout, stderr } = await execAsync(command, {
        cwd: projectDir,
        timeout: this.timeout,
        maxBuffer: 10 * 1024 * 1024 // 10MB
      });
      
      // 結果の解析
      return this.parseTestResults(stdout, stderr, command);
      
    } catch (error) {
      // テストが失敗した場合でも結果を解析
      if (error.stdout || error.stderr) {
        return this.parseTestResults(error.stdout || '', error.stderr || '', testCommand);
      }
      throw error;
    }
  }
  
  /**
   * テスト結果の解析
   */
  parseTestResults(stdout, stderr, command) {
    const result = {
      success: false,
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      runner: 'unknown',
      failedTests: []
    };
    
    // Jestの結果解析
    if (command.includes('jest') || stdout.includes('PASS') || stdout.includes('FAIL')) {
      result.runner = 'jest';
      
      // テスト数の抽出
      const testMatch = stdout.match(/Tests:\s+(\d+)\s+failed,\s+(\d+)\s+passed,\s+(\d+)\s+total/);
      if (testMatch) {
        result.failed = parseInt(testMatch[1]);
        result.passed = parseInt(testMatch[2]);
        result.total = parseInt(testMatch[3]);
        result.success = result.failed === 0;
      }
      
      // スキップされたテストの抽出
      const skipMatch = stdout.match(/(\d+)\s+skipped/);
      if (skipMatch) {
        result.skipped = parseInt(skipMatch[1]);
      }
      
      // 失敗したテストの詳細
      const failedTests = stdout.match(/✕\s+(.+)/g);
      if (failedTests) {
        result.failedTests = failedTests.map(test => test.replace(/✕\s+/, ''));
      }
    }
    
    // Mochaの結果解析
    else if (command.includes('mocha') || stdout.includes('passing') || stdout.includes('failing')) {
      result.runner = 'mocha';
      
      // テスト数の抽出
      const passMatch = stdout.match(/(\d+)\s+passing/);
      const failMatch = stdout.match(/(\d+)\s+failing/);
      
      if (passMatch) {
        result.passed = parseInt(passMatch[1]);
      }
      if (failMatch) {
        result.failed = parseInt(failMatch[1]);
      }
      
      result.total = result.passed + result.failed;
      result.success = result.failed === 0;
      
      // 失敗したテストの詳細
      const failedSections = stdout.split(/\d+\)\s+/);
      if (failedSections.length > 1) {
        result.failedTests = failedSections.slice(1).map(section => {
          const lines = section.split('\n');
          return lines[0].trim();
        });
      }
    }
    
    return result;
  }
  
  /**
   * カバレッジ情報の取得
   */
  async getCoverageInfo(projectDir) {
    try {
      // カバレッジサマリーファイルを探す
      const coveragePaths = [
        'coverage/coverage-summary.json',
        'coverage/lcov-report/index.html',
        '.nyc_output/coverage-summary.json'
      ];
      
      for (const coveragePath of coveragePaths) {
        const fullPath = path.join(projectDir, coveragePath);
        try {
          const content = await fs.readFile(fullPath, 'utf8');
          
          // JSONファイルの場合
          if (coveragePath.endsWith('.json')) {
            const summary = JSON.parse(content);
            return {
              percentage: Math.round(summary.total?.lines?.pct || 0),
              details: {
                lines: summary.total?.lines || {},
                statements: summary.total?.statements || {},
                functions: summary.total?.functions || {},
                branches: summary.total?.branches || {}
              }
            };
          }
          
          // HTMLファイルの場合（簡易解析）
          if (coveragePath.endsWith('.html')) {
            const match = content.match(/(\d+(?:\.\d+)?)\s*%/);
            if (match) {
              return {
                percentage: Math.round(parseFloat(match[1])),
                details: {}
              };
            }
          }
        } catch (error) {
          // ファイルが存在しない場合は次を試す
        }
      }
      
      return { percentage: 0, details: {} };
      
    } catch (error) {
      this.logger.warn(`カバレッジ情報の取得エラー: ${error.message}`);
      return { percentage: 0, details: {} };
    }
  }
  
  /**
   * 影響を受けるテストの特定
   */
  async findAffectedTests(projectDir, changedFiles) {
    const affectedTests = [];
    
    // 変更されたファイルに対応するテストファイルを探す
    for (const file of changedFiles) {
      const baseName = path.basename(file, path.extname(file));
      const testPatterns = [
        `**/${baseName}.test.js`,
        `**/${baseName}.spec.js`,
        `**/${baseName}.test.ts`,
        `**/${baseName}.spec.ts`
      ];
      
      for (const pattern of testPatterns) {
        try {
          const tests = await this.findFiles(projectDir, pattern);
          affectedTests.push(...tests);
        } catch (error) {
          // パターンマッチングエラーは無視
        }
      }
    }
    
    return [...new Set(affectedTests)]; // 重複を除去
  }
  
  /**
   * ファイル検索（簡易実装）
   */
  async findFiles(dir, pattern) {
    // TODO: glob実装を追加
    return [];
  }
}

module.exports = TestRunner;