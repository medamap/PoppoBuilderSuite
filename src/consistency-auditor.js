/**
 * 整合性監査エンジン
 * 要求定義、設計書、実装コードの整合性を自動的にチェックし、
 * 不整合を検出・報告する監査機能
 */

const fs = require('fs').promises;
const path = require('path');
const { glob } = require('glob');
const TraceabilityManager = require('./traceability-manager');
const Logger = require('./logger');

class ConsistencyAuditor {
  constructor() {
    this.logger = new Logger();
    this.traceability = new TraceabilityManager();
    this.requirementsPath = path.join(process.cwd(), 'docs', 'requirements');
    this.designPath = path.join(process.cwd(), 'docs', 'design');
    this.sourcePath = path.join(process.cwd(), 'src');
    this.testPath = path.join(process.cwd(), 'test');
    this.results = {
      score: 100,
      issues: [],
      suggestions: [],
      coverage: {
        requirements: { total: 0, covered: 0 },
        design: { total: 0, covered: 0 },
        implementation: { total: 0, covered: 0 },
        tests: { total: 0, covered: 0 }
      }
    };
  }

  /**
   * 監査を実行
   */
  async audit() {
    this.logger.info('整合性監査を開始します...');
    
    try {
      // トレーサビリティデータをロード
      await this.traceability.load();
      
      // 各種チェックを実行
      await this.checkRequirementsToDesign();
      await this.checkDesignToImplementation();
      await this.checkImplementationToTests();
      await this.checkTestCoverage();
      await this.checkDocumentationCompleteness();
      
      // スコアを計算
      this.calculateScore();
      
      // 改善提案を生成
      this.generateSuggestions();
      
      this.logger.info(`監査完了: スコア ${this.results.score}/100`);
      return this.results;
      
    } catch (error) {
      this.logger.error('監査中にエラーが発生しました:', error);
      throw error;
    }
  }

  /**
   * 要求定義と設計書の対応確認
   */
  async checkRequirementsToDesign() {
    this.logger.info('要求定義と設計書の対応を確認中...');
    
    // 要求定義ファイルを検索
    const requirementFiles = await glob('**/*.md', {
      cwd: this.requirementsPath,
      ignore: ['**/README.md', '**/*_en.md']
    });
    
    this.results.coverage.requirements.total = requirementFiles.length;
    
    // 各要求定義ファイルについて設計書との対応を確認
    for (const reqFile of requirementFiles) {
      const reqName = path.basename(reqFile, '.md');
      const hasDesign = await this.findCorrespondingDesign(reqName);
      
      if (!hasDesign) {
        this.results.issues.push({
          type: 'MISSING_DESIGN',
          severity: 'HIGH',
          requirement: reqFile,
          message: `要求定義 '${reqFile}' に対応する設計書が見つかりません`
        });
      } else {
        this.results.coverage.requirements.covered++;
      }
      
      // トレーサビリティでの関連確認
      const items = Object.values(this.traceability.data.items || {});
      const reqItems = items.filter(item => 
        item.phase === 'REQ' && item.title.includes(reqName)
      );
      
      for (const reqItem of reqItems) {
        const hasSpec = this.hasLinkedPhase(reqItem.id, 'SPEC');
        const hasHLD = this.hasLinkedPhase(reqItem.id, 'HLD');
        
        if (!hasSpec && !hasHLD) {
          this.results.issues.push({
            type: 'MISSING_TRACEABILITY',
            severity: 'MEDIUM',
            requirement: reqItem.id,
            message: `要求 ${reqItem.id} に設計へのリンクがありません`
          });
        }
      }
    }
  }

