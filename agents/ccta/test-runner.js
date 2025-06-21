const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;

/**
 * テストランナー - 各種テストフレームワークに対応
 */
class TestRunner {
  constructor(config = {}) {
    this.config = config;
    this.frameworks = config.frameworks || ['jest'];
    this.timeout = config.timeout || 300000; // 5分
  }
  
  /**
   * テストの実行
   */
  async run(options = {}) {
    const framework = await this.detectFramework();
    
    switch (framework) {
      case 'jest':
        return await this.runJest(options);
      case 'mocha':
        return await this.runMocha(options);
      case 'vitest':
        return await this.runVitest(options);
      case 'jasmine':
        return await this.runJasmine(options);
      default:
        throw new Error(`サポートされていないテストフレームワーク: ${framework}`);
    }
  }
  
  /**
   * Jestの実行
   */
  async runJest(options) {
    const args = ['--json', '--outputFile', 'test-results.json'];
    
    if (options.coverage) {
      args.push('--coverage', '--coverageReporters', 'json', 'lcov', 'text');
    }
    
    if (options.files && options.files.length > 0) {
      args.push(...options.files);
    } else if (options.pattern) {
      args.push('--testPathPattern', options.pattern);
    }
    
    if (options.watch) {
      args.push('--watch');
    }
    
    if (options.bail) {
      args.push('--bail');
    }
    
    if (options.parallel !== false) {
      args.push('--maxWorkers', '50%');
    }
    
    const result = await this.executeCommand('jest', args);
    
    // 結果の解析
    try {
      const jsonResult = JSON.parse(
        await fs.readFile('test-results.json', 'utf8')
      );
      
      return this.parseJestResults(jsonResult);
    } catch (error) {
      // JSONファイルが生成されなかった場合
      return this.parseTextOutput(result.output, 'jest');
    }
  }
  
  /**
   * Mochaの実行
   */
  async runMocha(options) {
    const args = ['--reporter', 'json'];
    
    if (options.files && options.files.length > 0) {
      args.push(...options.files);
    } else {
      args.push('test/**/*.test.js');
    }
    
    if (options.bail) {
      args.push('--bail');
    }
    
    if (options.parallel !== false) {
      args.push('--parallel');
    }
    
    const result = await this.executeCommand('mocha', args);
    
    try {
      return this.parseMochaResults(JSON.parse(result.output));
    } catch (error) {
      return this.parseTextOutput(result.output, 'mocha');
    }
  }
  
  /**
   * Vitestの実行
   */
  async runVitest(options) {
    const args = ['--reporter=json', '--outputFile=test-results.json'];
    
    if (options.coverage) {
      args.push('--coverage');
    }
    
    if (options.files && options.files.length > 0) {
      args.push(...options.files);
    }
    
    if (!options.watch) {
      args.push('--run');
    }
    
    const result = await this.executeCommand('vitest', args);
    
    try {
      const jsonResult = JSON.parse(
        await fs.readFile('test-results.json', 'utf8')
      );
      return this.parseVitestResults(jsonResult);
    } catch (error) {
      return this.parseTextOutput(result.output, 'vitest');
    }
  }
  
  /**
   * Jasmineの実行
   */
  async runJasmine(options) {
    const args = ['--reporter=json'];
    
    if (options.files && options.files.length > 0) {
      args.push(...options.files);
    }
    
    const result = await this.executeCommand('jasmine', args);
    
    try {
      return this.parseJasmineResults(JSON.parse(result.output));
    } catch (error) {
      return this.parseTextOutput(result.output, 'jasmine');
    }
  }
  
