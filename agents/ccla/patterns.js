/**
 * 修復パターンライブラリ
 * 一般的なエラーパターンの修復方法を定義
 */

const fs = require('fs').promises;
const path = require('path');

/**
 * 修復パターンの定義
 * 各パターンは以下の構造を持つ：
 * - id: パターンID（エラーパターンIDと対応）
 * - name: パターン名
 * - canAutoRepair: 自動修復可能かを判定する関数
 * - repair: 実際の修復を行う関数
 * - testRequired: 修復後のテストが必要か
 * - rollbackSupported: ロールバック可能か
 */
const repairPatterns = {
  // EP001: Type Error - Property Access
  'EP001': {
    id: 'EP001',
    name: 'NULL_CHECK_ADDITION',
    description: 'プロパティアクセス前のnullチェックを追加',
    testRequired: true,
    rollbackSupported: true,
    
    canAutoRepair: (error) => {
      // スタックトレースから修復可能な位置を特定できるか
      if (!error.stackTrace || error.stackTrace.length === 0) {
        return false;
      }
      
      const location = extractLocation(error.stackTrace[0]);
      if (!location.file || !location.line) {
        return false;
      }
      
      // プロパティアクセスエラーのパターンに一致するか
      const propertyMatch = error.message.match(/Cannot read property ['"](\w+)['"] of (undefined|null)/i);
      return !!propertyMatch;
    },
    
    repair: async (error, context) => {
      const location = extractLocation(error.stackTrace[0]);
      const propertyMatch = error.message.match(/Cannot read property ['"](\w+)['"] of (undefined|null)/i);
      const propertyName = propertyMatch[1];
      
      // ソースコードを読み込む
      const sourceCode = await fs.readFile(location.file, 'utf8');
      const lines = sourceCode.split('\n');
      
      // エラー行を取得
      const errorLine = lines[location.line - 1];
      
      // 修復戦略を決定
      const repairStrategy = determineNullCheckStrategy(errorLine, propertyName);
      
      // 修復を適用
      const { repairedLines, changes } = applyNullCheck(lines, location.line - 1, repairStrategy);
      
      // バックアップを作成
      const backupPath = `${location.file}.backup.${Date.now()}`;
      await fs.writeFile(backupPath, sourceCode);
      
      // 修復済みコードを書き込む
      await fs.writeFile(location.file, repairedLines.join('\n'));
      
      return {
        success: true,
        action: 'NULL_CHECK_ADDITION',
        file: location.file,
        line: location.line,
        backupPath,
        changes
      };
    }
  },
  
  // EP002: Reference Error - Undefined Variable
  'EP002': {
    id: 'EP002',
    name: 'AUTO_IMPORT',
    description: 'モジュールの自動インポート',
    testRequired: true,
    rollbackSupported: true,
    
    canAutoRepair: (error) => {
      // ReferenceErrorかチェック
      if (!error.message.match(/ReferenceError.*is not defined/i)) {
        return false;
      }
      
      // 一般的なモジュール名のパターンに一致するか
      const varMatch = error.message.match(/(\w+) is not defined/);
      if (!varMatch) return false;
      
      const varName = varMatch[1];
      // よく使われるNode.jsモジュールやパッケージ名のパターン
      const commonModules = ['fs', 'path', 'crypto', 'util', 'events', 'stream', 'http', 'https'];
      
      return commonModules.includes(varName.toLowerCase()) || 
             isLikelyModuleName(varName);
    },
    
    repair: async (error, context) => {
      const location = extractLocation(error.stackTrace[0]);
      const varMatch = error.message.match(/(\w+) is not defined/);
      const varName = varMatch[1];
      
      // インポート文を推測
      const importStatement = guessImportStatement(varName, location.file);
      
      // ソースコードを読み込む
      const sourceCode = await fs.readFile(location.file, 'utf8');
      const lines = sourceCode.split('\n');
      
      // インポート文を挿入する位置を決定
      const insertPosition = findImportInsertPosition(lines);
      
      // バックアップを作成
      const backupPath = `${location.file}.backup.${Date.now()}`;
      await fs.writeFile(backupPath, sourceCode);
      
      // インポート文を挿入
      lines.splice(insertPosition, 0, importStatement);
      
      // 修復済みコードを書き込む
      await fs.writeFile(location.file, lines.join('\n'));
      
      return {
        success: true,
        action: 'AUTO_IMPORT',
        file: location.file,
        line: insertPosition + 1,
        importAdded: importStatement,
        backupPath
      };
    }
  },
  
  // EP003: Syntax Error
  'EP003': {
    id: 'EP003',
    name: 'SYNTAX_CORRECTION',
    description: '構文エラーの修正',
    testRequired: true,
    rollbackSupported: true,
    
    canAutoRepair: (error) => {
      // 一般的な構文エラーパターンのみ自動修復
      const fixablePatterns = [
        /Unexpected token '}'/,
        /Missing semicolon/,
        /Unterminated string/,
        /Unexpected end of input/
      ];
      
      return fixablePatterns.some(pattern => pattern.test(error.message));
    },
    
    repair: async (error, context) => {
      const location = extractLocation(error.stackTrace[0]);
      
      // エラーの種類に応じた修復戦略
      let repairStrategy;
      if (error.message.includes('Unexpected token \'}\'')) {
        repairStrategy = 'REMOVE_EXTRA_BRACE';
      } else if (error.message.includes('Missing semicolon')) {
        repairStrategy = 'ADD_SEMICOLON';
      } else if (error.message.includes('Unterminated string')) {
        repairStrategy = 'CLOSE_STRING';
      } else if (error.message.includes('Unexpected end of input')) {
        repairStrategy = 'ADD_MISSING_BRACE';
      }
      
      const sourceCode = await fs.readFile(location.file, 'utf8');
      const lines = sourceCode.split('\n');
      
      // バックアップを作成
      const backupPath = `${location.file}.backup.${Date.now()}`;
      await fs.writeFile(backupPath, sourceCode);
      
      // 修復を適用
      const { repairedLines, changes } = applySyntaxFix(lines, location.line - 1, repairStrategy);
      
      // 修復済みコードを書き込む
      await fs.writeFile(location.file, repairedLines.join('\n'));
      
      return {
        success: true,
        action: 'SYNTAX_CORRECTION',
        strategy: repairStrategy,
        file: location.file,
        line: location.line,
        backupPath,
        changes
      };
    }
  },
  
  // EP004: File Not Found
  'EP004': {
    id: 'EP004',
    name: 'CREATE_MISSING_FILE',
    description: '不足しているファイルの作成',
    testRequired: false,
    rollbackSupported: true,
    
    canAutoRepair: (error) => {
      // ENOENTエラーかチェック
      if (!error.message.match(/ENOENT.*no such file or directory/i)) {
        return false;
      }
      
      // 設定ファイルやデータファイルのみ自動作成
      const filePath = extractFilePathFromError(error.message);
      if (!filePath) return false;
      
      const allowedExtensions = ['.json', '.yaml', '.yml', '.config', '.env'];
      const allowedNames = ['config.json', 'package.json', '.poppo'];
      
      const ext = path.extname(filePath);
      const basename = path.basename(filePath);
      
      return allowedExtensions.includes(ext) || allowedNames.includes(basename);
    },
    
    repair: async (error, context) => {
      const filePath = extractFilePathFromError(error.message);
      const ext = path.extname(filePath);
      const basename = path.basename(filePath);
      
      // デフォルトコンテンツを生成
      let defaultContent = '';
      if (ext === '.json' || basename === 'config.json') {
        defaultContent = '{}';
      } else if (ext === '.yaml' || ext === '.yml') {
        defaultContent = '# Auto-generated file\n';
      } else if (basename === '.env') {
        defaultContent = '# Environment variables\n';
      }
      
      // ディレクトリが存在しない場合は作成
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });
      
      // ファイルを作成
      await fs.writeFile(filePath, defaultContent);
      
      return {
        success: true,
        action: 'CREATE_MISSING_FILE',
        file: filePath,
        content: defaultContent,
        backupPath: null // 新規作成なのでバックアップは不要
      };
    }
  },
  
  // EP010: JSON Parse Error
  'EP010': {
    id: 'EP010',
    name: 'FIX_JSON_FORMAT',
    description: 'JSONフォーマットの修正',
    testRequired: false,
    rollbackSupported: true,
    
    canAutoRepair: (error) => {
      // JSON parseエラーかチェック
      if (!error.message.match(/JSON.*parse.*error|Unexpected.*JSON|Invalid JSON/i)) {
        return false;
      }
      
      // ファイルパスを特定できるか
      const filePath = extractJSONFilePathFromError(error);
      return !!filePath;
    },
    
    repair: async (error, context) => {
      const filePath = extractJSONFilePathFromError(error);
      
      // JSONファイルを読み込む
      const content = await fs.readFile(filePath, 'utf8');
      
      // バックアップを作成
      const backupPath = `${filePath}.backup.${Date.now()}`;
      await fs.writeFile(backupPath, content);
      
      // JSON修復を試みる
      const { repairedJSON, issues } = repairJSON(content);
      
      // 修復済みJSONを書き込む
      await fs.writeFile(filePath, repairedJSON);
      
      return {
        success: true,
        action: 'FIX_JSON_FORMAT',
        file: filePath,
        backupPath,
        issues,
        changes: {
          before: content.substring(0, 100) + '...',
          after: repairedJSON.substring(0, 100) + '...'
        }
      };
    }
  }
};

// ヘルパー関数

/**
 * スタックトレースから位置情報を抽出
 */
function extractLocation(stackLine) {
  const match = stackLine.match(/at .* \((.+):(\d+):(\d+)\)/);
  if (match) {
    return {
      file: match[1],
      line: parseInt(match[2]),
      column: parseInt(match[3])
    };
  }
  
  // 別のフォーマットを試す
  const match2 = stackLine.match(/at (.+):(\d+):(\d+)/);
  if (match2) {
    return {
      file: match2[1],
      line: parseInt(match2[2]),
      column: parseInt(match2[3])
    };
  }
  
  return { file: null, line: null, column: null };
}

/**
 * nullチェック戦略を決定
 */
function determineNullCheckStrategy(errorLine, propertyName) {
  // オブジェクト.プロパティのパターンを探す
  const patterns = [
    {
      // obj.prop のパターン
      regex: new RegExp(`(\\w+)\\.${propertyName}`),
      strategy: 'OPTIONAL_CHAINING'
    },
    {
      // obj['prop'] のパターン
      regex: new RegExp(`(\\w+)\\['${propertyName}'\\]`),
      strategy: 'BRACKET_CHECK'
    },
    {
      // 複雑なチェーンの場合
      regex: new RegExp(`(\\w+(?:\\.\\w+)+)\\.${propertyName}`),
      strategy: 'NESTED_CHECK'
    }
  ];
  
  for (const pattern of patterns) {
    if (pattern.regex.test(errorLine)) {
      return {
        type: pattern.strategy,
        match: errorLine.match(pattern.regex)
      };
    }
  }
  
  return { type: 'DEFAULT', match: null };
}

/**
 * nullチェックを適用
 */
function applyNullCheck(lines, errorLineIndex, strategy) {
  const changes = [];
  const repairedLines = [...lines];
  const errorLine = lines[errorLineIndex];
  
  switch (strategy.type) {
    case 'OPTIONAL_CHAINING':
      // obj.prop を obj?.prop に変更
      const newLine = errorLine.replace(
        strategy.match[0],
        strategy.match[0].replace('.', '?.')
      );
      repairedLines[errorLineIndex] = newLine;
      changes.push({
        line: errorLineIndex + 1,
        before: errorLine,
        after: newLine
      });
      break;
      
    case 'BRACKET_CHECK':
      // if文でラップ
      const indent = errorLine.match(/^(\s*)/)[1];
      const objName = strategy.match[1];
      repairedLines.splice(errorLineIndex, 1,
        `${indent}if (${objName}) {`,
        `${indent}  ${errorLine.trim()}`,
        `${indent}}`
      );
      changes.push({
        line: errorLineIndex + 1,
        before: errorLine,
        after: repairedLines.slice(errorLineIndex, errorLineIndex + 3).join('\n')
      });
      break;
      
    default:
      // デフォルトの修復戦略
      const defaultIndent = errorLine.match(/^(\s*)/)[1];
      repairedLines.splice(errorLineIndex, 0,
        `${defaultIndent}// Auto-added null check`,
        `${defaultIndent}if (typeof obj !== 'undefined' && obj !== null) {`
      );
      repairedLines.splice(errorLineIndex + 3, 0,
        `${defaultIndent}}`
      );
      changes.push({
        line: errorLineIndex + 1,
        description: 'Added null check wrapper'
      });
  }
  
  return { repairedLines, changes };
}

/**
 * モジュール名の可能性を判定
 */
function isLikelyModuleName(varName) {
  // 一般的なモジュール名のパターン
  const patterns = [
    /^[A-Z][a-zA-Z]*$/,  // PascalCase (React, Express)
    /^[a-z]+$/,          // lowercase (axios, lodash)
    /^[a-z]+[A-Z]/       // camelCase (jsonWebToken)
  ];
  
  return patterns.some(pattern => pattern.test(varName));
}

/**
 * インポート文を推測
 */
function guessImportStatement(varName, filePath) {
  const lowerName = varName.toLowerCase();
  
  // Node.js組み込みモジュール
  const builtinModules = {
    'fs': "const fs = require('fs');",
    'path': "const path = require('path');",
    'crypto': "const crypto = require('crypto');",
    'util': "const util = require('util');",
    'events': "const events = require('events');",
    'stream': "const stream = require('stream');",
    'http': "const http = require('http');",
    'https': "const https = require('https');"
  };
  
  if (builtinModules[lowerName]) {
    return builtinModules[lowerName];
  }
  
  // 一般的なパッケージ
  const commonPackages = {
    'express': "const express = require('express');",
    'axios': "const axios = require('axios');",
    'lodash': "const _ = require('lodash');",
    'moment': "const moment = require('moment');"
  };
  
  if (commonPackages[lowerName]) {
    return commonPackages[lowerName];
  }
  
  // デフォルト
  return `const ${varName} = require('${lowerName}');`;
}

/**
 * インポート文を挿入する位置を見つける
 */
function findImportInsertPosition(lines) {
  let lastImportIndex = -1;
  let firstNonCommentIndex = -1;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // コメントやshebangをスキップ
    if (line.startsWith('#!') || line.startsWith('//') || line.startsWith('/*')) {
      continue;
    }
    
    if (firstNonCommentIndex === -1 && line !== '') {
      firstNonCommentIndex = i;
    }
    
    // require文またはimport文を探す
    if (line.includes('require(') || line.startsWith('import ')) {
      lastImportIndex = i;
    }
  }
  
  // 既存のインポートの後に挿入
  if (lastImportIndex !== -1) {
    return lastImportIndex + 1;
  }
  
  // なければ最初の非コメント行の前に挿入
  return firstNonCommentIndex !== -1 ? firstNonCommentIndex : 0;
}

/**
 * 構文エラーを修正
 */
function applySyntaxFix(lines, errorLineIndex, strategy) {
  const changes = [];
  const repairedLines = [...lines];
  
  switch (strategy) {
    case 'ADD_SEMICOLON':
      if (!repairedLines[errorLineIndex].trim().endsWith(';')) {
        repairedLines[errorLineIndex] = repairedLines[errorLineIndex].trimRight() + ';';
        changes.push({
          line: errorLineIndex + 1,
          action: 'Added missing semicolon'
        });
      }
      break;
      
    case 'REMOVE_EXTRA_BRACE':
      // 余分な閉じ括弧を削除
      repairedLines[errorLineIndex] = repairedLines[errorLineIndex].replace(/}\s*$/, '');
      changes.push({
        line: errorLineIndex + 1,
        action: 'Removed extra closing brace'
      });
      break;
      
    case 'CLOSE_STRING':
      // 閉じられていない文字列を閉じる
      const line = repairedLines[errorLineIndex];
      const quoteMatch = line.match(/(['"])[^'"]*$/);
      if (quoteMatch) {
        repairedLines[errorLineIndex] = line + quoteMatch[1];
        changes.push({
          line: errorLineIndex + 1,
          action: 'Closed unterminated string'
        });
      }
      break;
      
    case 'ADD_MISSING_BRACE':
      // 不足している閉じ括弧を追加
      repairedLines.push('}');
      changes.push({
        line: repairedLines.length,
        action: 'Added missing closing brace'
      });
      break;
  }
  
  return { repairedLines, changes };
}

/**
 * エラーメッセージからファイルパスを抽出
 */
function extractFilePathFromError(errorMessage) {
  // 一般的なファイルパスパターン
  const patterns = [
    /ENOENT.*'([^']+)'/,
    /ENOENT.*"([^"]+)"/,
    /no such file or directory, open '([^']+)'/,
    /cannot find module '([^']+)'/i
  ];
  
  for (const pattern of patterns) {
    const match = errorMessage.match(pattern);
    if (match) {
      return match[1];
    }
  }
  
  return null;
}

