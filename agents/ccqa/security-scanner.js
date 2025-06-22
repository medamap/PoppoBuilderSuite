const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const path = require('path');
const fs = require('fs').promises;
const Logger = require('../../src/logger');

/**
 * セキュリティ検査モジュール
 */
class SecurityScanner {
  constructor(config = {}) {
    this.config = config;
    this.logger = new Logger('CCQA-SecurityScanner');
    
    // セキュリティレベル設定
    this.securityLevel = config.securityLevel || 'high';
    
    // 検査対象
    this.scanTargets = {
      dependencies: config.scanDependencies !== false,
      credentials: config.scanCredentials !== false,
      vulnerabilities: config.scanVulnerabilities !== false
    };
    
    // ハードコードされた認証情報のパターン
    this.credentialPatterns = [
      // APIキー
      { name: 'API Key', pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"]([A-Za-z0-9\-_]{20,})['"]/, severity: 'critical' },
      { name: 'AWS Access Key', pattern: /AKIA[0-9A-Z]{16}/, severity: 'critical' },
      
      // パスワード
      { name: 'Password', pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"]([^'"]{8,})['"]/, severity: 'critical' },
      
      // トークン
      { name: 'JWT Token', pattern: /Bearer\s+[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/, severity: 'high' },
      { name: 'GitHub Token', pattern: /ghp_[A-Za-z0-9]{36}/, severity: 'critical' },
      
      // 秘密鍵
      { name: 'Private Key', pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/, severity: 'critical' },
      
      // データベース接続文字列
      { name: 'DB Connection', pattern: /(?:mongodb|mysql|postgres|postgresql):\/\/[^:]+:[^@]+@/, severity: 'high' }
    ];
    
    // OWASP Top 10 関連のパターン
    this.vulnerabilityPatterns = [
      // SQLインジェクション
      {
        name: 'SQL Injection Risk',
        pattern: /(?:query|exec|execute)\s*\([^)]*\+[^)]*\)/,
        severity: 'high',
        category: 'A03:2021 – Injection'
      },
      
      // XSS
      {
        name: 'XSS Risk',
        pattern: /innerHTML\s*=\s*[^'"][^;]+/,
        severity: 'medium',
        category: 'A03:2021 – Injection'
      },
      
      // 安全でないデシリアライゼーション
      {
        name: 'Unsafe Deserialization',
        pattern: /eval\s*\([^)]*\)|new\s+Function\s*\(/,
        severity: 'high',
        category: 'A08:2021 – Software and Data Integrity Failures'
      },
      
      // 暗号化の不適切な使用
      {
        name: 'Weak Crypto',
        pattern: /(?:md5|sha1)\s*\(/i,
        severity: 'medium',
        category: 'A02:2021 – Cryptographic Failures'
      }
    ];
  }
  
  /**
   * 初期化
   */
  async initialize() {
    this.logger.info('SecurityScannerを初期化中...');
    
    // npm auditが利用可能か確認
    try {
      await execAsync('npm audit --version');
      this.npmAuditAvailable = true;
      this.logger.info('npm auditが利用可能です');
    } catch (error) {
      this.npmAuditAvailable = false;
      this.logger.warn('npm auditが利用できません');
    }
  }
  
  /**
   * セキュリティスキャンの実行
   */
  async scanSecurity(projectDir, changedFiles = []) {
    this.logger.info(`セキュリティスキャンを実行: ${projectDir}`);
    
    const results = {
      vulnerabilities: [],
      credentials: [],
      dependencies: [],
      summary: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0
      }
    };
    
