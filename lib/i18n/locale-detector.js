const fs = require('fs').promises;
const path = require('path');
const os = require('os');

class LocaleDetector {
  constructor() {
    this.configPaths = [
      path.join(process.cwd(), '.poppobuilder', 'config.json'),
      path.join(process.cwd(), '.poppo', 'config.json'),
      path.join(os.homedir(), '.poppobuilder', 'config.json'),
    ];
  }

  /**
   * ロケールを検出
   * @param {Object} options - 検出オプション
   * @returns {Promise<string>} 検出されたロケール
   */
  async detect(options = {}) {
    // 1. CLI引数をチェック
    if (options.cliLocale) {
      return this.normalizeLocale(options.cliLocale);
    }

    // 2. 環境変数をチェック
    const envLocale = this.detectFromEnvironment();
    if (envLocale) {
      return envLocale;
    }

    // 3. プロジェクト設定をチェック
    const configLocale = await this.detectFromConfig();
    if (configLocale) {
      return configLocale;
    }

    // 4. システムロケールをチェック
    const systemLocale = this.detectFromSystem();
    if (systemLocale) {
      return systemLocale;
    }

    // 5. デフォルトを返す
    return 'en';
  }

  /**
   * 環境変数からロケールを検出
   * @returns {string|null} 検出されたロケール
   */
  detectFromEnvironment() {
    const candidates = [
      'POPPOBUILDER_LANG',
      'POPPOBUILDER_LOCALE',
      'POPPO_LANG',
      'POPPO_LOCALE',
    ];

    for (const varName of candidates) {
      const value = process.env[varName];
      if (value) {
        return this.normalizeLocale(value);
      }
    }

    return null;
  }

  /**
   * 設定ファイルからロケールを検出
   * @returns {Promise<string|null>} 検出されたロケール
   */
  async detectFromConfig() {
    for (const configPath of this.configPaths) {
      try {
        const content = await fs.readFile(configPath, 'utf8');
        const config = JSON.parse(content);
        
        // 新しい形式をチェック
        if (config.i18n?.locale) {
          return this.normalizeLocale(config.i18n.locale);
        }
        
        // 既存の形式をチェック
        if (config.language?.primary) {
          return this.normalizeLocale(config.language.primary);
        }
        
        // 旧形式をチェック
        if (config.locale) {
          return this.normalizeLocale(config.locale);
        }
      } catch (error) {
        // ファイルが存在しないか、JSONパースエラーの場合は継続
        continue;
      }
    }

    return null;
  }

  /**
   * システムロケールを検出
   * @returns {string|null} 検出されたロケール
   */
  detectFromSystem() {
    const systemLocale = process.env.LANG || process.env.LC_ALL || process.env.LC_MESSAGES;
    
    if (systemLocale) {
      // システムロケールから言語コードを抽出（例: ja_JP.UTF-8 → ja）
      const match = systemLocale.match(/^([a-z]{2})[-_]/i);
      if (match) {
        return this.normalizeLocale(match[1]);
      }
    }

    // Windowsの場合
    if (process.platform === 'win32') {
      try {
        const locale = Intl.DateTimeFormat().resolvedOptions().locale;
        const langCode = locale.split('-')[0];
        return this.normalizeLocale(langCode);
      } catch (error) {
        // Intl APIが利用できない場合
      }
    }

    return null;
  }

  /**
   * ロケールを正規化
   * @param {string} locale - ロケール文字列
   * @returns {string} 正規化されたロケール
   */
  normalizeLocale(locale) {
    if (!locale) return 'en';
    
    // 小文字に変換
    locale = locale.toLowerCase();
    
    // 言語コードのみを抽出（例: en-US → en, ja_JP → ja）
    const langCode = locale.split(/[-_]/)[0];
    
    // エイリアス処理
    const aliases = {
      'japanese': 'ja',
      'english': 'en',
      'eng': 'en',
      'jpn': 'ja',
      'jp': 'ja',
    };
    
    return aliases[langCode] || langCode;
  }

  /**
   * ロケール設定を保存
   * @param {string} locale - 保存するロケール
   * @returns {Promise<void>}
   */
  async savePreference(locale) {
    const configPath = this.configPaths[0]; // プロジェクトレベルの設定を使用
    const configDir = path.dirname(configPath);

    try {
      // ディレクトリが存在しない場合は作成
      await fs.mkdir(configDir, { recursive: true });

      let config = {};
      
      // 既存の設定を読み込む
      try {
        const content = await fs.readFile(configPath, 'utf8');
        config = JSON.parse(content);
      } catch (error) {
        // ファイルが存在しない場合は新規作成
      }

      // i18n設定を更新
      if (!config.i18n) {
        config.i18n = {};
      }
      config.i18n.locale = locale;

      // 既存の言語設定も更新（後方互換性のため）
      if (config.language) {
        config.language.primary = locale;
      }

      // 設定を保存
      await fs.writeFile(configPath, JSON.stringify(config, null, 2));
    } catch (error) {
      console.error('Failed to save locale preference:', error);
      throw error;
    }
  }

  /**
   * 現在の検出優先順位を取得
   * @returns {Object} 検出優先順位と現在値
   */
  async getDetectionInfo() {
    const info = {
      priority: [
        'CLI argument (--lang)',
        'Environment variable (POPPOBUILDER_LANG)',
        'Project config (.poppobuilder/config.json)',
        'System locale (LANG/LC_ALL)',
        'Default (en)',
      ],
      detected: {},
    };

    // 各ソースから検出を試みる
    info.detected.environment = this.detectFromEnvironment();
    info.detected.config = await this.detectFromConfig();
    info.detected.system = this.detectFromSystem();

    return info;
  }

  /**
   * ブラウザのロケールを検出（将来のWeb UI用）
   * @returns {string} 検出されたロケール
   */
  detectFromBrowser() {
    if (typeof navigator !== 'undefined') {
      const browserLang = navigator.language || navigator.userLanguage;
      return this.normalizeLocale(browserLang);
    }
    return 'en';
  }
}

module.exports = LocaleDetector;