/**
 * JSONエラーからファイルパスを抽出
 */
function extractJSONFilePathFromError(error) {
  // スタックトレースから抽出を試みる
  if (error.stackTrace && error.stackTrace.length > 0) {
    for (const line of error.stackTrace) {
      if (line.includes('.json')) {
        const match = line.match(/([^:]+\.json)/);
        if (match) return match[1];
      }
    }
  }
  
  // エラーメッセージから抽出
  const match = error.message.match(/in ([^:]+\.json)/);
  if (match) return match[1];
  
  return null;
}

/**
 * JSONを修復
 */
function repairJSON(content) {
  const issues = [];
  let repairedJSON = content;
  
  try {
    // まず普通にパースを試みる
    JSON.parse(content);
    return { repairedJSON: content, issues: [] };
  } catch (e) {
    // エラーの種類に応じて修復
    
    // 末尾のカンマを削除
    repairedJSON = repairedJSON.replace(/,(\s*[}\]])/g, '$1');
    if (repairedJSON !== content) {
      issues.push('Removed trailing commas');
    }
    
    // 不正なコメントを削除
    repairedJSON = repairedJSON.replace(/\/\/.*$/gm, '');
    repairedJSON = repairedJSON.replace(/\/\*[\s\S]*?\*\//g, '');
    if (repairedJSON.includes('//') || repairedJSON.includes('/*')) {
      issues.push('Removed comments');
    }
    
    // シングルクォートをダブルクォートに変換
    repairedJSON = repairedJSON.replace(/'/g, '"');
    if (content.includes("'")) {
      issues.push('Converted single quotes to double quotes');
    }
    
    // キーのクォートが不足している場合
    repairedJSON = repairedJSON.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
    
    try {
      // 修復後に再度パース
      JSON.parse(repairedJSON);
      
      // 整形して返す
      const parsed = JSON.parse(repairedJSON);
      repairedJSON = JSON.stringify(parsed, null, 2);
      issues.push('Reformatted JSON');
      
    } catch (e2) {
      // それでもダメなら最小限の有効なJSONを返す
      repairedJSON = '{}';
      issues.push('Reset to empty object due to severe corruption');
    }
  }
  
  return { repairedJSON, issues };
}

// 修復成功率の追跡
const repairStats = {
  attempts: {},
  successes: {},
  failures: {},
  
  recordAttempt(patternId) {
    this.attempts[patternId] = (this.attempts[patternId] || 0) + 1;
  },
  
  recordSuccess(patternId) {
    this.successes[patternId] = (this.successes[patternId] || 0) + 1;
  },
  
  recordFailure(patternId) {
    this.failures[patternId] = (this.failures[patternId] || 0) + 1;
  },
  
  getSuccessRate(patternId) {
    const attempts = this.attempts[patternId] || 0;
    const successes = this.successes[patternId] || 0;
    return attempts > 0 ? (successes / attempts) : 0;
  }
};

module.exports = {
  repairPatterns,
  repairStats,
  extractLocation,
  extractFilePathFromError
};