    try {
      // 1. 依存関係の脆弱性スキャン
      if (this.scanTargets.dependencies && this.npmAuditAvailable) {
        const depResults = await this.scanDependencies(projectDir);
        results.dependencies = depResults.vulnerabilities;
        this.updateSummary(results.summary, depResults.vulnerabilities);
      }
      
      // 2. ハードコードされた認証情報のスキャン
      if (this.scanTargets.credentials) {
        const credResults = await this.scanForCredentials(projectDir, changedFiles);
        results.credentials = credResults;
        this.updateSummary(results.summary, credResults);
      }
      
      // 3. コードの脆弱性パターンスキャン
      if (this.scanTargets.vulnerabilities) {
        const vulnResults = await this.scanForVulnerabilities(projectDir, changedFiles);
        results.vulnerabilities = vulnResults;
        this.updateSummary(results.summary, vulnResults);
      }
      
      // セキュリティスコアの計算
      results.securityScore = this.calculateSecurityScore(results);
      
      // 推奨事項の生成
      results.recommendations = this.generateRecommendations(results);
      
      return results;
      
    } catch (error) {
      this.logger.error(`セキュリティスキャンエラー: ${error.message}`);
      return results;
    }
  }
  
  /**
   * 依存関係の脆弱性スキャン
   */
  async scanDependencies(projectDir) {
    const results = {
      vulnerabilities: [],
      summary: {}
    };
    
    try {
      // npm auditの実行
      const { stdout } = await execAsync('npm audit --json', {
        cwd: projectDir,
        maxBuffer: 10 * 1024 * 1024
      }).catch(error => {
        // npm auditは脆弱性がある場合もJSONを返す
        return { stdout: error.stdout || '{}' };
      });
      
      const auditResult = JSON.parse(stdout);
      
      // 脆弱性の抽出
      if (auditResult.vulnerabilities) {
        for (const [pkg, vuln] of Object.entries(auditResult.vulnerabilities)) {
          if (vuln.severity && vuln.severity !== 'info') {
            results.vulnerabilities.push({
              type: 'dependency',
              package: pkg,
              severity: vuln.severity,
              title: vuln.title || 'Vulnerability in ' + pkg,
              description: vuln.overview || '',
              fixAvailable: vuln.fixAvailable || false,
              recommendation: vuln.recommendation || '',
              cwe: vuln.cwe || [],
              cvss: vuln.cvss || {}
            });
          }
        }
      }
      
      // メタデータの取得
      results.summary = auditResult.metadata || {};
      
    } catch (error) {
      this.logger.error(`npm audit実行エラー: ${error.message}`);
    }
    
    return results;
  }
  
  /**
   * ハードコードされた認証情報のスキャン
   */
  async scanForCredentials(projectDir, changedFiles) {
    const results = [];
    
    // スキャン対象ファイルの決定
    const targetFiles = changedFiles.length > 0 ? changedFiles : await this.getAllSourceFiles(projectDir);
    
    for (const file of targetFiles) {
      // バイナリファイルやnode_modulesはスキップ
      if (file.includes('node_modules') || file.includes('.git')) continue;
      
      try {
        const filePath = path.join(projectDir, file);
        const content = await fs.readFile(filePath, 'utf8');
        
        // 各パターンでスキャン
        for (const pattern of this.credentialPatterns) {
          const matches = content.matchAll(new RegExp(pattern.pattern, 'g'));
          
          for (const match of matches) {
            const lineNumber = content.substring(0, match.index).split('\n').length;
            
            results.push({
              type: 'credential',
              severity: pattern.severity,
              file: file,
              line: lineNumber,
              credentialType: pattern.name,
              message: `${pattern.name}がハードコードされている可能性があります`,
              match: this.maskCredential(match[0])
            });
          }
        }
        
      } catch (error) {
        // ファイル読み込みエラーは無視
      }
    }
    
    return results;
  }
  
  /**
   * 認証情報のマスキング
   */
  maskCredential(credential) {
    if (credential.length <= 10) {
      return '*'.repeat(credential.length);
    }
    
    const visibleChars = 4;
    const start = credential.substring(0, visibleChars);
    const masked = '*'.repeat(credential.length - visibleChars * 2);
    const end = credential.substring(credential.length - visibleChars);
    
    return start + masked + end;
  }
  
  /**
   * コードの脆弱性パターンスキャン
   */
  async scanForVulnerabilities(projectDir, changedFiles) {
    const results = [];
    
    // スキャン対象ファイルの決定
    const targetFiles = changedFiles.length > 0 ? changedFiles : await this.getAllSourceFiles(projectDir);
    
    for (const file of targetFiles) {
      // JavaScriptとTypeScriptファイルのみ対象
      if (!file.endsWith('.js') && !file.endsWith('.ts') && 
          !file.endsWith('.jsx') && !file.endsWith('.tsx')) continue;
      
      try {
        const filePath = path.join(projectDir, file);
        const content = await fs.readFile(filePath, 'utf8');
        
        // 各脆弱性パターンでスキャン
        for (const pattern of this.vulnerabilityPatterns) {
          const matches = content.matchAll(new RegExp(pattern.pattern, 'g'));
          
          for (const match of matches) {
            const lineNumber = content.substring(0, match.index).split('\n').length;
            
            results.push({
              type: 'vulnerability',
              severity: pattern.severity,
              file: file,
              line: lineNumber,
              vulnerabilityType: pattern.name,
              category: pattern.category,
              message: `${pattern.name}: 潜在的なセキュリティリスクが検出されました`,
              codeSnippet: this.extractCodeSnippet(content, lineNumber)
            });
          }
        }
        
        // 追加のセキュリティチェック
        await this.performAdvancedSecurityChecks(content, file, results);
        
      } catch (error) {
        // ファイル読み込みエラーは無視
      }
    }
    
    return results;
  }
  
  /**
   * 高度なセキュリティチェック
   */
  async performAdvancedSecurityChecks(content, file, results) {
    // HTTPSチェック
    if (content.includes('http://') && !content.includes('http://localhost')) {
      const matches = content.matchAll(/http:\/\/[^\s'"]+/g);
      for (const match of matches) {
        const lineNumber = content.substring(0, match.index).split('\n').length;
        results.push({
          type: 'vulnerability',
          severity: 'low',
          file: file,
          line: lineNumber,
          vulnerabilityType: 'Insecure HTTP',
          category: 'A02:2021 – Cryptographic Failures',
          message: 'HTTPSを使用することを推奨します',
          url: match[0]
        });
      }
    }
    
    // 未使用の権限チェック（簡易版）
    if (content.includes('sudo') || content.includes('chmod 777')) {
      results.push({
        type: 'vulnerability',
        severity: 'medium',
        file: file,
        vulnerabilityType: 'Excessive Permissions',
        category: 'A01:2021 – Broken Access Control',
        message: '過度な権限が設定されている可能性があります'
      });
    }
  }
  
  /**
   * コードスニペットの抽出
   */
  extractCodeSnippet(content, lineNumber, context = 2) {
    const lines = content.split('\n');
    const start = Math.max(0, lineNumber - context - 1);
    const end = Math.min(lines.length, lineNumber + context);
    
    return lines.slice(start, end).join('\n');
  }
  
  /**
   * すべてのソースファイルを取得（簡易版）
   */
  async getAllSourceFiles(projectDir) {
    // 実際の実装では、globパターンを使用
    const files = [];
    
    async function scanDir(dir, baseDir) {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relativePath = path.relative(baseDir, fullPath);
          
          if (entry.isDirectory()) {
            // node_modulesなどはスキップ
            if (!entry.name.startsWith('.') && 
                entry.name !== 'node_modules' && 
                entry.name !== 'dist' && 
                entry.name !== 'build') {
              await scanDir(fullPath, baseDir);
            }
          } else if (entry.isFile()) {
            files.push(relativePath);
          }
        }
      } catch (error) {
        // ディレクトリ読み込みエラーは無視
      }
    }
    
    await scanDir(projectDir, projectDir);
    return files;
  }
  
  /**
   * サマリーの更新
   */
  updateSummary(summary, vulnerabilities) {
    for (const vuln of vulnerabilities) {
      const severity = vuln.severity.toLowerCase();
      if (summary[severity] !== undefined) {
        summary[severity]++;
      }
    }
  }
  
  /**
   * セキュリティスコアの計算
   */
  calculateSecurityScore(results) {
    let score = 100;
    
    // 重要度に応じて減点
    score -= results.summary.critical * 20;
    score -= results.summary.high * 10;
    score -= results.summary.medium * 5;
    score -= results.summary.low * 2;
    
    // ハードコードされた認証情報は大幅減点
    score -= results.credentials.length * 15;
    
    return Math.max(0, Math.round(score));
  }
  
  /**
   * 推奨事項の生成
   */
  generateRecommendations(results) {
    const recommendations = [];
    
    // クリティカルな脆弱性
    if (results.summary.critical > 0) {
      recommendations.push({
        priority: 'critical',
        type: 'vulnerability',
        message: `${results.summary.critical}件のクリティカルな脆弱性を直ちに修正してください`,
        action: '依存関係を更新するか、該当コードを修正してください'
      });
    }
    
    // ハードコードされた認証情報
    if (results.credentials.length > 0) {
      recommendations.push({
        priority: 'critical',
        type: 'credential',
        message: `${results.credentials.length}件のハードコードされた認証情報を削除してください`,
        action: '環境変数や設定ファイルを使用してください'
      });
    }
    
    // 依存関係の脆弱性
    const depVulns = results.dependencies.filter(v => v.fixAvailable);
    if (depVulns.length > 0) {
      recommendations.push({
        priority: 'high',
        type: 'dependency',
        message: `${depVulns.length}件の修正可能な依存関係の脆弱性があります`,
        action: 'npm auditを実行して修正してください'
      });
    }
    
    // 暗号化の推奨
    const weakCrypto = results.vulnerabilities.filter(v => v.vulnerabilityType === 'Weak Crypto');
    if (weakCrypto.length > 0) {
      recommendations.push({
        priority: 'medium',
        type: 'crypto',
        message: '弱い暗号化アルゴリズムが使用されています',
        action: 'SHA-256やbcryptなど、より強力なアルゴリズムを使用してください'
      });
    }
    
    return recommendations;
  }
}

module.exports = SecurityScanner;