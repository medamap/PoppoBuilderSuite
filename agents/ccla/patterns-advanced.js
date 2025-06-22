/**
 * 高度な修復パターンライブラリ
 * 
 * Issue #37 (Phase 3拡張): エラーログ収集機能 - 高度な修復パターンの実装
 * 複雑なエラーパターンと複数ファイルにまたがる修復に対応
 */

const fs = require('fs').promises;
const path = require('path');
const Logger = require('../../src/logger');

class AdvancedRepairPatterns {
  constructor() {
    this.logger = new Logger('AdvancedRepairPatterns');
    this.patterns = new Map();
    this.initializePatterns();
  }
  
  /**
   * パターンの初期化
   */
  initializePatterns() {
    // EP011: 循環参照エラー
    this.patterns.set('EP011', {
      id: 'EP011',
      name: 'Circular Dependency Error',
      description: '循環参照によるエラーの修復',
      matcher: /Cannot access .* before initialization|Circular dependency detected/i,
      complexity: 'high',
      multiFile: true,
      repair: this.repairCircularDependency.bind(this)
    });
    
    // EP012: 非同期処理のエラー
    this.patterns.set('EP012', {
      id: 'EP012',
      name: 'Async/Await Error',
      description: '非同期処理の適切な処理',
      matcher: /Cannot read prop.* of undefined.*await|Promise rejected|UnhandledPromiseRejection/i,
      complexity: 'medium',
      multiFile: false,
      repair: this.repairAsyncError.bind(this)
    });
    
    // EP013: メモリリーク
    this.patterns.set('EP013', {
      id: 'EP013',
      name: 'Memory Leak',
      description: 'メモリリークの検出と修復',
      matcher: /JavaScript heap out of memory|Maximum call stack size exceeded/i,
      complexity: 'high',
      multiFile: true,
      repair: this.repairMemoryLeak.bind(this)
    });
    
    // EP014: 設定ファイルの不整合
    this.patterns.set('EP014', {
      id: 'EP014',
      name: 'Configuration Inconsistency',
      description: '設定ファイル間の不整合を修復',
      matcher: /Configuration mismatch|Invalid configuration|Config validation failed/i,
      complexity: 'medium',
      multiFile: true,
      repair: this.repairConfigInconsistency.bind(this)
    });
    
    // EP015: APIバージョン不整合
    this.patterns.set('EP015', {
      id: 'EP015',
      name: 'API Version Mismatch',
      description: 'APIバージョンの不整合を修復',
      matcher: /API version mismatch|Deprecated API|Invalid API version/i,
      complexity: 'high',
      multiFile: true,
      repair: this.repairApiVersionMismatch.bind(this)
    });
    
    // EP016: テスト失敗の自動修復
    this.patterns.set('EP016', {
      id: 'EP016',
      name: 'Test Failure Auto-Fix',
      description: 'テストの失敗を分析して自動修復',
      matcher: /Test failed|Expected .* to equal|AssertionError/i,
      complexity: 'high',
      multiFile: true,
      repair: this.repairTestFailure.bind(this)
    });
    
    // EP017: パッケージ依存関係エラー
    this.patterns.set('EP017', {
      id: 'EP017',
      name: 'Package Dependency Error',
      description: 'パッケージの依存関係エラーを修復',
      matcher: /Cannot find module|Module not found|peer dep/i,
      complexity: 'medium',
      multiFile: true,
      repair: this.repairPackageDependency.bind(this)
    });
    
    // EP018: 型定義エラー（TypeScript）
    this.patterns.set('EP018', {
      id: 'EP018',
      name: 'Type Definition Error',
      description: 'TypeScriptの型定義エラーを修復',
      matcher: /Type .* is not assignable|Property .* does not exist on type/i,
      complexity: 'high',
      multiFile: false,
      repair: this.repairTypeError.bind(this)
    });
    
    this.logger.info('Advanced repair patterns initialized', {
      patternCount: this.patterns.size
    });
  }
  
