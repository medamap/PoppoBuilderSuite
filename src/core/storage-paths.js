/**
 * ストレージパス管理システム
 * PoppoBuilderの全ファイルパスを一元管理
 */

const os = require('os');
const path = require('path');
const fs = require('fs');

class StoragePathsManager {
  constructor() {
    this.config = null;
    this.projectName = null;
    this.basePath = null;
  }

  /**
   * 初期化
   * @param {Object} config - グローバル設定
   * @param {string} projectPath - プロジェクトパス
   */
  initialize(config = {}, projectPath = process.cwd()) {
    this.config = config;
    this.projectName = this.detectProjectName(projectPath);
    this.basePath = this.resolveBasePath(config);
    
    // ディレクトリの作成
    this.ensureDirectories();
  }

  /**
   * プロジェクト名の検出
   */
  detectProjectName(projectPath) {
    try {
      // package.jsonから取得を試みる
      const packagePath = path.join(projectPath, 'package.json');
      if (fs.existsSync(packagePath)) {
        const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
        if (pkg.name) return pkg.name;
      }
      
      // ディレクトリ名をフォールバック
      return path.basename(projectPath);
    } catch (error) {
      return path.basename(projectPath);
    }
  }

  /**
   * ベースパスの解決
   */
  resolveBasePath(config) {
    // 環境変数優先
    if (process.env.POPPOBUILDER_BASE_DIR) {
      return this.expandPath(process.env.POPPOBUILDER_BASE_DIR);
    }
    
    // 設定ファイル
    if (config.storage?.baseDir) {
      return this.expandPath(config.storage.baseDir);
    }
    
    // デフォルト
    return path.join(os.homedir(), '.poppobuilder');
  }

  /**
   * パスの展開（~をホームディレクトリに変換）
   */
  expandPath(inputPath) {
    if (inputPath.startsWith('~')) {
      return path.join(os.homedir(), inputPath.slice(1));
    }
    return path.resolve(inputPath);
  }

  /**
   * 必要なディレクトリの作成
   */
  ensureDirectories() {
    const dirs = [
      this.getProjectRoot(),
      this.getLogsDir(),
      this.getLogsDir('app'),
      this.getLogsDir('issues'),
      this.getLogsDir('agents'),
      this.getLogsDir('archive'),
      this.getStateDir(),
      this.getDataDir(),
      this.getTempDir(),
      this.getBackupsDir()
    ];
    
    dirs.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  /**
   * プロジェクトルートディレクトリ
   */
  getProjectRoot() {
    return path.join(this.basePath, 'projects', this.projectName);
  }

  /**
   * ログディレクトリ
   */
  getLogsDir(subdir = '') {
    const logsBase = path.join(this.getProjectRoot(), 'logs');
    return subdir ? path.join(logsBase, subdir) : logsBase;
  }

  /**
   * 状態管理ディレクトリ
   */
  getStateDir() {
    return path.join(this.getProjectRoot(), 'state');
  }

  /**
   * データディレクトリ
   */
  getDataDir() {
    return path.join(this.getProjectRoot(), 'data');
  }

  /**
   * 一時ファイルディレクトリ
   */
  getTempDir() {
    // 環境変数優先
    if (process.env.POPPOBUILDER_TEMP_DIR) {
      return this.expandPath(process.env.POPPOBUILDER_TEMP_DIR);
    }
    
    // 設定ファイル
    if (this.config.storage?.temp?.baseDir) {
      return this.expandPath(this.config.storage.temp.baseDir);
    }
    
    // デフォルト（OS標準の一時ディレクトリ）
    return path.join(os.tmpdir(), 'poppobuilder', this.projectName);
  }

  /**
   * バックアップディレクトリ
   */
  getBackupsDir() {
    return path.join(this.getProjectRoot(), 'backups');
  }

  /**
   * ログファイルパスの生成
   */
  getLogPath(category = 'app', filename = null) {
    if (!filename) {
      const date = new Date().toISOString().split('T')[0];
      filename = `poppo-${date}.log`;
    }
    
    return path.join(this.getLogsDir(category), filename);
  }

  /**
   * Issue別ログパス
   */
  getIssueLogPath(issueNumber) {
    const date = new Date().toISOString().split('T')[0];
    return path.join(this.getLogsDir('issues'), `issue-${issueNumber}-${date}.log`);
  }

  /**
   * エージェント別ログパス
   */
  getAgentLogPath(agentName, filename = null) {
    const agentDir = path.join(this.getLogsDir('agents'), agentName.toLowerCase());
    if (!fs.existsSync(agentDir)) {
      fs.mkdirSync(agentDir, { recursive: true });
    }
    
    if (!filename) {
      const date = new Date().toISOString().split('T')[0];
      filename = `${agentName.toLowerCase()}-${date}.log`;
    }
    
    return path.join(agentDir, filename);
  }

  /**
   * 状態ファイルパス
   */
  getStatePath(filename) {
    return path.join(this.getStateDir(), filename);
  }

  /**
   * データファイルパス
   */
  getDataPath(filename) {
    return path.join(this.getDataDir(), filename);
  }

  /**
   * 一時ファイルパス
   */
  getTempPath(filename) {
    return path.join(this.getTempDir(), filename);
  }

  /**
   * 設定サマリーの取得
   */
  getSummary() {
    return {
      projectName: this.projectName,
      basePath: this.basePath,
      paths: {
        root: this.getProjectRoot(),
        logs: this.getLogsDir(),
        state: this.getStateDir(),
        data: this.getDataDir(),
        temp: this.getTempDir(),
        backups: this.getBackupsDir()
      }
    };
  }

  /**
   * パスの検証
   */
  validatePaths() {
    const errors = [];
    
    // 書き込み権限チェック
    const checkWritable = (dir, name) => {
      try {
        const testFile = path.join(dir, '.write-test');
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);
      } catch (error) {
        errors.push(`${name} is not writable: ${dir}`);
      }
    };
    
    checkWritable(this.getProjectRoot(), 'Project root');
    checkWritable(this.getTempDir(), 'Temp directory');
    
    // ディスク容量チェック
    try {
      const { exec } = require('child_process');
      const util = require('util');
      const execPromise = util.promisify(exec);
      
      // macOS/Linux用のディスク容量チェック
      execPromise(`df -k "${this.basePath}" | tail -1 | awk '{print $4}'`)
        .then(({ stdout }) => {
          const availableKB = parseInt(stdout.trim());
          const availableGB = availableKB / 1024 / 1024;
          
          if (availableGB < 1) {
            errors.push(`Low disk space: ${availableGB.toFixed(2)}GB available`);
          }
        });
    } catch (error) {
      // Windows等では別の方法が必要
    }
    
    return errors;
  }
}

// シングルトンインスタンス
const storagePaths = new StoragePathsManager();

module.exports = storagePaths;