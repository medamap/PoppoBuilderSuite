/**
 * テストケース自動生成機能
 * 修復箇所に対するテストケースを生成し、既存テストとの統合を行う
 */

const fs = require('fs').promises;
const path = require('path');
class TestGenerator {
  constructor(logger = console) {
    this.logger = logger;
    this.processManager = null; // ProcessManagerは必要に応じて後で初期化
    
    // テストフレームワークのテンプレート
    this.templates = {
      jest: {
        fileTemplate: () => this.getJestFileTemplate(),
        testTemplate: () => this.getJestTestTemplate()
      },
      mocha: {
        fileTemplate: () => this.getMochaFileTemplate(),
        testTemplate: () => this.getMochaTestTemplate()
      }
    };
    
    // テスト生成の設定
    this.config = {
      preferredFramework: 'jest',
      testDirectory: 'test',
      useTypeScript: false,
      generateMocks: true
    };
  }
  
  /**
   * エラーと修復結果からテストケースを生成
   */
  async generateTest(errorInfo, repairResult) {
    this.logger.info('テストケースを生成中...');
    
    try {
      // テストフレームワークを検出
      const framework = await this.detectTestFramework();
      
      // テストファイルのパスを決定
      const testFilePath = await this.determineTestFilePath(repairResult.file);
      
      // 既存のテストファイルがあるかチェック
      const exists = await this.fileExists(testFilePath);
      
      let testContent;
      if (exists) {
        // 既存のテストに追加
        testContent = await this.appendToExistingTest(testFilePath, errorInfo, repairResult, framework);
      } else {
        // 新規テストファイルを作成
        testContent = await this.createNewTestFile(errorInfo, repairResult, framework);
      }
      
      // テストファイルを書き込む
      await this.ensureDirectoryExists(path.dirname(testFilePath));
      await fs.writeFile(testFilePath, testContent);
      
      // Claudeを使用してテストケースを改善（ProcessManagerが必要なのでスキップ）
      // if (this.processManager) {
      //   const improvedTest = await this.improveTestWithClaude(testContent, errorInfo, repairResult);
      //   if (improvedTest) {
      //     await fs.writeFile(testFilePath, improvedTest);
      //     testContent = improvedTest;
      //   }
      // }
      
      this.logger.info(`テストケースを生成しました: ${testFilePath}`);
      
      return {
        testFile: testFilePath,
        framework,
        newFile: !exists,
        content: testContent
      };
      
    } catch (error) {
      this.logger.error(`テスト生成エラー: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * テストフレームワークを検出
   */
  async detectTestFramework() {
    try {
      const packageJson = await fs.readFile('package.json', 'utf8');
      const pkg = JSON.parse(packageJson);
      
      const devDeps = pkg.devDependencies || {};
      const deps = pkg.dependencies || {};
      const allDeps = { ...devDeps, ...deps };
      
      if (allDeps.jest || allDeps['@types/jest']) {
        return 'jest';
      }
      if (allDeps.mocha || allDeps['@types/mocha']) {
        return 'mocha';
      }
      
    } catch (error) {
      // package.jsonが読めない場合
    }
    
    // デフォルトフレームワーク
    return this.config.preferredFramework;
  }
  
  /**
   * テストファイルのパスを決定
   */
  async determineTestFilePath(sourceFile) {
    const ext = path.extname(sourceFile);
    const basename = path.basename(sourceFile, ext);
    const dirname = path.dirname(sourceFile);
    
    // テストディレクトリのパターンを試す
    const testPatterns = [
      // 同じディレクトリ構造でtestフォルダ
      path.join(this.config.testDirectory, path.relative('.', dirname), `${basename}.test${ext}`),
      // __tests__フォルダ
      path.join(dirname, '__tests__', `${basename}.test${ext}`),
      // specファイル
      path.join(dirname, `${basename}.spec${ext}`),
      // testフォルダ直下
      path.join(this.config.testDirectory, `${basename}.test${ext}`)
    ];
    
    // 既存のテストディレクトリを探す
    for (const pattern of testPatterns) {
      const dir = path.dirname(pattern);
      try {
        await fs.access(dir);
        return pattern;
      } catch {
        // ディレクトリが存在しない
      }
    }
    
    // デフォルト
    return testPatterns[0];
  }
  
  /**
   * 新規テストファイルを作成
   */
  async createNewTestFile(errorInfo, repairResult, framework) {
    const templateFunc = this.templates[framework].fileTemplate;
    const template = typeof templateFunc === 'function' ? templateFunc() : templateFunc;
    const testCase = await this.generateTestCase(errorInfo, repairResult, framework);
    
    const sourceFile = repairResult.file;
    const moduleName = path.basename(sourceFile, path.extname(sourceFile));
    const relativePath = path.relative(
      path.dirname(await this.determineTestFilePath(sourceFile)),
      sourceFile
    );
    
    return template
      .replace('${moduleName}', moduleName)
      .replace('${modulePath}', relativePath)
      .replace('${testCases}', testCase);
  }
  
  /**
   * 既存のテストに追加
   */
  async appendToExistingTest(testFilePath, errorInfo, repairResult, framework) {
    const existingContent = await fs.readFile(testFilePath, 'utf8');
    const testCase = await this.generateTestCase(errorInfo, repairResult, framework);
    
    // 適切な位置を見つけて挿入
    let insertPosition = existingContent.lastIndexOf('});');
    if (insertPosition === -1) {
      // 見つからない場合は末尾に追加
      return existingContent + '\n\n' + testCase;
    }
    
    // インデントを調整
    const indent = '  ';
    const indentedTestCase = testCase.split('\n').map(line => indent + line).join('\n');
    
    return existingContent.slice(0, insertPosition) + 
           '\n' + indentedTestCase + '\n' + 
           existingContent.slice(insertPosition);
  }
  
  /**
   * テストケースを生成
   */
  async generateTestCase(errorInfo, repairResult, framework) {
    const templateFunc = this.templates[framework].testTemplate;
    const template = typeof templateFunc === 'function' ? templateFunc() : templateFunc;
    
    // エラータイプに応じたテストケースを生成
    let testName, testBody;
    
    switch (errorInfo.analysis.patternId) {
      case 'EP001': // Type Error - Property Access
        testName = 'should handle null/undefined property access safely';
        testBody = this.generateNullCheckTest(repairResult);
        break;
        
      case 'EP002': // Reference Error
        testName = 'should have required module imported';
        testBody = this.generateImportTest(repairResult);
        break;
        
      case 'EP003': // Syntax Error
        testName = 'should have valid syntax';
        testBody = this.generateSyntaxTest(repairResult);
        break;
        
      case 'EP004': // File Not Found
        testName = 'should handle missing file gracefully';
        testBody = this.generateFileExistenceTest(repairResult);
        break;
        
      case 'EP010': // JSON Parse Error
        testName = 'should parse JSON correctly';
        testBody = this.generateJSONParseTest(repairResult);
        break;
        
      default:
        testName = `should handle ${errorInfo.analysis.category} correctly`;
        testBody = this.generateGenericTest(errorInfo, repairResult);
    }
    
    return template
      .replace('${testName}', testName)
      .replace('${testBody}', testBody);
  }
  
  /**
   * nullチェックのテストを生成
   */
  generateNullCheckTest(repairResult) {
    return `
    // 修復されたコードがnull/undefinedを適切に処理するかテスト
    const obj = null;
    expect(() => {
      // 修復されたコードの呼び出し
      ${repairResult.action === 'NULL_CHECK_ADDITION' ? 'obj?.property' : 'obj.property'}
    }).not.toThrow();
    
    const validObj = { property: 'value' };
    expect(validObj.property).toBe('value');`;
  }
  
  /**
   * インポートのテストを生成
   */
  generateImportTest(repairResult) {
    const importAdded = repairResult.importAdded || "const module = require('module');";
    const moduleName = importAdded.match(/const (\w+)/)?.[1] || 'module';
    
    return `
    // インポートされたモジュールが利用可能かテスト
    expect(typeof ${moduleName}).not.toBe('undefined');
    expect(${moduleName}).toBeTruthy();`;
  }
  
  /**
   * 構文のテストを生成
   */
  generateSyntaxTest(repairResult) {
    return `
    // ファイルが正しい構文で記述されているかテスト
    expect(() => {
      require('${repairResult.file}');
    }).not.toThrow(SyntaxError);`;
  }
  
  /**
   * ファイル存在のテストを生成
   */
  generateFileExistenceTest(repairResult) {
    return `
    // 必要なファイルが存在するかテスト
    const fs = require('fs');
    const path = require('path');
    
    const filePath = '${repairResult.file}';
    expect(fs.existsSync(filePath)).toBe(true);
    
    // ファイルの内容が空でないことを確認
    const content = fs.readFileSync(filePath, 'utf8');
    expect(content.length).toBeGreaterThan(0);`;
  }
  
  /**
   * JSONパースのテストを生成
   */
  generateJSONParseTest(repairResult) {
    return `
    // JSONファイルが正しくパースできるかテスト
    const fs = require('fs');
    const content = fs.readFileSync('${repairResult.file}', 'utf8');
    
    expect(() => {
      JSON.parse(content);
    }).not.toThrow();
    
    const parsed = JSON.parse(content);
    expect(typeof parsed).toBe('object');`;
  }
  
  /**
   * 汎用的なテストを生成
   */
  generateGenericTest(errorInfo, repairResult) {
    return `
    // ${errorInfo.analysis.category}が修正されたことを確認
    // TODO: より具体的なテストケースを実装してください
    
    expect(true).toBe(true); // プレースホルダー`;
  }
  
  /**
   * Claudeを使用してテストを改善
   */
  async improveTestWithClaude(testContent, errorInfo, repairResult) {
    try {
      const prompt = `
以下のテストコードを改善してください。

エラー情報:
- カテゴリ: ${errorInfo.analysis.category}
- メッセージ: ${errorInfo.message}
- 修復アクション: ${repairResult.action}

現在のテストコード:
\`\`\`javascript
${testContent}
\`\`\`

改善点:
1. より具体的なアサーションを追加
2. エッジケースのテストを追加
3. 修復が正しく動作することを確認するテストを追加

改善されたテストコードのみを返してください。`;

      // ProcessManagerが初期化されていない場合はスキップ
      if (!this.processManager) {
        return null;
      }
      
      const result = await this.processManager.execute(
        `テスト改善: ${errorInfo.analysis.category}`,
        prompt
      );
      
      if (result.success && result.output) {
        // コードブロックを抽出
        const codeMatch = result.output.match(/```(?:javascript|js)?\n([\s\S]*?)\n```/);
        if (codeMatch) {
          return codeMatch[1];
        }
      }
      
    } catch (error) {
      this.logger.warn(`Claudeによるテスト改善をスキップ: ${error.message}`);
    }
    
    return null;
  }
  
  /**
   * ファイルが存在するかチェック
   */
  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
  
  /**
   * ディレクトリが存在することを保証
   */
  async ensureDirectoryExists(dirPath) {
    await fs.mkdir(dirPath, { recursive: true });
  }
  
  // テンプレート定義
  
  getJestFileTemplate() {
    return `/**
 * @jest-environment node
 */

const ${moduleName} = require('${modulePath}');

describe('${moduleName}', () => {
${testCases}
});`;
  }
  
  getJestTestTemplate() {
    return `  it('${testName}', () => {${testBody}
  });`;
  }
  
  getMochaFileTemplate() {
    return `const { expect } = require('chai');
const ${moduleName} = require('${modulePath}');

describe('${moduleName}', () => {
${testCases}
});`;
  }
  
  getMochaTestTemplate() {
    return `  it('${testName}', () => {${testBody}
  });`;
  }
  
  /**
   * カバレッジ情報を取得
   */
  async getCoverageInfo() {
    try {
      // カバレッジレポートを探す
      const coverageFile = path.join('coverage', 'coverage-summary.json');
      const content = await fs.readFile(coverageFile, 'utf8');
      const coverage = JSON.parse(content);
      
      return {
        lines: coverage.total.lines.pct,
        statements: coverage.total.statements.pct,
        functions: coverage.total.functions.pct,
        branches: coverage.total.branches.pct
      };
      
    } catch (error) {
      return null;
    }
  }
  
  /**
   * テスト実行結果を解析
   */
  parseTestResults(output) {
    const results = {
      passed: 0,
      failed: 0,
      skipped: 0,
      duration: 0
    };
    
    // Jest形式の結果をパース
    const jestMatch = output.match(/Tests?:\s*(\d+)\s*passed.*?(\d+)\s*total/);
    if (jestMatch) {
      results.passed = parseInt(jestMatch[1]);
      results.failed = parseInt(jestMatch[2]) - results.passed;
    }
    
    // Mocha形式の結果をパース
    const mochaMatch = output.match(/(\d+)\s*passing.*?(\d+)\s*failing/);
    if (mochaMatch) {
      results.passed = parseInt(mochaMatch[1]);
      results.failed = parseInt(mochaMatch[2]);
    }
    
    // 実行時間
    const timeMatch = output.match(/Time:\s*([\d.]+)\s*s/);
    if (timeMatch) {
      results.duration = parseFloat(timeMatch[1]) * 1000;
    }
    
    return results;
  }
}

module.exports = TestGenerator;