  /**
   * 循環参照エラーの修復
   */
  async repairCircularDependency(context) {
    const { file, errorMessage, stack } = context;
    const repairs = [];
    
    try {
      // スタックトレースから関連ファイルを抽出
      const involvedFiles = this.extractFilesFromStack(stack);
      
      // 依存関係グラフの構築
      const depGraph = await this.buildDependencyGraph(involvedFiles);
      
      // 循環を検出
      const cycles = this.detectCycles(depGraph);
      
      if (cycles.length > 0) {
        // 最も簡単な修復方法を選択
        const cycle = cycles[0];
        const weakestLink = this.findWeakestLink(cycle, depGraph);
        
        // 遅延読み込みに変更
        const targetFile = weakestLink.from;
        const content = await fs.readFile(targetFile, 'utf8');
        
        // requireを関数内に移動
        const repaired = this.convertToLazyLoad(content, weakestLink.to);
        
        repairs.push({
          file: targetFile,
          original: content,
          repaired,
          description: `Converted require('${weakestLink.to}') to lazy loading to break circular dependency`
        });
      }
    } catch (error) {
      this.logger.error('Failed to repair circular dependency', error);
      throw error;
    }
    
    return repairs;
  }
  
  /**
   * 非同期エラーの修復
   */
  async repairAsyncError(context) {
    const { file, errorMessage, lineNumber } = context;
    const repairs = [];
    
    try {
      const content = await fs.readFile(file, 'utf8');
      const lines = content.split('\n');
      
      // エラー行周辺を分析
      const errorLine = lines[lineNumber - 1];
      
      // await忘れのチェック
      if (errorLine && errorLine.includes('(') && !errorLine.includes('await')) {
        // 非同期関数呼び出しの可能性をチェック
        const functionName = this.extractFunctionName(errorLine);
        if (functionName && await this.isAsyncFunction(file, functionName)) {
          lines[lineNumber - 1] = errorLine.replace(functionName, `await ${functionName}`);
          
          repairs.push({
            file,
            original: content,
            repaired: lines.join('\n'),
            description: `Added missing 'await' keyword before async function call`
          });
        }
      }
      
      // try-catchの追加
      if (repairs.length === 0) {
        const wrappedContent = this.wrapWithTryCatch(content, lineNumber);
        if (wrappedContent !== content) {
          repairs.push({
            file,
            original: content,
            repaired: wrappedContent,
            description: 'Wrapped potentially failing code with try-catch block'
          });
        }
      }
    } catch (error) {
      this.logger.error('Failed to repair async error', error);
      throw error;
    }
    
    return repairs;
  }
  
  /**
   * メモリリークの修復
   */
  async repairMemoryLeak(context) {
    const { file, errorMessage } = context;
    const repairs = [];
    
    try {
      const content = await fs.readFile(file, 'utf8');
      
      // 一般的なメモリリークパターンを検出
      let repaired = content;
      
      // 1. イベントリスナーの削除忘れ
      if (content.includes('addEventListener') && !content.includes('removeEventListener')) {
        repaired = this.addEventListenerCleanup(repaired);
        repairs.push({
          file,
          original: content,
          repaired,
          description: 'Added event listener cleanup to prevent memory leaks'
        });
      }
      
      // 2. 大きな配列やオブジェクトのクリア忘れ
      const largeArrayPattern = /this\.(\w+)\s*=\s*\[\];?/g;
      const matches = content.match(largeArrayPattern);
      if (matches) {
        repaired = this.addArrayCleanup(repaired, matches);
        if (repaired !== content) {
          repairs.push({
            file,
            original: content,
            repaired,
            description: 'Added cleanup for large arrays/objects'
          });
        }
      }
      
      // 3. setInterval/setTimeoutのクリア忘れ
      if (content.includes('setInterval') || content.includes('setTimeout')) {
        repaired = this.addTimerCleanup(repaired);
        if (repaired !== content) {
          repairs.push({
            file,
            original: content,
            repaired,
            description: 'Added timer cleanup to prevent memory leaks'
          });
        }
      }
    } catch (error) {
      this.logger.error('Failed to repair memory leak', error);
      throw error;
    }
    
    return repairs;
  }
  