  /**
   * コマンドの実行
   */
  async executeCommand(command, args) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: process.cwd(),
        env: process.env,
        shell: true
      });
      
      let output = '';
      let errorOutput = '';
      
      child.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      child.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`テストがタイムアウトしました (${this.timeout}ms)`));
      }, this.timeout);
      
      child.on('close', (code) => {
        clearTimeout(timeout);
        resolve({
          code,
          output,
          errorOutput,
          success: code === 0
        });
      });
      
      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }
  
  /**
   * フレームワークの検出
   */
  async detectFramework() {
    try {
      const packageJson = JSON.parse(
        await fs.readFile(path.join(process.cwd(), 'package.json'), 'utf8')
      );
      
      // package.jsonのscriptsから検出
      if (packageJson.scripts) {
        if (packageJson.scripts.test) {
          const testScript = packageJson.scripts.test;
          if (testScript.includes('jest')) return 'jest';
          if (testScript.includes('mocha')) return 'mocha';
          if (testScript.includes('vitest')) return 'vitest';
          if (testScript.includes('jasmine')) return 'jasmine';
        }
      }
      
      // 依存関係から検出
      const deps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies
      };
      
      for (const framework of this.frameworks) {
        if (deps[framework]) return framework;
      }
      
    } catch (error) {
      console.warn('フレームワーク検出エラー:', error.message);
    }
    
    return 'jest'; // デフォルト
  }
  
  /**
   * Jest結果の解析
   */
  parseJestResults(jsonResult) {
    const { numTotalTests, numPassedTests, numFailedTests, testResults } = jsonResult;
    
    const failures = [];
    const passes = [];
    
    for (const file of testResults) {
      for (const test of file.testResults) {
        if (test.status === 'failed') {
          failures.push({
            file: file.name,
            test: test.title,
            error: test.failureMessages.join('\n'),
            duration: test.duration
          });
        } else if (test.status === 'passed') {
          passes.push({
            file: file.name,
            test: test.title,
            duration: test.duration
          });
        }
      }
    }
    
    return {
      passed: numFailedTests === 0,
      total: numTotalTests,
      passed: numPassedTests,
      failed: numFailedTests,
      failures,
      passes,
      duration: jsonResult.testResults.reduce((sum, r) => sum + (r.perfStats?.runtime || 0), 0),
      coverage: jsonResult.coverageMap || null
    };
  }
  
  /**
   * Mocha結果の解析
   */
  parseMochaResults(jsonResult) {
    const { stats, tests, failures } = jsonResult;
    
    return {
      passed: stats.failures === 0,
      total: stats.tests,
      passed: stats.passes,
      failed: stats.failures,
      failures: failures.map(f => ({
        file: f.file,
        test: f.title,
        error: f.err.message,
        duration: f.duration
      })),
      passes: tests.filter(t => t.pass).map(t => ({
        file: t.file,
        test: t.title,
        duration: t.duration
      })),
      duration: stats.duration
    };
  }
  
  /**
   * Vitest結果の解析
   */
  parseVitestResults(jsonResult) {
    // Vitestの結果形式はJestと似ている
    return this.parseJestResults(jsonResult);
  }
  
  /**
   * Jasmine結果の解析
   */
  parseJasmineResults(jsonResult) {
    // Jasmineの結果を標準形式に変換
    return {
      passed: jsonResult.overallStatus === 'passed',
      total: jsonResult.totalSpecs,
      passed: jsonResult.passedSpecs,
      failed: jsonResult.failedSpecs,
      failures: jsonResult.failedExpectations || [],
      passes: [],
      duration: jsonResult.duration
    };
  }
  
  /**
   * テキスト出力の解析（フォールバック）
   */
  parseTextOutput(output, framework) {
    // 基本的なパターンマッチング
    const patterns = {
      jest: {
        total: /Tests:\s+(\d+)\s+total/,
        passed: /(\d+)\s+passed/,
        failed: /(\d+)\s+failed/
      },
      mocha: {
        total: /(\d+)\s+tests?/,
        passed: /(\d+)\s+passing/,
        failed: /(\d+)\s+failing/
      }
    };
    
    const pattern = patterns[framework] || patterns.jest;
    
    const totalMatch = output.match(pattern.total);
    const passedMatch = output.match(pattern.passed);
    const failedMatch = output.match(pattern.failed);
    
    const total = totalMatch ? parseInt(totalMatch[1]) : 0;
    const passed = passedMatch ? parseInt(passedMatch[1]) : 0;
    const failed = failedMatch ? parseInt(failedMatch[1]) : 0;
    
    return {
      passed: failed === 0,
      total,
      passed,
      failed,
      failures: [],
      passes: [],
      duration: 0,
      rawOutput: output
    };
  }
}

module.exports = TestRunner;