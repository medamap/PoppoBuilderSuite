/**
 * ファイル未検出エラーの修復戦略
 * EP004: File Not Found
 */

const fs = require('fs').promises;
const path = require('path');

class FileNotFoundRepairStrategy {
  constructor(logger = console) {
    this.logger = logger;
    this.id = 'EP004';
    this.name = 'FILE_NOT_FOUND_REPAIR';
    
    // デフォルトファイルテンプレート
    this.defaultTemplates = {
      'config.json': {
        content: '{}',
        encoding: 'utf8'
      },
      '.env': {
        content: '# Environment variables\n',
        encoding: 'utf8'
      },
      'package.json': {
        content: JSON.stringify({
          name: 'auto-generated',
          version: '1.0.0',
          description: 'Auto-generated package.json',
          main: 'index.js',
          scripts: {},
          dependencies: {}
        }, null, 2),
        encoding: 'utf8'
      },
      '.gitignore': {
        content: 'node_modules/\n.env\n*.log\n',
        encoding: 'utf8'
      }
    };
  }
  
  /**
   * 修復可能かチェック
   */
  async canRepair(error, context) {
    // ENOENTエラーかチェック
    if (!error.message.includes('ENOENT') && !error.message.includes('no such file or directory')) {
      return false;
    }
    
    // ファイルパスを抽出
    const filePath = this.extractFilePath(error);
    if (!filePath) {
      return false;
    }
    
    // 設定ファイルのみ修復可能
    const fileName = path.basename(filePath);
    const isConfigFile = this.isConfigFile(fileName);
    
    return isConfigFile;
  }
  
  /**
   * 修復実行
   */
  async repair(error, context) {
    const filePath = this.extractFilePath(error);
    if (!filePath) {
      throw new Error('ファイルパスを特定できません');
    }
    
    const fileName = path.basename(filePath);
    const dirPath = path.dirname(filePath);
    
    this.logger.info(`ファイル作成を試みます: ${filePath}`);
    
    // ディレクトリが存在しない場合は作成
    await this.ensureDirectoryExists(dirPath);
    
    // デフォルトコンテンツの取得
    const defaultContent = this.getDefaultContent(fileName, context);
    
    // ファイル作成
    await fs.writeFile(filePath, defaultContent.content, defaultContent.encoding);
    
    this.logger.info(`ファイルを作成しました: ${filePath}`);
    
    return {
      success: true,
      action: 'file_created',
      filePath: filePath,
      content: defaultContent.content
    };
  }
  
  /**
   * ファイルパスの抽出
   */
  extractFilePath(error) {
    // エラーメッセージからファイルパスを抽出
    const patterns = [
      /ENOENT: no such file or directory, open '([^']+)'/,
      /ENOENT: no such file or directory, stat '([^']+)'/,
      /Cannot find module '([^']+)'/,
      /Failed to load config from ([^\s]+)/
    ];
    
    for (const pattern of patterns) {
      const match = error.message.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }
    
    // スタックトレースからも検索
    if (error.stackTrace && error.stackTrace.length > 0) {
      const stackLine = error.stackTrace[0];
      const stackMatch = stackLine.match(/\(([^:]+):\d+:\d+\)/);
      if (stackMatch && stackMatch[1]) {
        return stackMatch[1];
      }
    }
    
    return null;
  }
  
  /**
   * 設定ファイルかチェック
   */
  isConfigFile(fileName) {
    const configPatterns = [
      /^config\.(json|js|yaml|yml)$/i,
      /^\.env(\.\w+)?$/,
      /^package\.json$/,
      /^tsconfig\.json$/,
      /^\.gitignore$/,
      /^\.eslintrc\.(json|js)$/,
      /\.config\.(json|js)$/
    ];
    
    return configPatterns.some(pattern => pattern.test(fileName));
  }
  
  /**
   * デフォルトコンテンツの取得
   */
  getDefaultContent(fileName, context) {
    // テンプレートが存在する場合
    if (this.defaultTemplates[fileName]) {
      return this.defaultTemplates[fileName];
    }
    
    // 拡張子に基づいてデフォルトコンテンツを生成
    const ext = path.extname(fileName).toLowerCase();
    
    switch (ext) {
      case '.json':
        return {
          content: '{}',
          encoding: 'utf8'
        };
        
      case '.yaml':
      case '.yml':
        return {
          content: '# Auto-generated YAML file\n',
          encoding: 'utf8'
        };
        
      case '.js':
        return {
          content: '// Auto-generated JavaScript file\nmodule.exports = {};\n',
          encoding: 'utf8'
        };
        
      case '.env':
        return {
          content: '# Environment variables\n',
          encoding: 'utf8'
        };
        
      default:
        return {
          content: '',
          encoding: 'utf8'
        };
    }
  }
  
  /**
   * ディレクトリ作成
   */
  async ensureDirectoryExists(dirPath) {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }
  
  /**
   * 検証
   */
  async validate(repairResult) {
    if (!repairResult.filePath) {
      return { valid: false, reason: 'ファイルパスが指定されていません' };
    }
    
    try {
      // ファイルが存在することを確認
      await fs.access(repairResult.filePath);
      
      // JSONファイルの場合は構文チェック
      if (repairResult.filePath.endsWith('.json')) {
        const content = await fs.readFile(repairResult.filePath, 'utf8');
        JSON.parse(content);
      }
      
      return { valid: true };
    } catch (error) {
      return { valid: false, reason: error.message };
    }
  }
}

module.exports = FileNotFoundRepairStrategy;