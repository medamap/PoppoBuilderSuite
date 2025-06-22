#!/usr/bin/env node
/**
 * Issue #109: Claude API呼び出しの洗い出しと調査
 * 
 * PoppoBuilderのコードベースからClaude API呼び出し箇所を特定し、
 * 詳細なレポートを生成する調査スクリプト
 */

const fs = require('fs').promises;
const path = require('path');
const { glob } = require('glob');

class ClaudeAPIInvestigator {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.findings = {
      directAPICalls: [],
      claudeCLICalls: [],
      suspiciousPatterns: [],
      configurationReferences: [],
      libraryUsage: [],
      summary: {}
    };
    this.excludeDirs = [
      'node_modules',
      '.git',
      'backups',
      'temp',
      'logs',
      'reports'
    ];
  }

  /**
   * 調査実行
   */
  async investigate() {
    console.log('🔍 Claude API呼び出し調査開始...');
    
    // 1. ファイルの収集
    const files = await this.collectFiles();
    console.log(`📂 対象ファイル数: ${files.length}`);
    
    // 2. ファイル内容の解析
    let processedCount = 0;
    for (const file of files) {
      await this.analyzeFile(file);
      processedCount++;
      
      if (processedCount % 50 === 0) {
        console.log(`⏳ 処理中... ${processedCount}/${files.length}`);
      }
    }
    
    // 3. package.json の依存関係チェック
    await this.analyzeDependencies();
    
    // 4. 設定ファイルの分析
    await this.analyzeConfigurations();
    
    // 5. サマリー生成
    this.generateSummary();
    
    console.log('✅ 調査完了');
    return this.findings;
  }

  /**
   * 対象ファイルの収集
   */
  async collectFiles() {
    const patterns = [
      '**/*.js',
      '**/*.ts',
      '**/*.json',
      '**/*.md',
      '**/*.sh'
    ];
    
    const files = [];
    
    for (const pattern of patterns) {
      try {
        const matches = await glob(pattern, {
          cwd: this.projectRoot,
          ignore: this.excludeDirs.map(dir => `${dir}/**`),
          absolute: true
        });
        files.push(...matches);
      } catch (error) {
        console.warn(`⚠️ パターン ${pattern} の処理でエラー:`, error.message);
      }
    }
    
    // 重複除去
    return [...new Set(files)];
  }

  /**
   * ファイル内容の解析
   */
  async analyzeFile(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const relativePath = path.relative(this.projectRoot, filePath);
      
      // 各種パターンをチェック
      this.checkDirectAPICalls(content, relativePath);
      this.checkClaudeCLICalls(content, relativePath);
      this.checkSuspiciousPatterns(content, relativePath);
      this.checkConfigurationReferences(content, relativePath);
      
    } catch (error) {
      // バイナリファイルなどは無視
      if (error.code !== 'EISDIR') {
        console.warn(`⚠️ ファイル読み込みエラー ${filePath}:`, error.message);
      }
    }
  }

  /**
   * 直接的なClaude API呼び出しをチェック
   */
  checkDirectAPICalls(content, filePath) {
    const patterns = [
      // Anthropic公式SDKパターン
      {
        pattern: /anthropic.*\.messages\.create/gi,
        type: 'Anthropic SDK - messages.create',
        severity: 'HIGH'
      },
      {
        pattern: /anthropic.*\.completions\.create/gi,
        type: 'Anthropic SDK - completions.create',
        severity: 'HIGH'
      },
      {
        pattern: /new\s+anthropic\s*\(/gi,
        type: 'Anthropic SDK Constructor',
        severity: 'HIGH'
      },
      
      // HTTP直接呼び出し
      {
        pattern: /https?:\/\/api\.anthropic\.com/gi,
        type: 'Direct API URL',
        severity: 'CRITICAL'
      },
      {
        pattern: /fetch.*anthropic|axios.*anthropic|request.*anthropic/gi,
        type: 'HTTP Client to Anthropic',
        severity: 'HIGH'
      },
      
      // APIキーパターン
      {
        pattern: /sk-ant-[a-zA-Z0-9\-_]+/gi,
        type: 'Anthropic API Key',
        severity: 'CRITICAL'
      },
      {
        pattern: /ANTHROPIC_API_KEY|CLAUDE_API_KEY/gi,
        type: 'API Key Environment Variable',
        severity: 'MEDIUM'
      }
    ];

    patterns.forEach(({ pattern, type, severity }) => {
      const matches = content.match(pattern);
      if (matches) {
        matches.forEach(match => {
          const lines = content.split('\n');
          const lineNumber = this.findLineNumber(content, match);
          
          this.findings.directAPICalls.push({
            file: filePath,
            line: lineNumber,
            match: match.substring(0, 100), // 最初の100文字のみ
            type,
            severity,
            context: this.getContextLines(lines, lineNumber - 1, 2)
          });
        });
      }
    });
  }

  /**
   * Claude CLI呼び出しをチェック
   */
  checkClaudeCLICalls(content, filePath) {
    const patterns = [
      {
        pattern: /spawn.*['"`]claude['"`]|exec.*['"`]claude['"`]/gi,
        type: 'Claude CLI Spawn/Exec',
        purpose: 'ALLOWED' // Claude CLIは許可されている
      },
      {
        pattern: /claude\s+--\w+|claude\s+\w+/gi,
        type: 'Claude CLI Command',
        purpose: 'ALLOWED'
      },
      {
        pattern: /\.claude|\/claude\b/gi,
        type: 'Claude CLI Path Reference',
        purpose: 'ALLOWED'
      }
    ];

    patterns.forEach(({ pattern, type, purpose }) => {
      const matches = content.match(pattern);
      if (matches) {
        matches.forEach(match => {
          const lineNumber = this.findLineNumber(content, match);
          const lines = content.split('\n');
          
          this.findings.claudeCLICalls.push({
            file: filePath,
            line: lineNumber,
            match: match.substring(0, 100),
            type,
            purpose,
            context: this.getContextLines(lines, lineNumber - 1, 2)
          });
        });
      }
    });
  }

  /**
   * 疑わしいパターンをチェック
   */
  checkSuspiciousPatterns(content, filePath) {
    const patterns = [
      {
        pattern: /claude.*api|api.*claude/gi,
        type: 'Claude API Reference',
        risk: 'MEDIUM'
      },
      {
        pattern: /anthropic.*api|api.*anthropic/gi,
        type: 'Anthropic API Reference',
        risk: 'MEDIUM'
      },
      {
        pattern: /claude.*request|request.*claude/gi,
        type: 'Claude Request Pattern',
        risk: 'LOW'
      },
      {
        pattern: /claude.*response|response.*claude/gi,
        type: 'Claude Response Pattern',
        risk: 'LOW'
      },
      {
        pattern: /messages.*create|create.*messages/gi,
        type: 'Messages Create Pattern',
        risk: 'MEDIUM'
      }
    ];

    patterns.forEach(({ pattern, type, risk }) => {
      const matches = content.match(pattern);
      if (matches) {
        matches.forEach(match => {
          const lineNumber = this.findLineNumber(content, match);
          const lines = content.split('\n');
          
          this.findings.suspiciousPatterns.push({
            file: filePath,
            line: lineNumber,
            match: match.substring(0, 100),
            type,
            risk,
            context: this.getContextLines(lines, lineNumber - 1, 1)
          });
        });
      }
    });
  }

  /**
   * 設定ファイル内の参照をチェック
   */
  checkConfigurationReferences(content, filePath) {
    if (filePath.includes('config') || filePath.endsWith('.json') || filePath.endsWith('.env')) {
      const patterns = [
        {
          pattern: /["']claude["']|["']anthropic["']/gi,
          type: 'Configuration Key'
        },
        {
          pattern: /api.*key|key.*api/gi,
          type: 'API Key Configuration'
        },
        {
          pattern: /endpoint|url|host/gi,
          type: 'Endpoint Configuration'
        }
      ];

      patterns.forEach(({ pattern, type }) => {
        const matches = content.match(pattern);
        if (matches) {
          matches.forEach(match => {
            const lineNumber = this.findLineNumber(content, match);
            const lines = content.split('\n');
            
            this.findings.configurationReferences.push({
              file: filePath,
              line: lineNumber,
              match: match.substring(0, 100),
              type,
              context: this.getContextLines(lines, lineNumber - 1, 1)
            });
          });
        }
      });
    }
  }

  /**
   * 依存関係の分析
   */
  async analyzeDependencies() {
    const packageJsonPath = path.join(this.projectRoot, 'package.json');
    
    try {
      const packageContent = await fs.readFile(packageJsonPath, 'utf8');
      const packageData = JSON.parse(packageContent);
      
      const dependencies = {
        ...packageData.dependencies || {},
        ...packageData.devDependencies || {}
      };
      
      // Claude/Anthropic関連ライブラリをチェック
      const claudeLibraries = [
        '@anthropic-ai/sdk',
        'anthropic',
        'claude-ai',
        'claude-api',
        'openai' // 互換性チェック
      ];
      
      claudeLibraries.forEach(lib => {
        if (dependencies[lib]) {
          this.findings.libraryUsage.push({
            library: lib,
            version: dependencies[lib],
            type: 'dependency',
            risk: lib.includes('anthropic') || lib.includes('claude') ? 'HIGH' : 'MEDIUM'
          });
        }
      });
      
    } catch (error) {
      console.warn('⚠️ package.json の読み込みに失敗:', error.message);
    }
  }

  /**
   * 設定ファイルの分析
   */
  async analyzeConfigurations() {
    const configFiles = [
      'config/config.json',
      '.env',
      '.env.local',
      'config/defaults.json'
    ];
    
    for (const configFile of configFiles) {
      const configPath = path.join(this.projectRoot, configFile);
      
      try {
        const configContent = await fs.readFile(configPath, 'utf8');
        
        // API関連設定をチェック
        if (configContent.includes('claude') || configContent.includes('anthropic')) {
          this.findings.configurationReferences.push({
            file: configFile,
            type: 'Configuration File',
            hasClaudeConfig: true,
            size: configContent.length
          });
        }
        
      } catch (error) {
        // ファイルが存在しない場合は無視
      }
    }
  }

  /**
   * 行番号の検索
   */
  findLineNumber(content, searchText) {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(searchText.substring(0, 50))) {
        return i + 1;
      }
    }
    return 1;
  }

  /**
   * コンテキスト行の取得
   */
  getContextLines(lines, centerLine, radius) {
    const start = Math.max(0, centerLine - radius);
    const end = Math.min(lines.length, centerLine + radius + 1);
    
    return lines.slice(start, end).map((line, index) => ({
      lineNumber: start + index + 1,
      content: line.trim()
    }));
  }

  /**
   * サマリー生成
   */
  generateSummary() {
    this.findings.summary = {
      totalFilesAnalyzed: this.findings.directAPICalls.length + 
                         this.findings.claudeCLICalls.length + 
                         this.findings.suspiciousPatterns.length,
      criticalIssues: this.findings.directAPICalls.filter(call => call.severity === 'CRITICAL').length,
      highRiskIssues: this.findings.directAPICalls.filter(call => call.severity === 'HIGH').length,
      mediumRiskIssues: this.findings.directAPICalls.filter(call => call.severity === 'MEDIUM').length,
      claudeCLIUsage: this.findings.claudeCLICalls.length,
      suspiciousPatterns: this.findings.suspiciousPatterns.length,
      librariesFound: this.findings.libraryUsage.length,
      
      // リスク評価
      riskLevel: this.calculateRiskLevel(),
      recommendations: this.generateRecommendations()
    };
  }

  /**
   * リスクレベル計算
   */
  calculateRiskLevel() {
    const critical = this.findings.directAPICalls.filter(call => call.severity === 'CRITICAL').length;
    const high = this.findings.directAPICalls.filter(call => call.severity === 'HIGH').length;
    const libraries = this.findings.libraryUsage.filter(lib => lib.risk === 'HIGH').length;
    
    if (critical > 0 || libraries > 0) return 'CRITICAL';
    if (high > 3) return 'HIGH';
    if (high > 0) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * 推奨事項生成
   */
  generateRecommendations() {
    const recommendations = [];
    
    if (this.findings.directAPICalls.some(call => call.severity === 'CRITICAL')) {
      recommendations.push('直接的なClaude API呼び出しが発見されました。即座に削除または無効化してください。');
    }
    
    if (this.findings.libraryUsage.some(lib => lib.risk === 'HIGH')) {
      recommendations.push('Anthropic/Claude関連ライブラリの使用が発見されました。package.jsonから削除してください。');
    }
    
    if (this.findings.directAPICalls.some(call => call.severity === 'HIGH')) {
      recommendations.push('高リスクのAPI呼び出しパターンが見つかりました。CCSP経由に移行してください。');
    }
    
    if (this.findings.claudeCLICalls.length > 0) {
      recommendations.push('Claude CLIの使用は適切です。引き続きClaude Codeの機能のみを使用してください。');
    }
    
    if (recommendations.length === 0) {
      recommendations.push('不適切なClaude API使用は発見されませんでした。現在の実装は適切です。');
    }
    
    return recommendations;
  }

  /**
   * レポート生成
   */
  async generateReport() {
    const timestamp = new Date().toISOString();
    const reportData = {
      investigationInfo: {
        timestamp,
        projectRoot: this.projectRoot,
        investigatorVersion: '1.0.0'
      },
      ...this.findings
    };

    // JSONレポート
    const jsonReportPath = path.join(this.projectRoot, 'reports', `claude-api-investigation-${Date.now()}.json`);
    await fs.mkdir(path.dirname(jsonReportPath), { recursive: true });
    await fs.writeFile(jsonReportPath, JSON.stringify(reportData, null, 2));

    // Markdownレポート
    const markdownReport = this.generateMarkdownReport(reportData);
    const markdownReportPath = path.join(this.projectRoot, 'reports', `claude-api-investigation-${Date.now()}.md`);
    await fs.writeFile(markdownReportPath, markdownReport);

    console.log(`📄 レポート生成完了:`);
    console.log(`  JSON: ${jsonReportPath}`);
    console.log(`  Markdown: ${markdownReportPath}`);

    return { jsonReportPath, markdownReportPath, data: reportData };
  }

  /**
   * Markdownレポート生成
   */
  generateMarkdownReport(data) {
    return `# Claude API呼び出し調査レポート

## 📊 調査概要

- **調査日時**: ${data.investigationInfo.timestamp}
- **対象プロジェクト**: ${data.investigationInfo.projectRoot}
- **総合リスクレベル**: **${data.summary.riskLevel}**

## 🎯 調査結果サマリー

| 項目 | 件数 |
|------|------|
| 🚨 重要度: CRITICAL | ${data.summary.criticalIssues} |
| ⚠️ 重要度: HIGH | ${data.summary.highRiskIssues} |
| 📝 重要度: MEDIUM | ${data.summary.mediumRiskIssues} |
| ✅ Claude CLI使用 | ${data.summary.claudeCLIUsage} |
| 🔍 疑わしいパターン | ${data.summary.suspiciousPatterns} |
| 📦 関連ライブラリ | ${data.summary.librariesFound} |

## 🚨 直接的なClaude API呼び出し

${data.directAPICalls.length > 0 ? 
  data.directAPICalls.map(call => `
### ${call.type} (${call.severity})
- **ファイル**: \`${call.file}\`
- **行番号**: ${call.line}
- **内容**: \`${call.match}\`
- **コンテキスト**:
\`\`\`
${call.context.map(ctx => `${ctx.lineNumber}: ${ctx.content}`).join('\n')}
\`\`\`
`).join('') :
  '✅ 直接的なClaude API呼び出しは発見されませんでした。'
}

