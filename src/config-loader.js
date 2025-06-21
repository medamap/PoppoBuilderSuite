const fs = require('fs');
const path = require('path');

/**
 * PoppoBuilder設定読み込みユーティリティ
 * 
 * 設定の優先順位:
 * 1. 環境変数 (POPPO_*)
 * 2. プロジェクト設定 (.poppo/config.json)
 * 3. グローバル設定 (~/.poppobuilder/config.json)
 * 4. システムデフォルト (config/defaults.json)
 */
class ConfigLoader {
  constructor() {
    this.projectConfigPath = path.join(process.cwd(), '.poppo', 'config.json');
    this.globalConfigPath = path.join(require('os').homedir(), '.poppobuilder', 'config.json');
    this.systemDefaultPath = path.join(__dirname, '../config/defaults.json');
    
    // システムデフォルト設定を読み込み
    this.systemDefaultConfig = this.loadSystemDefaults();
    
    // 環境変数のプレフィックス
    this.envPrefix = 'POPPO_';
  }

  /**
   * システムデフォルト設定の読み込み
   */
  loadSystemDefaults() {
    try {
      if (fs.existsSync(this.systemDefaultPath)) {
        const content = fs.readFileSync(this.systemDefaultPath, 'utf-8');
        return JSON.parse(content);
      }
    } catch (error) {
      console.warn(`システムデフォルト設定読み込みエラー: ${error.message}`);
    }
    
    // フォールバック用のハードコードされたデフォルト
    return {
      language: {
        primary: 'en',
        fallback: 'en'
      },
      systemPrompt: {
        enforceLanguage: true,
        customInstructions: ''
      }
    };
  }

  /**
   * 設定を読み込み（環境変数→プロジェクト→グローバル→システムデフォルトの順）
   */
  loadConfig() {
    // 階層順に設定を読み込み（優先度の低い順）
    const configs = [
      this.systemDefaultConfig,           // 4. システムデフォルト
      this.loadGlobalConfig(),           // 3. グローバル設定
      this.loadProjectConfig(),          // 2. プロジェクト設定
      this.loadEnvironmentConfig()       // 1. 環境変数（最優先）
    ];

    // 設定をマージ
    const mergedConfig = this.mergeConfigs(configs);
    
    // 設定値のバリデーション
    this.validateConfig(mergedConfig);
    
    return mergedConfig;
  }

  /**
   * プロジェクト設定読み込み
   */
  loadProjectConfig() {
    try {
      if (fs.existsSync(this.projectConfigPath)) {
        const content = fs.readFileSync(this.projectConfigPath, 'utf-8');
        return JSON.parse(content);
      }
    } catch (error) {
      console.warn(`プロジェクト設定読み込みエラー: ${error.message}`);
    }
    return {};
  }

  /**
   * グローバル設定読み込み
   */
  loadGlobalConfig() {
    try {
      if (fs.existsSync(this.globalConfigPath)) {
        const content = fs.readFileSync(this.globalConfigPath, 'utf-8');
        return JSON.parse(content);
      }
    } catch (error) {
      console.warn(`グローバル設定読み込みエラー: ${error.message}`);
    }
    return {};
  }

