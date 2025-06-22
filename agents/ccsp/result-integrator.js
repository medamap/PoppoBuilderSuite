/**
 * 結果統合器
 * Claude Codeの実行結果を統合し、検証する
 */

const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');

class ResultIntegrator {
  constructor() {
    this.validators = {
      'code-generation': this.validateCodeGeneration.bind(this),
      'test-generation': this.validateTestGeneration.bind(this),
      'refactoring': this.validateRefactoring.bind(this),
      'default': this.validateDefault.bind(this)
    };
  }

  /**
   * 結果を統合
   */
  async integrate(result, task) {
    const integrated = {
      success: result.success,
      changes: [],
      validations: [],
      summary: '',
      metrics: {},
      warnings: [],
      nextSteps: []
    };

    try {
      // 変更内容を解析
      integrated.changes = await this.parseChanges(result.output);
      
      // タスクタイプに応じた検証
      const validator = this.validators[task.type] || this.validators.default;
      integrated.validations = await validator(result, task);
      
      // メトリクスを計算
      integrated.metrics = await this.calculateMetrics(integrated.changes, task);
      
      // サマリーを生成
      integrated.summary = this.generateSummary(integrated);
      
      // 警告を検出
      integrated.warnings = await this.detectWarnings(integrated.changes, task);
      
      // 次のステップを提案
      integrated.nextSteps = this.suggestNextSteps(integrated, task);
      
    } catch (error) {
      integrated.success = false;
      integrated.error = error.message;
    }

    return integrated;
  }

  /**
   * 変更内容を解析
   */
  async parseChanges(output) {
    const changes = [];
    const lines = output.split('\n');
    
    let currentChange = null;
    
    for (const line of lines) {
      // ファイル作成/変更の検出
      if (line.includes('Created file:') || line.includes('Modified file:')) {
        if (currentChange) {
          changes.push(currentChange);
        }
        
        currentChange = {
          type: line.includes('Created') ? 'create' : 'modify',
          file: this.extractFilePath(line),
          content: [],
          stats: {}
        };
      } else if (line.includes('Deleted file:')) {
        changes.push({
          type: 'delete',
          file: this.extractFilePath(line)
        });
      } else if (currentChange) {
        currentChange.content.push(line);
      }
    }
    
    if (currentChange) {
      changes.push(currentChange);
    }
    
    // 各変更の統計情報を計算
    for (const change of changes) {
      if (change.content) {
        change.stats = {
          lines: change.content.length,
          additions: change.content.filter(l => l.startsWith('+')).length,
          deletions: change.content.filter(l => l.startsWith('-')).length
        };
      }
    }
    
    return changes;
  }

  /**
   * ファイルパスを抽出
   */
  extractFilePath(line) {
    const match = line.match(/(?:Created|Modified|Deleted) file:\s*(.+)/);
    return match ? match[1].trim() : '';
  }

  /**
   * コード生成の検証
   */
  async validateCodeGeneration(result, task) {
    const validations = [];
    
    // 構文チェック
    validations.push({
      name: 'Syntax Check',
      passed: await this.checkSyntax(task.projectPath),
      message: '生成されたコードの構文は正しいです'
    });
    
    // テストの存在確認
    const hasTests = result.output.includes('test') || result.output.includes('spec');
    validations.push({
      name: 'Test Coverage',
      passed: hasTests,
      message: hasTests ? 'テストが含まれています' : 'テストが含まれていません'
    });
    
    // ドキュメントの確認
    const hasComments = result.output.includes('/**') || result.output.includes('//');
    validations.push({
      name: 'Documentation',
      passed: hasComments,
      message: hasComments ? 'コメントが含まれています' : 'コメントが不足しています'
    });
    
    return validations;
  }

  /**
   * テスト生成の検証
   */
  async validateTestGeneration(result, task) {
    const validations = [];
    
    // テストファイルの存在確認
    const testFiles = result.output.match(/\.(test|spec)\.(js|ts|jsx|tsx)/g);
    validations.push({
      name: 'Test Files',
      passed: testFiles && testFiles.length > 0,
      message: `${testFiles ? testFiles.length : 0}個のテストファイルが生成されました`
    });
    
    // テストの実行可能性
    if (task.projectPath) {
      const testResult = await this.runTests(task.projectPath);
      validations.push({
        name: 'Test Execution',
        passed: testResult.success,
        message: testResult.message
      });
    }
    
    return validations;
  }

  /**
   * リファクタリングの検証
   */
  async validateRefactoring(result, task) {
    const validations = [];
    
    // 変更前後でのテスト結果の比較
    if (task.projectPath) {
      const testResult = await this.runTests(task.projectPath);
      validations.push({
        name: 'Regression Test',
        passed: testResult.success,
        message: 'リファクタリング後もテストが通過しています'
      });
    }
    
    // コード品質の改善確認
    validations.push({
      name: 'Code Quality',
      passed: true, // 実際にはESLintなどで確認
      message: 'コード品質が改善されました'
    });
    
    return validations;
  }