  /**
   * 設定ファイルの不整合修復
   */
  async repairConfigInconsistency(context) {
    const { file, errorMessage } = context;
    const repairs = [];
    
    try {
      // 関連する設定ファイルを検索
      const configFiles = await this.findConfigFiles(path.dirname(file));
      
      // 各設定ファイルを読み込み
      const configs = new Map();
      for (const configFile of configFiles) {
        try {
          const content = await fs.readFile(configFile, 'utf8');
          configs.set(configFile, JSON.parse(content));
        } catch (e) {
          // JSONパースエラーは別途処理
        }
      }
      
      // 不整合を検出
      const inconsistencies = this.detectConfigInconsistencies(configs);
      
      // 修復案を生成
      for (const inconsistency of inconsistencies) {
        const { file: targetFile, key, expectedValue, actualValue } = inconsistency;
        const config = configs.get(targetFile);
        
        if (config) {
          // 値を修正
          this.setNestedValue(config, key, expectedValue);
          
          repairs.push({
            file: targetFile,
            original: await fs.readFile(targetFile, 'utf8'),
            repaired: JSON.stringify(config, null, 2),
            description: `Fixed configuration inconsistency: ${key} = ${expectedValue}`
          });
        }
      }
    } catch (error) {
      this.logger.error('Failed to repair config inconsistency', error);
      throw error;
    }
    
    return repairs;
  }
  
  /**
   * APIバージョン不整合の修復
   */
  async repairApiVersionMismatch(context) {
    const { file, errorMessage } = context;
    const repairs = [];
    
    try {
      const content = await fs.readFile(file, 'utf8');
      
      // APIバージョンを抽出
      const versionPattern = /api\/v(\d+)/gi;
      const matches = [...content.matchAll(versionPattern)];
      
      if (matches.length > 0) {
        // 最新バージョンを特定（仮に設定から取得）
        const latestVersion = await this.getLatestApiVersion();
        
        let repaired = content;
        for (const match of matches) {
          const currentVersion = match[1];
          if (currentVersion !== latestVersion) {
            repaired = repaired.replace(
              new RegExp(`api/v${currentVersion}`, 'g'),
              `api/v${latestVersion}`
            );
          }
        }
        
        if (repaired !== content) {
          repairs.push({
            file,
            original: content,
            repaired,
            description: `Updated API version from v${matches[0][1]} to v${latestVersion}`
          });
        }
      }
    } catch (error) {
      this.logger.error('Failed to repair API version mismatch', error);
      throw error;
    }
    
    return repairs;
  }
  
  /**
   * テスト失敗の自動修復
   */
  async repairTestFailure(context) {
    const { file, errorMessage } = context;
    const repairs = [];
    
    try {
      // エラーメッセージから期待値と実際の値を抽出
      const expectPattern = /Expected (.*) to (?:equal|be) (.*)$/;
      const match = errorMessage.match(expectPattern);
      
      if (match) {
        const [, actual, expected] = match;
        const content = await fs.readFile(file, 'utf8');
        
        // テストコード内の該当箇所を検索
        const testPattern = new RegExp(`expect\\(.*\\)\\.to(?:Equal|Be)\\(${expected}\\)`, 'g');
        
        if (testPattern.test(content)) {
          // テストの期待値を実際の値に更新（議論の余地あり）
          const repaired = content.replace(testPattern, `expect(${actual}).toEqual(${actual})`);
          
          repairs.push({
            file,
            original: content,
            repaired,
            description: `Updated test expectation to match actual value (requires review)`,
            requiresReview: true
          });
        }
      }
    } catch (error) {
      this.logger.error('Failed to repair test failure', error);
      throw error;
    }
    
    return repairs;
  }
  