  /**
   * 設計書と実装コードの一致検証
   */
  async checkDesignToImplementation() {
    this.logger.info('設計書と実装コードの一致を検証中...');
    
    const designFiles = await glob('**/*.md', {
      cwd: this.designPath,
      ignore: ['**/README.md', '**/*_en.md']
    });
    
    this.results.coverage.design.total = designFiles.length;
    
    for (const designFile of designFiles) {
      const designName = path.basename(designFile, '.md');
      const hasImplementation = await this.findCorrespondingImplementation(designName);
      
      if (!hasImplementation) {
        // 一部の設計書は実装が不要な場合もあるので、severityを調整
        const severity = designName.includes('plan') || designName.includes('guide') ? 'LOW' : 'MEDIUM';
        this.results.issues.push({
          type: 'MISSING_IMPLEMENTATION',
          severity: severity,
          design: designFile,
          message: `設計書 '${designFile}' に対応する実装が見つかりません`
        });
      } else {
        this.results.coverage.design.covered++;
      }
    }
    
    // トレーサビリティでの確認
    const items = Object.values(this.traceability.data.items || {});
    const designItems = items.filter(item => 
      ['SPEC', 'HLD', 'DLD'].includes(item.phase)
    );
    
    for (const designItem of designItems) {
      const hasImpl = this.hasLinkedPhase(designItem.id, 'IMP');
      
      if (!hasImpl && !designItem.title.includes('将来') && !designItem.title.includes('拡張')) {
        this.results.issues.push({
          type: 'UNIMPLEMENTED_DESIGN',
          severity: 'HIGH',
          design: designItem.id,
          message: `設計 ${designItem.id} が実装されていません`
        });
      }
    }
  }

  /**
   * 実装とテストの対応確認
   */
  async checkImplementationToTests() {
    this.logger.info('実装とテストの対応を確認中...');
    
    const sourceFiles = await glob('**/*.js', {
      cwd: this.sourcePath,
      ignore: ['**/node_modules/**', '**/test/**']
    });
    
    this.results.coverage.implementation.total = sourceFiles.length;
    
    for (const sourceFile of sourceFiles) {
      const moduleName = path.basename(sourceFile, '.js');
      const hasTest = await this.findCorrespondingTest(moduleName);
      
      if (!hasTest) {
        // 一部のファイルはテストが不要な場合もある
        const severity = moduleName.includes('config') || moduleName.includes('index') ? 'LOW' : 'HIGH';
        this.results.issues.push({
          type: 'MISSING_TEST',
          severity: severity,
          implementation: sourceFile,
          message: `実装 '${sourceFile}' に対応するテストが見つかりません`
        });
      } else {
        this.results.coverage.implementation.covered++;
      }
    }
    
    // トレーサビリティでの確認
    const items = Object.values(this.traceability.data.items || {});
    const implItems = items.filter(item => item.phase === 'IMP');
    
    for (const implItem of implItems) {
      const hasTest = this.hasLinkedPhase(implItem.id, 'TEST');
      
      if (!hasTest) {
        this.results.issues.push({
          type: 'UNTESTED_IMPLEMENTATION',
          severity: 'HIGH',
          implementation: implItem.id,
          message: `実装 ${implItem.id} にテストがありません`
        });
      }
    }
  }

  /**
   * テストカバレッジの確認
   */
  async checkTestCoverage() {
    this.logger.info('テストカバレッジを確認中...');
    
    const testFiles = await glob('**/*.js', {
      cwd: this.testPath,
      ignore: ['**/node_modules/**']
    });
    
    this.results.coverage.tests.total = testFiles.length;
    
    // テストファイルが存在し、実装に対応しているものをカウント
    for (const testFile of testFiles) {
      const testName = path.basename(testFile, '.js').replace(/^test-/, '');
      const hasCorrespondingSource = await this.findSourceForTest(testName);
      
      if (hasCorrespondingSource) {
        this.results.coverage.tests.covered++;
      } else {
        this.results.issues.push({
          type: 'ORPHAN_TEST',
          severity: 'LOW',
          test: testFile,
          message: `テスト '${testFile}' に対応する実装が見つかりません`
        });
      }
    }
  }