  /**
   * 環境変数から設定を読み込み
   */
  loadEnvironmentConfig() {
    const envConfig = {};
    
    // 環境変数をスキャンしてPOPPO_で始まるものを収集
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith(this.envPrefix)) {
        const configPath = this.parseEnvKey(key);
        if (configPath) {
          this.setNestedValue(envConfig, configPath, this.parseEnvValue(value));
        }
      }
    }
    
    return envConfig;
  }

  /**
   * 環境変数名を設定パスに変換
   * 例: POPPO_LANGUAGE_PRIMARY -> ['language', 'primary']
   */
  parseEnvKey(envKey) {
    const key = envKey.substring(this.envPrefix.length);
    if (!key) return null;
    
    // アンダースコアで分割して小文字に変換
    return key.toLowerCase().split('_');
  }

  /**
   * 環境変数の値を適切な型に変換
   */
  parseEnvValue(value) {
    // 空文字列
    if (value === '') return '';
    
    // 真偽値
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
    
    // 数値
    if (!isNaN(value) && value !== '') {
      return Number(value);
    }
    
    // JSON形式の場合はパース
    if (value.startsWith('{') || value.startsWith('[')) {
      try {
        return JSON.parse(value);
      } catch (e) {
        // パース失敗時は文字列として扱う
      }
    }
    
    return value;
  }

  /**
   * ネストされたオブジェクトに値を設定
   */
  setNestedValue(obj, path, value) {
    let current = obj;
    for (let i = 0; i < path.length - 1; i++) {
      if (!current[path[i]]) {
        current[path[i]] = {};
      }
      current = current[path[i]];
    }
    current[path[path.length - 1]] = value;
  }

  /**
   * 設定配列をマージ
   */
  mergeConfigs(configs) {
    const result = {};
    
    // 順番にマージ（後の設定が優先）
    for (const config of configs) {
      if (config && typeof config === 'object') {
        this.deepMerge(result, config);
      }
    }
    
    return result;
  }

  /**
   * オブジェクトの深いマージ
   */
  deepMerge(target, source) {
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        if (!target[key]) target[key] = {};
        this.deepMerge(target[key], source[key]);
      } else {
        target[key] = source[key];
      }
    }
  }

  /**
   * 言語設定に基づいてシステムプロンプトを生成
   */
  generateSystemPrompt(config, issueNumber, labels = []) {
    const language = config.language?.primary || 'ja';
    const isDogfooding = labels.includes('task:dogfooding');
    
    const languageInstructions = {
      ja: 'すべての回答、コメント、説明は日本語で行ってください。',
      en: 'Provide all responses, comments, and explanations in English.'
    };

    const baseInstructions = {
      ja: `重要: あなたは PoppoBuilder の自動実行エージェントです。
${languageInstructions.ja}

${isDogfooding ? `
🔧 DOGFOODING MODE: PoppoBuilder自己改善タスクです
- 最初に CLAUDE.md を読んで現在の実装状況を把握してください
- 実装完了後は必ず CLAUDE.md の実装状況を更新してください
- 次のセッションで継続できるよう詳細な記録を残してください
- 変更点は具体的に記述し、テスト方法も含めてください
` : ''}

以下のルールに従ってください：

1. デフォルトの作業ブランチは 'work/poppo-builder' です
2. 作業開始時は必ず:
   - git fetch origin
   - git checkout -B work/poppo-builder origin/develop
   - git pull origin work/poppo-builder || true
3. "developにマージ" や "mainにマージ" と言われたら、
   デフォルトで work/poppo-builder からのマージとして扱う
4. 明示的に別ブランチが指定された場合のみ、そのブランチを使用
5. 回答は必ず日本語で記述してください
6. エラーメッセージやログも日本語で出力してください

現在のタスク: Issue #${issueNumber} ${isDogfooding ? '(DOGFOODING)' : ''}`,

      en: `Important: You are PoppoBuilder's automated execution agent.
${languageInstructions.en}

${isDogfooding ? `
🔧 DOGFOODING MODE: PoppoBuilder self-improvement task
- First, read CLAUDE.md to understand the current implementation status
- After implementation, be sure to update the implementation status in CLAUDE.md
- Leave detailed records for continuation in the next session
- Describe changes specifically and include testing methods
` : ''}

Follow these rules:

1. The default working branch is 'work/poppo-builder'
2. Always start work with:
   - git fetch origin
   - git checkout -B work/poppo-builder origin/develop
   - git pull origin work/poppo-builder || true
3. When asked to "merge to develop" or "merge to main",
   treat it as merging from work/poppo-builder by default
4. Use a different branch only when explicitly specified
5. All responses must be written in English
6. Error messages and logs should also be in English

Current task: Issue #${issueNumber} ${isDogfooding ? '(DOGFOODING)' : ''}`
    };

    let systemPrompt = baseInstructions[language] || baseInstructions.ja;
    
    // カスタム指示を追加
    if (config.systemPrompt?.customInstructions) {
      systemPrompt += '\n\n' + config.systemPrompt.customInstructions;
    }

    return systemPrompt;
  }

  /**
   * .poppoディレクトリの作成
   */
  ensureConfigDirectory() {
    const poppoDir = path.join(process.cwd(), '.poppo');
    if (!fs.existsSync(poppoDir)) {
      fs.mkdirSync(poppoDir, { recursive: true });
      console.log('.poppoディレクトリを作成しました:', poppoDir);
    }
    return poppoDir;
  }

  /**
   * 設定値のバリデーション
   */
  validateConfig(config) {
    const errors = [];
    
    // 必須項目のチェック
    if (!config.language?.primary) {
      errors.push('language.primary は必須です');
    }
    
    // 言語コードの妥当性チェック
    const validLanguages = ['ja', 'en'];
    if (config.language?.primary && !validLanguages.includes(config.language.primary)) {
      errors.push(`language.primary は ${validLanguages.join(', ')} のいずれかである必要があります`);
    }
    
    // 数値範囲のチェック
    if (config.claude?.maxConcurrent && (config.claude.maxConcurrent < 1 || config.claude.maxConcurrent > 10)) {
      errors.push('claude.maxConcurrent は 1〜10 の範囲である必要があります');
    }
    
    if (config.github?.pollingInterval && config.github.pollingInterval < 10000) {
      errors.push('github.pollingInterval は 10000ms 以上である必要があります');
    }
    
    // タイムアウト値の妥当性
    if (config.dynamicTimeout?.enabled) {
      const min = config.dynamicTimeout.minTimeout;
      const max = config.dynamicTimeout.maxTimeout;
      if (min && max && min > max) {
        errors.push('dynamicTimeout.minTimeout は maxTimeout 以下である必要があります');
      }
    }
    
    if (errors.length > 0) {
      console.warn('設定バリデーション警告:');
      errors.forEach(error => console.warn(`  - ${error}`));
    }
    
    return errors.length === 0;
  }

  /**
   * プロジェクト設定ファイルの作成
   */
  createProjectConfig(config = {}) {
    this.ensureConfigDirectory();
    const mergedConfig = this.mergeConfigs([this.systemDefaultConfig, config]);
    fs.writeFileSync(this.projectConfigPath, JSON.stringify(mergedConfig, null, 2));
    console.log('プロジェクト設定ファイルを作成しました:', this.projectConfigPath);
    return mergedConfig;
  }

  /**
   * 現在の設定ソース情報を取得
   */
  getConfigSources() {
    const sources = {
      systemDefault: { path: this.systemDefaultPath, exists: fs.existsSync(this.systemDefaultPath) },
      global: { path: this.globalConfigPath, exists: fs.existsSync(this.globalConfigPath) },
      project: { path: this.projectConfigPath, exists: fs.existsSync(this.projectConfigPath) },
      environment: { variables: this.getEnvironmentVariables() }
    };
    
    return sources;
  }

  /**
   * PoppoBuilder関連の環境変数を取得
   */
  getEnvironmentVariables() {
    const vars = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith(this.envPrefix)) {
        vars[key] = value;
      }
    }
    return vars;
  }

  /**
   * 設定の階層情報を表示
   */
  displayConfigHierarchy() {
    const sources = this.getConfigSources();
    
    console.log('\nPoppoBuilder設定階層情報:');
    console.log('========================');
    console.log('優先順位（高→低）:');
    console.log('1. 環境変数:');
    const envVars = sources.environment.variables;
    if (Object.keys(envVars).length > 0) {
      Object.entries(envVars).forEach(([key, value]) => {
        console.log(`   ${key} = ${value}`);
      });
    } else {
      console.log('   (設定なし)');
    }
    
    console.log(`2. プロジェクト設定: ${sources.project.path}`);
    console.log(`   ${sources.project.exists ? '✓ 存在' : '✗ 存在しない'}`);
    
    console.log(`3. グローバル設定: ${sources.global.path}`);
    console.log(`   ${sources.global.exists ? '✓ 存在' : '✗ 存在しない'}`);
    
    console.log(`4. システムデフォルト: ${sources.systemDefault.path}`);
    console.log(`   ${sources.systemDefault.exists ? '✓ 存在' : '✗ 存在しない'}`);
    console.log('========================\n');
  }
}

module.exports = ConfigLoader;