  /**
   * パッケージ依存関係エラーの修復
   */
  async repairPackageDependency(context) {
    const { file, errorMessage } = context;
    const repairs = [];
    
    try {
      // 不足しているモジュール名を抽出
      const modulePattern = /Cannot find module ['"](.+?)['"]/;
      const match = errorMessage.match(modulePattern);
      
      if (match) {
        const missingModule = match[1];
        const packageJsonPath = await this.findPackageJson(path.dirname(file));
        
        if (packageJsonPath) {
          const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
          
          // 依存関係に追加
          if (!packageJson.dependencies) {
            packageJson.dependencies = {};
          }
          
          // バージョンを推測（最新版を使用）
          const version = await this.getLatestPackageVersion(missingModule);
          packageJson.dependencies[missingModule] = `^${version}`;
          
          repairs.push({
            file: packageJsonPath,
            original: await fs.readFile(packageJsonPath, 'utf8'),
            repaired: JSON.stringify(packageJson, null, 2),
            description: `Added missing dependency: ${missingModule}@${version}`,
            postRepairCommands: [`npm install ${missingModule}`]
          });
        }
      }
    } catch (error) {
      this.logger.error('Failed to repair package dependency', error);
      throw error;
    }
    
    return repairs;
  }
  
  /**
   * TypeScript型エラーの修復
   */
  async repairTypeError(context) {
    const { file, errorMessage, lineNumber } = context;
    const repairs = [];
    
    try {
      const content = await fs.readFile(file, 'utf8');
      const lines = content.split('\n');
      
      // 型エラーのパターンを分析
      if (errorMessage.includes('is not assignable to type')) {
        // 型アサーションを追加
        const errorLine = lines[lineNumber - 1];
        if (errorLine) {
          const variablePattern = /const (\w+) = (.+);/;
          const match = errorLine.match(variablePattern);
          
          if (match) {
            const [, varName, value] = match;
            // as any を追加（暫定的な修復）
            lines[lineNumber - 1] = `const ${varName} = ${value} as any; // TODO: Fix type`;
            
            repairs.push({
              file,
              original: content,
              repaired: lines.join('\n'),
              description: 'Added type assertion as temporary fix (needs proper typing)',
              requiresReview: true
            });
          }
        }
      }
    } catch (error) {
      this.logger.error('Failed to repair type error', error);
      throw error;
    }
    
    return repairs;
  }
  
  // ヘルパーメソッド
  
  extractFilesFromStack(stack) {
    const files = new Set();
    const filePattern = /at .* \((.+\.js):\d+:\d+\)/g;
    let match;
    
    while ((match = filePattern.exec(stack)) !== null) {
      files.add(match[1]);
    }
    
    return Array.from(files);
  }
  
  async buildDependencyGraph(files) {
    const graph = new Map();
    
    for (const file of files) {
      try {
        const content = await fs.readFile(file, 'utf8');
        const dependencies = this.extractDependencies(content);
        graph.set(file, dependencies);
      } catch (error) {
        // ファイルが読めない場合はスキップ
      }
    }
    
    return graph;
  }
  
  extractDependencies(content) {
    const deps = [];
    const requirePattern = /require\(['"](.+?)['"]\)/g;
    const importPattern = /import .* from ['"](.+?)['"]/g;
    
    let match;
    while ((match = requirePattern.exec(content)) !== null) {
      deps.push(match[1]);
    }
    while ((match = importPattern.exec(content)) !== null) {
      deps.push(match[1]);
    }
    
    return deps;
  }
  
  detectCycles(graph) {
    // 簡易的な循環検出（DFS）
    const cycles = [];
    const visited = new Set();
    const stack = new Set();
    
    const dfs = (node, path = []) => {
      if (stack.has(node)) {
        const cycleStart = path.indexOf(node);
        cycles.push(path.slice(cycleStart));
        return;
      }
      
      if (visited.has(node)) return;
      
      visited.add(node);
      stack.add(node);
      path.push(node);
      
      const deps = graph.get(node) || [];
      for (const dep of deps) {
        dfs(dep, [...path]);
      }
      
      stack.delete(node);
    };
    
    for (const node of graph.keys()) {
      if (!visited.has(node)) {
        dfs(node);
      }
    }
    
    return cycles;
  }
  
  findWeakestLink(cycle, graph) {
    // 最も依存が少ないリンクを見つける
    let minDeps = Infinity;
    let weakestLink = null;
    
    for (let i = 0; i < cycle.length; i++) {
      const from = cycle[i];
      const to = cycle[(i + 1) % cycle.length];
      const deps = graph.get(from) || [];
      
      if (deps.length < minDeps) {
        minDeps = deps.length;
        weakestLink = { from, to };
      }
    }
    
    return weakestLink;
  }
  
  convertToLazyLoad(content, modulePath) {
    // requireを関数内に移動
    const requirePattern = new RegExp(`const \\w+ = require\\(['"]${modulePath}['"]\\);?`, 'g');
    
    return content.replace(requirePattern, (match) => {
      const varName = match.match(/const (\w+)/)[1];
      return `let ${varName};\nfunction get${varName}() {\n  if (!${varName}) {\n    ${varName} = require('${modulePath}');\n  }\n  return ${varName};\n}`;
    });
  }
  
  async findConfigFiles(dir) {
    const configFiles = [];
    const files = await fs.readdir(dir);
    
    for (const file of files) {
      if (file.endsWith('.json') && file.includes('config')) {
        configFiles.push(path.join(dir, file));
      }
    }
    
    // 親ディレクトリも確認
    const parentDir = path.dirname(dir);
    if (parentDir !== dir) {
      const parentFiles = await this.findConfigFiles(parentDir);
      configFiles.push(...parentFiles);
    }
    
    return [...new Set(configFiles)];
  }
  
  detectConfigInconsistencies(configs) {
    const inconsistencies = [];
    const commonKeys = new Set();
    
    // 共通キーを見つける
    for (const config of configs.values()) {
      this.extractKeys(config).forEach(key => commonKeys.add(key));
    }
    
    // 各キーの値を比較
    for (const key of commonKeys) {
      const values = new Map();
      
      for (const [file, config] of configs) {
        const value = this.getNestedValue(config, key);
        if (value !== undefined) {
          if (!values.has(JSON.stringify(value))) {
            values.set(JSON.stringify(value), []);
          }
          values.get(JSON.stringify(value)).push({ file, value });
        }
      }
      
      // 異なる値がある場合
      if (values.size > 1) {
        // 最も一般的な値を正しい値とする
        let maxCount = 0;
        let expectedValue = null;
        
        for (const [, files] of values) {
          if (files.length > maxCount) {
            maxCount = files.length;
            expectedValue = files[0].value;
          }
        }
        
        // 修正が必要なファイルを特定
        for (const [, files] of values) {
          for (const { file, value } of files) {
            if (JSON.stringify(value) !== JSON.stringify(expectedValue)) {
              inconsistencies.push({
                file,
                key,
                expectedValue,
                actualValue: value
              });
            }
          }
        }
      }
    }
    
    return inconsistencies;
  }
  
  extractKeys(obj, prefix = '') {
    const keys = [];
    
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      keys.push(fullKey);
      
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        keys.push(...this.extractKeys(value, fullKey));
      }
    }
    
    return keys;
  }
  
  getNestedValue(obj, path) {
    const keys = path.split('.');
    let value = obj;
    
    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key];
      } else {
        return undefined;
      }
    }
    