  /**
   * ドキュメントの完全性チェック
   */
  async checkDocumentationCompleteness() {
    this.logger.info('ドキュメントの完全性を確認中...');
    
    // 主要な機能に対してドキュメントが存在するか確認
    const mainFeatures = [
      'traceability',
      'error-log-collection',
      'notification',
      'multi-project',
      'agent'
    ];
    
    for (const feature of mainFeatures) {
      const hasRequirement = await this.hasDocument(this.requirementsPath, feature);
      const hasDesign = await this.hasDocument(this.designPath, feature);
      const hasGuide = await this.hasDocument(path.join(process.cwd(), 'docs', 'guides'), feature);
      
      if (!hasRequirement) {
        this.results.issues.push({
          type: 'MISSING_REQUIREMENT',
          severity: 'MEDIUM',
          feature: feature,
          message: `機能 '${feature}' の要求定義が見つかりません`
        });
      }
      
      if (!hasDesign && feature !== 'agent') { // agentは設計書が分散している
        this.results.issues.push({
          type: 'MISSING_DESIGN_DOC',
          severity: 'MEDIUM',
          feature: feature,
          message: `機能 '${feature}' の設計書が見つかりません`
        });
      }
      
      if (!hasGuide && ['traceability', 'notification', 'multi-project'].includes(feature)) {
        this.results.issues.push({
          type: 'MISSING_GUIDE',
          severity: 'LOW',
          feature: feature,
          message: `機能 '${feature}' の使用ガイドが見つかりません`
        });
      }
    }
  }

  /**
   * スコアを計算
   */
  calculateScore() {
    let deduction = 0;
    
    for (const issue of this.results.issues) {
      switch (issue.severity) {
        case 'CRITICAL':
          deduction += 10;
          break;
        case 'HIGH':
          deduction += 5;
          break;
        case 'MEDIUM':
          deduction += 3;
          break;
        case 'LOW':
          deduction += 1;
          break;
      }
    }
    
    // カバレッジも考慮
    const reqCoverage = this.results.coverage.requirements.total > 0 
      ? this.results.coverage.requirements.covered / this.results.coverage.requirements.total 
      : 1;
    const designCoverage = this.results.coverage.design.total > 0
      ? this.results.coverage.design.covered / this.results.coverage.design.total
      : 1;
    const implCoverage = this.results.coverage.implementation.total > 0
      ? this.results.coverage.implementation.covered / this.results.coverage.implementation.total
      : 1;
    const testCoverage = this.results.coverage.tests.total > 0
      ? this.results.coverage.tests.covered / this.results.coverage.tests.total
      : 1;
    
    const avgCoverage = (reqCoverage + designCoverage + implCoverage + testCoverage) / 4;
    const coverageScore = Math.round(avgCoverage * 100);
    
    this.results.score = Math.max(0, Math.min(100, coverageScore - deduction));
  }