## ✅ Claude CLI使用箇所

${data.claudeCLICalls.length > 0 ?
  data.claudeCLICalls.slice(0, 10).map(call => `
- **ファイル**: \`${call.file}\` (行: ${call.line})
- **タイプ**: ${call.type}
- **内容**: \`${call.match}\`
`).join('') + (data.claudeCLICalls.length > 10 ? `\n\n... 他 ${data.claudeCLICalls.length - 10} 件` : '') :
  '📝 Claude CLI使用箇所は見つかりませんでした。'
}

## 📦 依存関係ライブラリ

${data.libraryUsage.length > 0 ?
  data.libraryUsage.map(lib => `
- **ライブラリ**: \`${lib.library}\`
- **バージョン**: ${lib.version}
- **リスク**: ${lib.risk}
`).join('') :
  '✅ Claude/Anthropic関連ライブラリは見つかりませんでした。'
}

## 🔍 疑わしいパターン

${data.suspiciousPatterns.length > 0 ?
  data.suspiciousPatterns.slice(0, 20).map(pattern => `
- **ファイル**: \`${pattern.file}\` (行: ${pattern.line})
- **タイプ**: ${pattern.type}
- **リスク**: ${pattern.risk}
- **内容**: \`${pattern.match}\`
`).join('') + (data.suspiciousPatterns.length > 20 ? `\n\n... 他 ${data.suspiciousPatterns.length - 20} 件` : '') :
  '✅ 疑わしいパターンは見つかりませんでした。'
}

