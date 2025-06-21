const crypto = require('crypto');

/**
 * セキュリティスキャナーモジュール
 * セキュリティ脆弱性を検出する
 */
class SecurityScanner {
  constructor(logger) {
    this.logger = logger;
    
    // セキュリティパターンの定義
    this.patterns = {
      // ハードコードされた認証情報
      hardcodedSecrets: [
        {
          pattern: /(?:api[_-]?key|apikey|api[_-]?secret)\s*[:=]\s*["']([^"']+)["']/gi,
          type: 'api_key',
          severity: 'critical',
          message: 'ハードコードされたAPIキーが検出されました'
        },
        {
          pattern: /(?:password|passwd|pwd)\s*[:=]\s*["']([^"']+)["']/gi,
          type: 'password',
          severity: 'critical',
          message: 'ハードコードされたパスワードが検出されました'
        },
        {
          pattern: /(?:token|access[_-]?token|auth[_-]?token)\s*[:=]\s*["']([^"']+)["']/gi,
          type: 'token',
          severity: 'critical',
          message: 'ハードコードされたトークンが検出されました'
        },
        {
          pattern: /(?:secret|private[_-]?key)\s*[:=]\s*["']([^"']+)["']/gi,
          type: 'secret',
          severity: 'critical',
          message: 'ハードコードされたシークレットが検出されました'
        }
      ],
      
      // SQLインジェクション
      sqlInjection: [
        {
          pattern: /query\s*\(\s*["'`].*?\$\{.*?\}.*?["'`]/gi,
          severity: 'high',
          message: 'SQLインジェクションの脆弱性の可能性があります',
          suggestion: 'パラメータ化されたクエリを使用してください'
        },
        {
          pattern: /query\s*\(\s*["'`].*?\+.*?["'`]/gi,
          severity: 'high',
          message: 'SQLクエリの文字列連結が検出されました',
          suggestion: 'プリペアドステートメントを使用してください'
        }
      ],
      
      // XSS脆弱性
      xss: [
        {
          pattern: /innerHTML\s*=\s*[^"'`]|innerHTML\s*=\s*["'`].*?\$\{/gi,
          severity: 'high',
          message: 'XSS脆弱性の可能性があります（innerHTML）',
          suggestion: 'textContentまたはサニタイズ処理を使用してください'
        },
        {
          pattern: /document\.write\s*\(/gi,
          severity: 'medium',
          message: 'document.writeの使用は推奨されません',
          suggestion: 'DOM操作APIを使用してください'
        },
        {
          pattern: /eval\s*\(/gi,
          severity: 'high',
          message: 'evalの使用は危険です',
          suggestion: '別の方法で実装することを検討してください'
        }
      ],
      
      // パストラバーサル
      pathTraversal: [
        {
          pattern: /(?:readFile|readFileSync|createReadStream)\s*\([^)]*\+[^)]*\)/gi,
          severity: 'high',
          message: 'パストラバーサルの脆弱性の可能性があります',
          suggestion: 'ファイルパスを検証してください'
        }
      ],
      
      // 安全でない乱数
      insecureRandom: [
        {
          pattern: /Math\.random\s*\(\s*\)/gi,
          severity: 'medium',
          message: '暗号学的に安全でない乱数生成',
          suggestion: 'crypto.randomBytesを使用してください'
        }
      ],
      
      // HTTPSチェック
      insecureHttp: [
        {
          pattern: /http:\/\/(?!localhost|127\.0\.0\.1)/gi,
          severity: 'medium',
          message: '安全でないHTTP接続が使用されています',
          suggestion: 'HTTPSを使用してください'
        }
      ],
      
      // 過度な権限
      excessivePermissions: [
        {
          pattern: /chmod\s+777|permissions:\s*0?777/gi,
          severity: 'high',
          message: '過度なファイル権限が設定されています',
          suggestion: '必要最小限の権限を設定してください'
        }
      ]
    };
  }
  
  /**
   * セキュリティスキャンを実行
   */
  async scan(pr, files) {
    const results = {
      overall: {
        secure: true,
        criticalCount: 0,
        highCount: 0,
        mediumCount: 0,
        lowCount: 0
      },
      vulnerabilities: [],
      suggestions: []
    };
    
    // 各ファイルをスキャン
    for (const file of files) {
      if (this.shouldScanFile(file)) {
        const fileVulnerabilities = await this.scanFile(file);
        results.vulnerabilities.push(...fileVulnerabilities);
      }
    }
    
    // package.jsonの依存関係チェック
    const packageFile = files.find(f => f.filename === 'package.json');
    if (packageFile) {
      const depVulnerabilities = await this.checkDependencies(packageFile);
      results.vulnerabilities.push(...depVulnerabilities);
    }
    
    // 集計
    results.vulnerabilities.forEach(vuln => {
      switch (vuln.severity) {
        case 'critical':
          results.overall.criticalCount++;
          results.overall.secure = false;
          break;
        case 'high':
          results.overall.highCount++;
          results.overall.secure = false;
          break;
        case 'medium':
          results.overall.mediumCount++;
          break;
        case 'low':
          results.overall.lowCount++;
          break;
      }
    });
    
    // 全体的な推奨事項
    results.suggestions = this.generateSuggestions(results);
    
    return results;
  }
  
  /**
   * ファイルをスキャンすべきか判定
   */
  shouldScanFile(file) {
    // 削除されたファイルはスキャンしない
    if (file.status === 'removed') return false;
    
    // スキャン対象の拡張子
    const scanExtensions = ['.js', '.jsx', '.ts', '.tsx', '.py', '.rb', '.php', '.java'];
    const isSourceFile = scanExtensions.some(ext => file.filename.endsWith(ext));
    
    // 設定ファイルもチェック
    const isConfigFile = file.filename.endsWith('.json') || 
                        file.filename.endsWith('.yaml') || 
                        file.filename.endsWith('.yml') ||
                        file.filename.endsWith('.env');
    
    return isSourceFile || isConfigFile;
  }
  
  /**
   * 個別ファイルのスキャン
   */
  async scanFile(file) {
    const vulnerabilities = [];
    
    if (!file.patch) return vulnerabilities;
    
    const lines = file.patch.split('\n');
    
    // 各セキュリティパターンをチェック
    for (const [category, patterns] of Object.entries(this.patterns)) {
      for (const patternDef of patterns) {
        lines.forEach((line, index) => {
          // 追加された行のみチェック
          if (!line.startsWith('+') || line.startsWith('+++')) return;
          
          const codeLine = line.substring(1);
          const matches = codeLine.match(patternDef.pattern);
          
          if (matches) {
            const vulnerability = {
              file: file.filename,
              line: index,
              category,
              severity: patternDef.severity,
              message: patternDef.message,
              code: this.sanitizeCode(codeLine),
              suggestion: patternDef.suggestion,
              match: matches[0]
            };
            
            // ハードコードされた認証情報の場合は値をマスク
            if (patternDef.type && matches[1]) {
              vulnerability.detectedValue = this.maskSensitiveValue(matches[1]);
            }
            
            vulnerabilities.push(vulnerability);
          }
        });
      }
    }
    
    // 追加のカスタムチェック
    const customVulnerabilities = this.performCustomChecks(file, lines);
    vulnerabilities.push(...customVulnerabilities);
    
    return vulnerabilities;
  }
  
  /**
   * カスタムセキュリティチェック
   */
  performCustomChecks(file, lines) {
    const vulnerabilities = [];
    
    // Node.jsのchild_processチェック
    const hasChildProcess = lines.some(l => l.includes('child_process') || l.includes('exec('));
    if (hasChildProcess) {
      const execLines = lines.map((line, index) => ({ line, index }))
        .filter(({ line }) => line.includes('exec(') || line.includes('execSync('));
      
      execLines.forEach(({ line, index }) => {
        vulnerabilities.push({
          file: file.filename,
          line: index,
          category: 'command_injection',
          severity: 'high',
          message: 'コマンドインジェクションの脆弱性の可能性があります',
          code: this.sanitizeCode(line),
          suggestion: '入力値を適切にサニタイズし、execFileやspawnの使用を検討してください'
        });
      });
    }
    
    // CORS設定チェック
    const hasCorsWildcard = lines.some(l => 
      l.includes('Access-Control-Allow-Origin') && l.includes('*')
    );
    
    if (hasCorsWildcard) {
      vulnerabilities.push({
        file: file.filename,
        line: lines.findIndex(l => l.includes('Access-Control-Allow-Origin')),
        category: 'cors',
        severity: 'medium',
        message: 'CORSワイルドカード設定が検出されました',
        suggestion: '具体的なオリジンを指定してください'
      });
    }
    
    // セッション設定チェック
    const hasInsecureSession = lines.some(l => 
      l.includes('secure: false') && (l.includes('cookie') || l.includes('session'))
    );
    
    if (hasInsecureSession) {
      vulnerabilities.push({
        file: file.filename,
        line: lines.findIndex(l => l.includes('secure: false')),
        category: 'session',
        severity: 'high',
        message: '安全でないセッション設定が検出されました',
        suggestion: '本番環境ではsecure: trueに設定してください'
      });
    }
    
    return vulnerabilities;
  }
  
  /**
   * 依存関係のチェック
   */
  async checkDependencies(packageFile) {
    const vulnerabilities = [];
    
    if (!packageFile.patch) return vulnerabilities;
    
    // package.jsonの変更を解析
    const lines = packageFile.patch.split('\n');
    const addedDeps = [];
    
    lines.forEach((line, index) => {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        const depMatch = line.match(/"([^"]+)":\s*"([^"]+)"/);
        if (depMatch) {
          addedDeps.push({
            name: depMatch[1],
            version: depMatch[2],
            line: index
          });
        }
      }
    });
    
    // 既知の脆弱性のある依存関係をチェック（簡易版）
    const knownVulnerableDeps = {
      'event-stream': { severity: 'critical', message: '悪意のあるコードが含まれていた履歴があります' },
      'flatmap-stream': { severity: 'critical', message: '悪意のあるコードが含まれていた履歴があります' }
    };
    
    addedDeps.forEach(dep => {
      if (knownVulnerableDeps[dep.name]) {
        vulnerabilities.push({
          file: packageFile.filename,
          line: dep.line,
          category: 'vulnerable_dependency',
          severity: knownVulnerableDeps[dep.name].severity,
          message: `脆弱性のある依存関係: ${dep.name}`,
          suggestion: knownVulnerableDeps[dep.name].message
        });
      }
      
      // 古いバージョンの警告
      if (dep.version.includes('^0.') || dep.version.includes('~0.')) {
        vulnerabilities.push({
          file: packageFile.filename,
          line: dep.line,
          category: 'outdated_dependency',
          severity: 'low',
          message: `不安定なバージョンの依存関係: ${dep.name}@${dep.version}`,
          suggestion: '安定版の使用を検討してください'
        });
      }
    });
    
    return vulnerabilities;
  }
  
  /**
   * コードのサニタイズ（表示用）
   */
  sanitizeCode(code) {
    return code.trim().substring(0, 100) + (code.length > 100 ? '...' : '');
  }
  
  /**
   * 機密情報のマスク
   */
  maskSensitiveValue(value) {
    if (value.length <= 4) {
      return '*'.repeat(value.length);
    }
    return value.substring(0, 2) + '*'.repeat(Math.min(value.length - 4, 10)) + value.substring(value.length - 2);
  }
  
  /**
   * 全体的な推奨事項を生成
   */
  generateSuggestions(results) {
    const suggestions = [];
    
    if (results.overall.criticalCount > 0) {
      suggestions.push({
        priority: 'critical',
        message: '重大なセキュリティ問題が検出されました。即座に対処が必要です。',
        action: 'セキュリティチームのレビューを依頼してください'
      });
    }
    
    if (results.overall.highCount > 0) {
      suggestions.push({
        priority: 'high',
        message: '高リスクのセキュリティ問題があります。マージ前に修正してください。',
        action: 'OWASP Top 10を参考に脆弱性を修正してください'
      });
    }
    
    // ハードコードされた認証情報がある場合
    const hasSecrets = results.vulnerabilities.some(v => 
      v.category === 'hardcodedSecrets'
    );
    
    if (hasSecrets) {
      suggestions.push({
        priority: 'critical',
        message: 'ハードコードされた認証情報を環境変数に移動してください',
        action: '1. 認証情報を環境変数に移動\n2. .env.exampleファイルを作成\n3. 既に漏洩した認証情報は再生成'
      });
    }
    
    // セキュリティベストプラクティス
    if (results.vulnerabilities.length === 0) {
      suggestions.push({
        priority: 'info',
        message: 'セキュリティ問題は検出されませんでした',
        action: '定期的なセキュリティ監査を継続してください'
      });
    }
    
    return suggestions;
  }
}

module.exports = SecurityScanner;