  /**
   * 改善提案を生成
   */
  generateSuggestions() {
    const issuesByType = {};
    
    // 問題をタイプ別に分類
    for (const issue of this.results.issues) {
      if (!issuesByType[issue.type]) {
        issuesByType[issue.type] = [];
      }
      issuesByType[issue.type].push(issue);
    }
    
    // タイプ別に提案を生成
    if (issuesByType.MISSING_DESIGN) {
      this.results.suggestions.push({
        priority: 'HIGH',
        action: 'CREATE_DESIGN_DOCS',
        title: '設計書の作成',
        description: `${issuesByType.MISSING_DESIGN.length}個の要求定義に対する設計書が不足しています。`,
        files: issuesByType.MISSING_DESIGN.map(i => i.requirement)
      });
    }
    
    if (issuesByType.MISSING_TEST || issuesByType.UNTESTED_IMPLEMENTATION) {
      const count = (issuesByType.MISSING_TEST?.length || 0) + (issuesByType.UNTESTED_IMPLEMENTATION?.length || 0);
      this.results.suggestions.push({
        priority: 'HIGH',
        action: 'CREATE_TESTS',
        title: 'テストの作成',
        description: `${count}個の実装に対するテストが不足しています。`,
        files: [
          ...(issuesByType.MISSING_TEST?.map(i => i.implementation) || []),
          ...(issuesByType.UNTESTED_IMPLEMENTATION?.map(i => i.implementation) || [])
        ]
      });
    }
    
    if (issuesByType.MISSING_TRACEABILITY || issuesByType.UNIMPLEMENTED_DESIGN) {
      this.results.suggestions.push({
        priority: 'MEDIUM',
        action: 'UPDATE_TRACEABILITY',
        title: 'トレーサビリティの更新',
        description: 'トレーサビリティリンクが不完全です。要求-設計-実装-テストの関連を明確にしてください。',
        items: [
          ...(issuesByType.MISSING_TRACEABILITY?.map(i => i.requirement) || []),
          ...(issuesByType.UNIMPLEMENTED_DESIGN?.map(i => i.design) || [])
        ]
      });
    }
    
    if (issuesByType.ORPHAN_TEST) {
      this.results.suggestions.push({
        priority: 'LOW',
        action: 'CLEANUP_TESTS',
        title: '不要なテストの整理',
        description: `${issuesByType.ORPHAN_TEST.length}個のテストが対応する実装を持ちません。`,
        files: issuesByType.ORPHAN_TEST.map(i => i.test)
      });
    }
    
    // 全体的な改善提案
    if (this.results.score < 80) {
      this.results.suggestions.push({
        priority: 'HIGH',
        action: 'COMPREHENSIVE_REVIEW',
        title: '包括的なレビューの実施',
        description: '整合性スコアが低いため、要求定義から実装までの全体的なレビューを推奨します。'
      });
    }
  }

  /**
   * ヘルパーメソッド群
   */
  async findCorrespondingDesign(requirementName) {
    const designVariants = [
      requirementName,
      requirementName.replace('-requirements', '-design'),
      requirementName.replace('-requirements', '-hld'),
      requirementName.replace('-requirements', '-dld')
    ];
    
    for (const variant of designVariants) {
      try {
        await fs.access(path.join(this.designPath, `${variant}.md`));
        return true;
      } catch {}
    }
    return false;
  }

  async findCorrespondingImplementation(designName) {
    const implVariants = [
      designName.replace('-design', ''),
      designName.replace('-hld', ''),
      designName.replace('-dld', ''),
      designName
    ];
    
    for (const variant of implVariants) {
      const files = await glob(`**/*${variant}*.js`, {
        cwd: this.sourcePath,
        ignore: ['**/test/**']
      });
      if (files.length > 0) return true;
    }
    return false;
  }

  async findCorrespondingTest(moduleName) {
    const testVariants = [
      `test-${moduleName}`,
      `${moduleName}.test`,
      `${moduleName}.spec`,
      moduleName
    ];
    
    for (const variant of testVariants) {
      try {
        await fs.access(path.join(this.testPath, `${variant}.js`));
        return true;
      } catch {}
    }
    return false;
  }

  async findSourceForTest(testName) {
    const sourceVariants = [
      testName,
      testName.replace('test-', ''),
      testName.replace('.test', ''),
      testName.replace('.spec', '')
    ];
    
    for (const variant of sourceVariants) {
      const files = await glob(`**/${variant}.js`, {
        cwd: this.sourcePath,
        ignore: ['**/test/**']
      });
      if (files.length > 0) return true;
    }
    return false;
  }

  async hasDocument(basePath, feature) {
    const files = await glob(`**/*${feature}*.md`, {
      cwd: basePath,
      ignore: ['**/README.md']
    });
    return files.length > 0;
  }

  hasLinkedPhase(itemId, targetPhase) {
    const items = this.traceability.data.items || {};
    const item = items[itemId];
    if (!item) return false;
    
    // 直接リンクを確認
    for (const linkType of Object.keys(item.links)) {
      for (const linkedId of item.links[linkType]) {
        const linkedItem = items[linkedId];
        if (linkedItem && linkedItem.phase === targetPhase) {
          return true;
        }
      }
    }
    
    // 間接リンクも確認（1階層のみ）
    for (const linkType of Object.keys(item.links)) {
      for (const linkedId of item.links[linkType]) {
        const linkedItem = items[linkedId];
        if (linkedItem) {
          for (const subLinkType of Object.keys(linkedItem.links)) {
            for (const subLinkedId of linkedItem.links[subLinkType]) {
              const subLinkedItem = items[subLinkedId];
              if (subLinkedItem && subLinkedItem.phase === targetPhase) {
                return true;
              }
            }
          }
        }
      }
    }
    
    return false;
  }