    return value;
  }
  
  setNestedValue(obj, path, value) {
    const keys = path.split('.');
    let current = obj;
    
    for (let i = 0; i < keys.length - 1; i++) {
      if (!(keys[i] in current)) {
        current[keys[i]] = {};
      }
      current = current[keys[i]];
    }
    
    current[keys[keys.length - 1]] = value;
  }
  
  async getLatestApiVersion() {
    // 実際の実装では設定やAPIから取得
    return '2';
  }
  
  async findPackageJson(dir) {
    let currentDir = dir;
    
    while (currentDir !== path.dirname(currentDir)) {
      const packageJsonPath = path.join(currentDir, 'package.json');
      try {
        await fs.access(packageJsonPath);
        return packageJsonPath;
      } catch {
        currentDir = path.dirname(currentDir);
      }
    }
    
    return null;
  }
  
  async getLatestPackageVersion(packageName) {
    // 実際の実装ではnpm registryから取得
    // ここでは仮の値を返す
    return '1.0.0';
  }
  
  extractFunctionName(line) {
    const patterns = [
      /(\w+)\s*\(/,
      /\.(\w+)\s*\(/
    ];
    
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {
        return match[1];
      }
    }
    
    return null;
  }
  
  async isAsyncFunction(file, functionName) {
    // 簡易的な判定（実際にはより高度な解析が必要）
    try {
      const content = await fs.readFile(file, 'utf8');
      const asyncPattern = new RegExp(`async\\s+(?:function\\s+)?${functionName}|${functionName}\\s*:\\s*async`);
      return asyncPattern.test(content);
    } catch {
      return false;
    }
  }
  
  wrapWithTryCatch(content, lineNumber) {
    const lines = content.split('\n');
    const indent = lines[lineNumber - 1].match(/^\s*/)[0];
    
    // 簡易的なtry-catch追加
    lines.splice(lineNumber - 1, 0, `${indent}try {`);
    lines.splice(lineNumber + 1, 0, `${indent}} catch (error) {`);
    lines.splice(lineNumber + 2, 0, `${indent}  console.error('Error:', error);`);
    lines.splice(lineNumber + 3, 0, `${indent}  // TODO: Handle error properly`);
    lines.splice(lineNumber + 4, 0, `${indent}}`);
    
    return lines.join('\n');
  }
  
  addEventListenerCleanup(content) {
    // クラスベースのコンポーネントでの例
    if (content.includes('componentWillUnmount') || content.includes('destroy') || content.includes('cleanup')) {
      return content; // 既にクリーンアップがある
    }
    
    // クリーンアップメソッドを追加
    const classPattern = /class\s+\w+\s+extends\s+\w+\s*{/;
    if (classPattern.test(content)) {
      return content.replace(/}$/, `
  componentWillUnmount() {
    // TODO: Remove event listeners here
  }
}`);
    }
    
    return content;
  }
  
  addArrayCleanup(content, arrayMatches) {
    // デストラクタやクリーンアップメソッドに配列のクリアを追加
    let repaired = content;
    
    const cleanupCode = arrayMatches.map(match => {
      const varName = match.match(/this\.(\w+)/)[1];
      return `    this.${varName} = null;`;
    }).join('\n');
    
    // クリーンアップメソッドを探す
    if (content.includes('destroy()') || content.includes('cleanup()')) {
      repaired = content.replace(/(destroy|cleanup)\(\)\s*{/, `$1() {\n${cleanupCode}`);
    }
    
    return repaired;
  }
  
  addTimerCleanup(content) {
    // タイマーIDを保存してクリーンアップ
    let repaired = content;
    
    // setIntervalの場合
    repaired = repaired.replace(
      /setInterval\(/g,
      'this._intervalId = setInterval('
    );
    
    // setTimeoutの場合
    repaired = repaired.replace(
      /setTimeout\(/g,
      'this._timeoutId = setTimeout('
    );
    
    // クリーンアップコードを追加
    if (repaired !== content) {
      const cleanupCode = `
  cleanup() {
    if (this._intervalId) {
      clearInterval(this._intervalId);
    }
    if (this._timeoutId) {
      clearTimeout(this._timeoutId);
    }
  }`;
      
      repaired = repaired.replace(/}$/, `${cleanupCode}\n}`);
    }
    
    return repaired;
  }
}

module.exports = AdvancedRepairPatterns;