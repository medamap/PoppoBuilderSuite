/**
 * NULLチェック不足エラーの修復戦略
 * EP001: Type Error - Property Access
 */

const fs = require('fs').promises;
const path = require('path');

class NullCheckRepairStrategy {
  constructor(logger = console) {
    this.logger = logger;
    this.id = 'EP001';
    this.name = 'NULL_CHECK_REPAIR';
  }
  
  /**
   * 修復可能かチェック
   */
  async canRepair(error, context) {
    // Type Errorかチェック
    if (!error.message.includes('Cannot read property') && 
        !error.message.includes('Cannot access property')) {
      return false;
    }
    
    // スタックトレースから修復位置を特定できるか
    const location = this.extractLocation(error);
    if (!location || !location.file || !location.line) {
      return false;
    }
    
    // ファイルが存在するか
    try {
      await fs.access(location.file);
      return true;
    } catch {
      return false;
    }
  }
  
  /**
   * 修復実行
   */
  async repair(error, context) {
    const location = this.extractLocation(error);
    const propertyInfo = this.extractPropertyInfo(error);
    
    if (!location || !propertyInfo) {
      throw new Error('修復に必要な情報を抽出できません');
    }
    
    this.logger.info(`NULLチェックを追加: ${location.file}:${location.line}`);
    
    // ソースコードを読み込む
    const sourceCode = await fs.readFile(location.file, 'utf8');
    const lines = sourceCode.split('\n');
    
    // 対象行を取得
    const targetLineIndex = location.line - 1;
    if (targetLineIndex >= lines.length) {
      throw new Error('行番号が範囲外です');
    }
    
    const targetLine = lines[targetLineIndex];
    
    // 修復方法を決定
    const repairMethod = this.determineRepairMethod(targetLine, propertyInfo);
    
    // 修復を適用
    const repairedCode = this.applyRepair(lines, targetLineIndex, repairMethod);
    
    // ファイルに書き込む
    await fs.writeFile(location.file, repairedCode, 'utf8');
    
    this.logger.info(`修復完了: ${repairMethod.type}`);
    
    return {
      success: true,
      action: 'null_check_added',
      filePath: location.file,
      line: location.line,
      method: repairMethod.type,
      originalCode: targetLine,
      repairedCode: lines[targetLineIndex]
    };
  }
  
  /**
   * エラー位置の抽出
   */
  extractLocation(error) {
    if (!error.stackTrace || error.stackTrace.length === 0) {
      return null;
    }
    
    // スタックトレースの最初の行から位置情報を抽出
    const stackLine = error.stackTrace[0];
    const match = stackLine.match(/at\s+.*?\s+\(([^:]+):(\d+):(\d+)\)/);
    
    if (match) {
      return {
        file: match[1],
        line: parseInt(match[2], 10),
        column: parseInt(match[3], 10)
      };
    }
    
    // 別の形式も試す
    const altMatch = stackLine.match(/([^:]+):(\d+):(\d+)/);
    if (altMatch) {
      return {
        file: altMatch[1],
        line: parseInt(altMatch[2], 10),
        column: parseInt(altMatch[3], 10)
      };
    }
    
    return null;
  }
  
  /**
   * プロパティ情報の抽出
   */
  extractPropertyInfo(error) {
    const match = error.message.match(/Cannot read property ['"](\w+)['"] of (undefined|null)/i);
    
    if (match) {
      return {
        property: match[1],
        value: match[2]
      };
    }
    
    return null;
  }
  
  /**
   * 修復方法の決定
   */
  determineRepairMethod(line, propertyInfo) {
    // オプショナルチェイニングが使用可能かチェック
    const canUseOptionalChaining = this.canUseOptionalChaining(line);
    
    // プロパティアクセスパターンを検出
    const patterns = [
      {
        // obj.prop の形式
        regex: new RegExp(`(\\w+)\\.${propertyInfo.property}(?![\\w$])`),
        type: 'simple_property'
      },
      {
        // obj['prop'] の形式
        regex: new RegExp(`(\\w+)\\['${propertyInfo.property}'\\]`),
        type: 'bracket_property'
      },
      {
        // obj.method().prop の形式
        regex: new RegExp(`([\\w\\.\\(\\)]+)\\.${propertyInfo.property}(?![\\w$])`),
        type: 'chained_property'
      }
    ];
    
    for (const pattern of patterns) {
      const match = line.match(pattern.regex);
      if (match) {
        return {
          type: canUseOptionalChaining ? 'optional_chaining' : 'conditional_check',
          pattern: pattern.type,
          object: match[1],
          property: propertyInfo.property
        };
      }
    }
    
    // デフォルトの修復方法
    return {
      type: 'conditional_check',
      pattern: 'unknown',
      property: propertyInfo.property
    };
  }
  
  /**
   * 修復の適用
   */
  applyRepair(lines, targetLineIndex, repairMethod) {
    const targetLine = lines[targetLineIndex];
    const indent = this.getIndentation(targetLine);
    
    if (repairMethod.type === 'optional_chaining') {
      // オプショナルチェイニングを使用
      lines[targetLineIndex] = targetLine.replace(
        new RegExp(`(${repairMethod.object})\\.${repairMethod.property}`, 'g'),
        `$1?.${repairMethod.property}`
      );
    } else {
      // 条件チェックを追加
      const condition = `if (${repairMethod.object}) {`;
      const endCondition = '}';
      
      // 既存の行をインデント
      lines[targetLineIndex] = '  ' + targetLine;
      
      // 条件文を挿入
      lines.splice(targetLineIndex, 0, indent + condition);
      lines.splice(targetLineIndex + 2, 0, indent + endCondition);
    }
    
    return lines.join('\n');
  }
  
  /**
   * オプショナルチェイニングが使用可能かチェック
   */
  canUseOptionalChaining(line) {
    // 代入式でない場合はオプショナルチェイニングを使用可能
    return !line.includes('=') || line.indexOf('=') > line.indexOf('.');
  }
  
  /**
   * インデントの取得
   */
  getIndentation(line) {
    const match = line.match(/^(\s*)/);
    return match ? match[1] : '';
  }
  
  /**
   * 検証
   */
  async validate(repairResult) {
    if (!repairResult.filePath) {
      return { valid: false, reason: 'ファイルパスが指定されていません' };
    }
    
    try {
      // ファイルを読み込んで構文チェック
      const content = await fs.readFile(repairResult.filePath, 'utf8');
      
      // 簡易的な構文チェック（本来はAST解析が望ましい）
      new Function(content);
      
      return { valid: true };
    } catch (error) {
      return { valid: false, reason: `構文エラー: ${error.message}` };
    }
  }
}

module.exports = NullCheckRepairStrategy;