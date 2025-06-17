/**
 * JSON解析エラーの修復戦略
 * EP010: JSON Parse Error
 */

const fs = require('fs').promises;
const path = require('path');

class JsonParseRepairStrategy {
  constructor(logger = console) {
    this.logger = logger;
    this.id = 'EP010';
    this.name = 'JSON_PARSE_REPAIR';
  }
  
  /**
   * 修復可能かチェック
   */
  async canRepair(error, context) {
    // JSON解析エラーかチェック
    if (!error.message.includes('JSON') && 
        !error.message.includes('Unexpected token') &&
        !error.message.includes('Unexpected end of JSON')) {
      return false;
    }
    
    // ファイルパスを特定できるか
    const filePath = this.extractFilePath(error);
    if (!filePath) {
      return false;
    }
    
    // JSONファイルかチェック
    if (!filePath.endsWith('.json')) {
      return false;
    }
    
    // ファイルが存在するか
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
  
  /**
   * 修復実行
   */
  async repair(error, context) {
    const filePath = this.extractFilePath(error);
    if (!filePath) {
      throw new Error('JSONファイルパスを特定できません');
    }
    
    this.logger.info(`JSON修復を試みます: ${filePath}`);
    
    // ファイル内容を読み込む
    let content = await fs.readFile(filePath, 'utf8');
    
    // 修復戦略を順番に試す
    const strategies = [
      this.fixTrailingComma.bind(this),
      this.fixMissingQuotes.bind(this),
      this.fixSingleQuotes.bind(this),
      this.fixMissingBrackets.bind(this),
      this.fixUnescapedCharacters.bind(this),
      this.fixComments.bind(this),
      this.fixEmptyFile.bind(this),
      this.fixInvalidValues.bind(this)
    ];
    
    let repairedContent = content;
    let appliedFixes = [];
    
    for (const strategy of strategies) {
      const result = strategy(repairedContent);
      if (result.fixed) {
        repairedContent = result.content;
        appliedFixes.push(result.description);
      }
    }
    
    // 修復後の検証
    try {
      JSON.parse(repairedContent);
    } catch (parseError) {
      // 最終手段：空のJSONオブジェクトに置き換え
      this.logger.warn('JSON修復失敗、空のオブジェクトに置き換えます');
      repairedContent = '{}';
      appliedFixes.push('空のJSONオブジェクトに置き換え');
    }
    
    // ファイルに書き込む
    await fs.writeFile(filePath, repairedContent, 'utf8');
    
    this.logger.info(`JSON修復完了: ${appliedFixes.join(', ')}`);
    
    return {
      success: true,
      action: 'json_repaired',
      filePath: filePath,
      fixes: appliedFixes,
      originalSize: content.length,
      repairedSize: repairedContent.length
    };
  }
  
  /**
   * ファイルパスの抽出
   */
  extractFilePath(error) {
    // エラーメッセージからファイルパスを抽出
    const patterns = [
      /Failed to parse JSON from ([^\s]+)/,
      /JSON\.parse\s*\([^)]*readFileSync\(['"]([^'"]+)['"]\)/,
      /Error parsing ([^\s]+)/,
      /in\s+([^\s]+\.json)/i
    ];
    
    for (const pattern of patterns) {
      const match = error.message.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }
    
    // スタックトレースからも検索
    if (error.stackTrace && error.stackTrace.length > 0) {
      for (const line of error.stackTrace) {
        const match = line.match(/([^\s]+\.json)/i);
        if (match) {
          return match[1];
        }
      }
    }
    
    return null;
  }
  
  /**
   * 末尾カンマの修正
   */
  fixTrailingComma(content) {
    const fixed = content.replace(/,(\s*[}\]])/g, '$1');
    return {
      fixed: fixed !== content,
      content: fixed,
      description: '末尾カンマを削除'
    };
  }
  
  /**
   * クォート不足の修正
   */
  fixMissingQuotes(content) {
    // キーのクォート不足を修正
    let fixed = content.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":');
    
    // 値のクォート不足を修正（数値、boolean、null以外）
    fixed = fixed.replace(/:(\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*([,}])/g, (match, space, value, end) => {
      if (['true', 'false', 'null'].includes(value)) {
        return match;
      }
      return `:${space}"${value}"${end}`;
    });
    
    return {
      fixed: fixed !== content,
      content: fixed,
      description: 'クォート不足を修正'
    };
  }
  
  /**
   * シングルクォートの修正
   */
  fixSingleQuotes(content) {
    // シングルクォートをダブルクォートに変換
    const fixed = content.replace(/'/g, '"');
    return {
      fixed: fixed !== content,
      content: fixed,
      description: 'シングルクォートをダブルクォートに変換'
    };
  }
  
  /**
   * 括弧不足の修正
   */
  fixMissingBrackets(content) {
    let fixed = content.trim();
    
    // 開始括弧の確認
    if (!fixed.startsWith('{') && !fixed.startsWith('[')) {
      fixed = '{' + fixed;
    }
    
    // 終了括弧の確認
    if (fixed.startsWith('{') && !fixed.endsWith('}')) {
      fixed = fixed + '}';
    } else if (fixed.startsWith('[') && !fixed.endsWith(']')) {
      fixed = fixed + ']';
    }
    
    return {
      fixed: fixed !== content,
      content: fixed,
      description: '括弧不足を修正'
    };
  }
  
  /**
   * エスケープされていない文字の修正
   */
  fixUnescapedCharacters(content) {
    // 改行、タブ、バックスラッシュをエスケープ
    let fixed = content;
    
    // 文字列内の改行を検出して修正
    fixed = fixed.replace(/"([^"]*)\n([^"]*)"/, '"$1\\n$2"');
    fixed = fixed.replace(/"([^"]*)\t([^"]*)"/, '"$1\\t$2"');
    
    return {
      fixed: fixed !== content,
      content: fixed,
      description: 'エスケープされていない文字を修正'
    };
  }
  
  /**
   * コメントの削除
   */
  fixComments(content) {
    // 単一行コメントを削除
    let fixed = content.replace(/\/\/.*$/gm, '');
    
    // 複数行コメントを削除
    fixed = fixed.replace(/\/\*[\s\S]*?\*\//g, '');
    
    return {
      fixed: fixed !== content,
      content: fixed,
      description: 'コメントを削除'
    };
  }
  
  /**
   * 空ファイルの修正
   */
  fixEmptyFile(content) {
    const trimmed = content.trim();
    if (trimmed === '') {
      return {
        fixed: true,
        content: '{}',
        description: '空ファイルを空オブジェクトに変換'
      };
    }
    return {
      fixed: false,
      content: content,
      description: ''
    };
  }
  
  /**
   * 無効な値の修正
   */
  fixInvalidValues(content) {
    // undefined を null に変換
    let fixed = content.replace(/:\s*undefined\s*([,}])/g, ': null$1');
    
    // NaN を null に変換
    fixed = fixed.replace(/:\s*NaN\s*([,}])/g, ': null$1');
    
    // Infinity を null に変換
    fixed = fixed.replace(/:\s*Infinity\s*([,}])/g, ': null$1');
    
    return {
      fixed: fixed !== content,
      content: fixed,
      description: '無効な値を修正'
    };
  }
  
  /**
   * 検証
   */
  async validate(repairResult) {
    if (!repairResult.filePath) {
      return { valid: false, reason: 'ファイルパスが指定されていません' };
    }
    
    try {
      // ファイルを読み込んでJSON解析
      const content = await fs.readFile(repairResult.filePath, 'utf8');
      JSON.parse(content);
      
      return { valid: true };
    } catch (error) {
      return { valid: false, reason: `JSON解析エラー: ${error.message}` };
    }
  }
}

module.exports = JsonParseRepairStrategy;