  /**
   * レポートを生成
   */
  async generateReport(outputPath = 'consistency-audit-report.md') {
    const report = [];
    
    report.push('# 整合性監査レポート');
    report.push(`生成日時: ${new Date().toLocaleString('ja-JP')}\n`);
    
    report.push(`## 総合スコア: ${this.results.score}/100\n`);
    
    report.push('## カバレッジ');
    report.push(`- 要求定義: ${this.results.coverage.requirements.covered}/${this.results.coverage.requirements.total} (${Math.round(this.results.coverage.requirements.covered / this.results.coverage.requirements.total * 100)}%)`);
    report.push(`- 設計書: ${this.results.coverage.design.covered}/${this.results.coverage.design.total} (${Math.round(this.results.coverage.design.covered / this.results.coverage.design.total * 100)}%)`);
    report.push(`- 実装: ${this.results.coverage.implementation.covered}/${this.results.coverage.implementation.total} (${Math.round(this.results.coverage.implementation.covered / this.results.coverage.implementation.total * 100)}%)`);
    report.push(`- テスト: ${this.results.coverage.tests.covered}/${this.results.coverage.tests.total} (${Math.round(this.results.coverage.tests.covered / this.results.coverage.tests.total * 100)}%)\n`);
    
    if (this.results.issues.length > 0) {
      report.push('## 検出された問題');
      
      const issuesBySeverity = {
        CRITICAL: [],
        HIGH: [],
        MEDIUM: [],
        LOW: []
      };
      
      for (const issue of this.results.issues) {
        issuesBySeverity[issue.severity].push(issue);
      }
      
      for (const severity of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']) {
        if (issuesBySeverity[severity].length > 0) {
          report.push(`\n### ${severity} (${issuesBySeverity[severity].length}件)`);
          for (const issue of issuesBySeverity[severity]) {
            report.push(`- **${issue.type}**: ${issue.message}`);
          }
        }
      }
    }
    
    if (this.results.suggestions.length > 0) {
      report.push('\n## 改善提案');
      
      const suggestionsByPriority = {
        HIGH: [],
        MEDIUM: [],
        LOW: []
      };
      
      for (const suggestion of this.results.suggestions) {
        suggestionsByPriority[suggestion.priority].push(suggestion);
      }
      
      for (const priority of ['HIGH', 'MEDIUM', 'LOW']) {
        if (suggestionsByPriority[priority].length > 0) {
          report.push(`\n### 優先度: ${priority}`);
          for (const suggestion of suggestionsByPriority[priority]) {
            report.push(`\n#### ${suggestion.title}`);
            report.push(suggestion.description);
            if (suggestion.files) {
              report.push('対象ファイル:');
              for (const file of suggestion.files) {
                report.push(`- ${file}`);
              }
            }
            if (suggestion.items) {
              report.push('対象アイテム:');
              for (const item of suggestion.items) {
                report.push(`- ${item}`);
              }
            }
          }
        }
      }
    }
    
    report.push('\n## 次のステップ');
    report.push('1. HIGH優先度の問題から順に対処してください');
    report.push('2. トレーサビリティの更新を行い、すべてのフェーズ間の関連を明確にしてください');
    report.push('3. テストカバレッジを向上させ、すべての重要な機能にテストを追加してください');
    report.push('4. ドキュメントを最新の状態に保ち、実装との整合性を維持してください');
    
    await fs.writeFile(outputPath, report.join('\n'), 'utf8');
    this.logger.info(`監査レポートを生成しました: ${outputPath}`);
    
    return outputPath;
  }
}

module.exports = ConsistencyAuditor;