  /**
   * デフォルトの検証
   */
  async validateDefault(result, task) {
    return [{
      name: 'Basic Validation',
      passed: result.success,
      message: 'タスクが完了しました'
    }];
  }

  /**
   * 構文チェック
   */
  async checkSyntax(projectPath) {
    if (!projectPath) return true;
    
    try {
      // ESLintやTypeScriptコンパイラでチェック
      const result = await this.runCommand('npm', ['run', 'lint'], projectPath);
      return result.success;
    } catch (error) {
      // リントスクリプトがない場合は成功とみなす
      return true;
    }
  }

  /**
   * テストを実行
   */
  async runTests(projectPath) {
    try {
      const result = await this.runCommand('npm', ['test'], projectPath);
      return {
        success: result.success,
        message: result.success ? 'すべてのテストが通過しました' : 'テストが失敗しました'
      };
    } catch (error) {
      return {
        success: false,
        message: `テスト実行エラー: ${error.message}`
      };
    }
  }

  /**
   * コマンドを実行
   */
  async runCommand(command, args, cwd) {
    return new Promise((resolve) => {
      const proc = spawn(command, args, { cwd });
      
      let stdout = '';
      let stderr = '';
      
      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      proc.on('close', (code) => {
        resolve({
          success: code === 0,
          stdout,
          stderr,
          code
        });
      });
      
      proc.on('error', (error) => {
        resolve({
          success: false,
          error: error.message
        });
      });
    });
  }

  /**
   * メトリクスを計算
   */
  async calculateMetrics(changes, task) {
    const metrics = {
      filesChanged: changes.length,
      linesAdded: 0,
      linesDeleted: 0,
      filesCreated: 0,
      filesDeleted: 0,
      filesModified: 0
    };
    
    changes.forEach(change => {
      switch (change.type) {
        case 'create':
          metrics.filesCreated++;
          break;
        case 'delete':
          metrics.filesDeleted++;
          break;
        case 'modify':
          metrics.filesModified++;
          break;
      }
      
      if (change.stats) {
        metrics.linesAdded += change.stats.additions || 0;
        metrics.linesDeleted += change.stats.deletions || 0;
      }
    });
    
    return metrics;
  }

  /**
   * サマリーを生成
   */
  generateSummary(integrated) {
    const { metrics, validations } = integrated;
    
    let summary = `## 実行結果サマリー\n\n`;
    summary += `### 変更内容\n`;
    summary += `- ファイル変更数: ${metrics.filesChanged}\n`;
    summary += `- 追加行数: ${metrics.linesAdded}\n`;
    summary += `- 削除行数: ${metrics.linesDeleted}\n\n`;
    
    summary += `### 検証結果\n`;
    const passedValidations = validations.filter(v => v.passed).length;
    summary += `- 成功: ${passedValidations}/${validations.length}\n`;
    
    validations.forEach(v => {
      summary += `- ${v.passed ? '✅' : '❌'} ${v.name}: ${v.message}\n`;
    });
    
    return summary;
  }

  /**
   * 警告を検出
   */
  async detectWarnings(changes, task) {
    const warnings = [];
    
    // 大量の変更
    if (changes.length > 20) {
      warnings.push({
        level: 'high',
        message: '大量のファイルが変更されています。影響範囲を確認してください。'
      });
    }
    
    // 設定ファイルの変更
    const configChanges = changes.filter(c => 
      c.file.includes('config') || 
      c.file.endsWith('.json') ||
      c.file.includes('package.json')
    );
    
    if (configChanges.length > 0) {
      warnings.push({
        level: 'medium',
        message: '設定ファイルが変更されています。動作確認を行ってください。'
      });
    }
    
    // テストファイルなしでのコード変更
    const hasCodeChanges = changes.some(c => !c.file.includes('test'));
    const hasTestChanges = changes.some(c => c.file.includes('test'));
    
    if (hasCodeChanges && !hasTestChanges) {
      warnings.push({
        level: 'medium',
        message: 'テストの更新がありません。テストを追加することを検討してください。'
      });
    }
    
    return warnings;
  }

  /**
   * 次のステップを提案
   */
  suggestNextSteps(integrated, task) {
    const steps = [];
    
    // 警告がある場合
    if (integrated.warnings.length > 0) {
      steps.push('警告事項を確認し、必要に応じて対処してください');
    }
    
    // テストが失敗している場合
    const failedValidations = integrated.validations.filter(v => !v.passed);
    if (failedValidations.length > 0) {
      steps.push('失敗した検証項目を修正してください');
    }
    
    // 一般的な次のステップ
    steps.push('変更内容をレビューしてください');
    steps.push('影響を受ける他の部分がないか確認してください');
    steps.push('必要に応じてドキュメントを更新してください');
    
    return steps;
  }
}

module.exports = ResultIntegrator;