## 💡 推奨事項

${data.summary.recommendations.map(rec => `- ${rec}`).join('\n')}

## 📋 詳細分析

### ファイル別分析結果

${this.generateFileAnalysis(data)}

---
*調査完了時刻: ${data.investigationInfo.timestamp}*
*調査ツールバージョン: ${data.investigationInfo.investigatorVersion}*
`;
  }

  /**
   * ファイル別分析生成
   */
  generateFileAnalysis(data) {
    const fileMap = new Map();
    
    // すべての発見事項をファイル別に集計
    [...data.directAPICalls, ...data.claudeCLICalls, ...data.suspiciousPatterns]
      .forEach(item => {
        if (!fileMap.has(item.file)) {
          fileMap.set(item.file, []);
        }
        fileMap.get(item.file).push(item);
      });
    
    if (fileMap.size === 0) {
      return 'すべてのファイルが適切に実装されています。';
    }
    
    return Array.from(fileMap.entries())
      .slice(0, 10) // 上位10ファイルのみ表示
      .map(([file, items]) => `
#### \`${file}\`
- 発見事項: ${items.length}件
- 最高リスク: ${this.getHighestRisk(items)}
`).join('') + (fileMap.size > 10 ? `\n\n... 他 ${fileMap.size - 10} ファイル` : '');
  }

  /**
   * 最高リスクレベル取得
   */
  getHighestRisk(items) {
    const risks = items.map(item => item.severity || item.risk || 'LOW');
    if (risks.includes('CRITICAL')) return 'CRITICAL';
    if (risks.includes('HIGH')) return 'HIGH';
    if (risks.includes('MEDIUM')) return 'MEDIUM';
    return 'LOW';
  }
}

// メイン実行
async function main() {
  const projectRoot = process.cwd();
  const investigator = new ClaudeAPIInvestigator(projectRoot);
  
  try {
    console.log('🔍 Claude API調査ツール v1.0.0');
    console.log(`📁 対象プロジェクト: ${projectRoot}`);
    console.log('');
    
    // 調査実行
    await investigator.investigate();
    
    // レポート生成
    const report = await investigator.generateReport();
    
    // サマリー表示
    console.log('\n📊 調査結果サマリー:');
    console.log(`🚨 重要度CRITICAL: ${report.data.summary.criticalIssues}件`);
    console.log(`⚠️ 重要度HIGH: ${report.data.summary.highRiskIssues}件`);
    console.log(`📝 重要度MEDIUM: ${report.data.summary.mediumRiskIssues}件`);
    console.log(`✅ Claude CLI使用: ${report.data.summary.claudeCLIUsage}件`);
    console.log(`📦 関連ライブラリ: ${report.data.summary.librariesFound}件`);
    console.log(`🎯 総合リスク: ${report.data.summary.riskLevel}`);
    
    console.log('\n💡 主な推奨事項:');
    report.data.summary.recommendations.forEach(rec => {
      console.log(`  - ${rec}`);
    });
    
    // 終了コード
    const riskLevel = report.data.summary.riskLevel;
    process.exit(riskLevel === 'CRITICAL' || riskLevel === 'HIGH' ? 1 : 0);
    
  } catch (error) {
    console.error('❌ 調査中にエラーが発生しました:', error);
    process.exit(1);
  }
}

// スクリプトとして実行された場合
if (require.main === module) {
  main();
}

module.exports = ClaudeAPIInvestigator;