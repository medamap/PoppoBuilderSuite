/**
 * Validation utilities for PoppoBuilder CLI
 * Provides specific validation with helpful error messages
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');

/**
 * Validate directory access and permissions
 */
async function validateDirectory(dirPath, requireWrite = true) {
  const errors = [];
  
  try {
    const stats = await fs.stat(dirPath);
    
    if (!stats.isDirectory()) {
      errors.push({
        type: 'not_directory',
        message: `パスがディレクトリではありません: ${dirPath}`,
        hint: 'ファイルではなくディレクトリパスを指定してください'
      });
    }
    
    // Check read permission
    await fs.access(dirPath, fs.constants.R_OK);
    
    // Check write permission if required
    if (requireWrite) {
      try {
        await fs.access(dirPath, fs.constants.W_OK);
      } catch {
        errors.push({
          type: 'no_write_permission',
          message: `書き込み権限がありません: ${dirPath}`,
          hint: `chmod +w ${dirPath} で権限を付与してください`
        });
      }
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      errors.push({
        type: 'not_found',
        message: `ディレクトリが見つかりません: ${dirPath}`,
        hint: '正しいパスを指定してください'
      });
    } else if (error.code === 'EACCES') {
      errors.push({
        type: 'no_access',
        message: `アクセス権限がありません: ${dirPath}`,
        hint: 'ディレクトリの権限を確認してください'
      });
    } else {
      errors.push({
        type: 'unknown',
        message: `ディレクトリエラー: ${error.message}`,
        hint: 'システム管理者に問い合わせてください'
      });
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate global configuration directory
 */
async function validateGlobalConfigDir() {
  const configDir = path.join(os.homedir(), '.poppobuilder');
  const errors = [];
  
  try {
    // Check if directory exists
    await fs.stat(configDir);
    
    // Validate permissions
    const dirValidation = await validateDirectory(configDir, true);
    if (!dirValidation.valid) {
      errors.push(...dirValidation.errors);
    }
    
    // Check available disk space
    const configFile = path.join(configDir, 'config.json');
    const stats = await fs.statfs(path.dirname(configDir));
    const availableMB = Math.floor(stats.bavail * stats.bsize / 1024 / 1024);
    
    if (availableMB < 100) { // Less than 100MB
      errors.push({
        type: 'low_disk_space',
        message: `ディスク容量が不足しています: ${availableMB}MB`,
        hint: '最低100MBの空き容量が必要です'
      });
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      // Directory doesn't exist - this is OK for initial setup
      return { valid: true, errors: [], needsCreation: true };
    } else {
      errors.push({
        type: 'config_dir_error',
        message: `設定ディレクトリエラー: ${error.message}`,
        hint: `${configDir} の状態を確認してください`
      });
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    needsCreation: false
  };
}

/**
 * Validate GitHub repository information
 */
function validateGitHubInfo(owner, repo) {
  const errors = [];
  
  // Validate owner
  if (!owner || owner.trim() === '') {
    errors.push({
      type: 'missing_owner',
      message: 'GitHubユーザー名/Organization名が指定されていません',
      hint: '例: medamap'
    });
  } else if (!/^[a-zA-Z0-9-]+$/.test(owner)) {
    errors.push({
      type: 'invalid_owner',
      message: `無効なGitHubユーザー名: ${owner}`,
      hint: '英数字とハイフンのみ使用可能です'
    });
  }
  
  // Validate repo
  if (!repo || repo.trim() === '') {
    errors.push({
      type: 'missing_repo',
      message: 'リポジトリ名が指定されていません',
      hint: '例: PoppoBuilderSuite'
    });
  } else if (!/^[a-zA-Z0-9._-]+$/.test(repo)) {
    errors.push({
      type: 'invalid_repo',
      message: `無効なリポジトリ名: ${repo}`,
      hint: '英数字、ハイフン、アンダースコア、ピリオドのみ使用可能です'
    });
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate port number
 */
function validatePort(port) {
  const errors = [];
  const portNum = parseInt(port, 10);
  
  if (isNaN(portNum)) {
    errors.push({
      type: 'invalid_port',
      message: `無効なポート番号: ${port}`,
      hint: '数値を指定してください (例: 3003)'
    });
  } else if (portNum < 1 || portNum > 65535) {
    errors.push({
      type: 'port_out_of_range',
      message: `ポート番号が範囲外です: ${portNum}`,
      hint: '1-65535の範囲で指定してください'
    });
  } else if (portNum < 1024 && process.platform !== 'win32') {
    errors.push({
      type: 'privileged_port',
      message: `特権ポートです: ${portNum}`,
      hint: '1024以上のポートを使用するか、sudoで実行してください'
    });
  }
  
  return {
    valid: errors.length === 0,
    errors,
    port: portNum
  };
}

/**
 * Check if a port is in use
 */
async function checkPortAvailable(port) {
  const net = require('net');
  
  return new Promise((resolve) => {
    const server = net.createServer();
    
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve({
          available: false,
          error: {
            type: 'port_in_use',
            message: `ポート ${port} は既に使用されています`,
            hint: '別のポートを指定するか、使用中のプロセスを停止してください'
          }
        });
      } else {
        resolve({
          available: false,
          error: {
            type: 'port_error',
            message: `ポートエラー: ${err.message}`,
            hint: 'ネットワーク設定を確認してください'
          }
        });
      }
    });
    
    server.once('listening', () => {
      server.close();
      resolve({ available: true });
    });
    
    server.listen(port);
  });
}

/**
 * Validate process count
 */
function validateProcessCount(count) {
  const errors = [];
  const num = parseInt(count, 10);
  const cpuCount = os.cpus().length;
  
  if (isNaN(num)) {
    errors.push({
      type: 'invalid_process_count',
      message: `無効なプロセス数: ${count}`,
      hint: '数値を指定してください'
    });
  } else if (num < 1) {
    errors.push({
      type: 'process_count_too_low',
      message: `プロセス数が少なすぎます: ${num}`,
      hint: '最低1以上を指定してください'
    });
  } else if (num > cpuCount * 2) {
    errors.push({
      type: 'process_count_too_high',
      message: `プロセス数が多すぎます: ${num} (CPU数: ${cpuCount})`,
      hint: `推奨値: ${Math.max(2, Math.ceil(cpuCount / 2))}`
    });
  }
  
  return {
    valid: errors.length === 0,
    errors,
    count: num,
    recommended: Math.max(2, Math.ceil(cpuCount / 2))
  };
}

/**
 * Validate configuration object against schema
 * @deprecated Use schema validation directly instead
 */
function validateConfig(config, schema) {
  // This function is deprecated and kept for backward compatibility
  // Use the appropriate schema validation function directly:
  // - validateProject() from lib/schemas/project-schema.js
  // - validate() from lib/schemas/global-config-schema.js
  
  const errors = [];
  
  // Basic validation for backward compatibility
  if (!config.version) {
    errors.push({
      type: 'missing_version',
      message: 'バージョンが指定されていません',
      hint: 'version: "1.0.0" を追加してください'
    });
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

module.exports = {
  validateDirectory,
  validateGlobalConfigDir,
  validateGitHubInfo,
  validatePort,
  checkPortAvailable,
  validateProcessCount,
  validateConfig
};