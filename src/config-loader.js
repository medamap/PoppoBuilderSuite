const fs = require('fs');
const path = require('path');
const { GlobalConfigManager, getInstance } = require('../lib/core/global-config-manager');

/**
 * PoppoBuilder Configuration Loading Utility
 * 
 * Configuration priority:
 * 1. Environment variables (POPPO_*)
 * 2. Project configuration (.poppo/config.json)
 * 3. Global configuration (~/.poppobuilder/config.json)
 * 4. System defaults (config/defaults.json)
 */
class ConfigLoader {
  constructor() {
    this.projectConfigPath = path.join(process.cwd(), '.poppo', 'config.json');
    this.globalConfigPath = path.join(require('os').homedir(), '.poppobuilder', 'config.json');
    this.systemDefaultPath = path.join(__dirname, '../config/defaults.json');
    this.templatesDir = path.join(__dirname, '../config/templates');
    
    // Get global config manager instance
    this.globalConfigManager = getInstance();
    
    // Load system default configuration
    this.systemDefaultConfig = this.loadSystemDefaults();
    
    // Environment variable prefix
    this.envPrefix = 'POPPO_';
  }

  /**
   * Load system default configuration
   */
  loadSystemDefaults() {
    try {
      if (fs.existsSync(this.systemDefaultPath)) {
        const content = fs.readFileSync(this.systemDefaultPath, 'utf-8');
        return JSON.parse(content);
      }
    } catch (error) {
      console.warn(`System default configuration loading error: ${error.message}`);
    }
    
    // Hardcoded fallback defaults
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
   * Load configuration (environment variables → project → global → system defaults)
   */
  async loadConfig() {
    // Initialize global config manager if needed
    if (!this.globalConfigManager.getStatus().initialized) {
      await this.globalConfigManager.initialize();
    }
    
    // Load configurations in hierarchical order (lowest priority first)
    const configs = [
      this.systemDefaultConfig,           // 4. System defaults
      await this.loadGlobalConfig(),      // 3. Global configuration
      this.loadProjectConfig(),          // 2. Project configuration
      this.loadEnvironmentConfig()       // 1. Environment variables (highest priority)
    ];

    // Merge configurations
    const mergedConfig = this.mergeConfigs(configs);
    
    // Validate configuration values
    this.validateConfig(mergedConfig);
    
    return mergedConfig;
  }

  /**
   * Synchronous config loading (for backward compatibility)
   */
  loadConfigSync() {
    // Load configurations in hierarchical order (lowest priority first)
    const configs = [
      this.systemDefaultConfig,           // 4. System defaults
      this.loadGlobalConfigSync(),        // 3. Global configuration
      this.loadProjectConfig(),          // 2. Project configuration
      this.loadEnvironmentConfig()       // 1. Environment variables (highest priority)
    ];

    // Merge configurations
    const mergedConfig = this.mergeConfigs(configs);
    
    // Validate configuration values
    this.validateConfig(mergedConfig);
    
    return mergedConfig;
  }

  /**
   * Load project configuration
   */
  loadProjectConfig() {
    try {
      if (fs.existsSync(this.projectConfigPath)) {
        const content = fs.readFileSync(this.projectConfigPath, 'utf-8');
        return JSON.parse(content);
      }
    } catch (error) {
      console.warn(`Project configuration loading error: ${error.message}`);
    }
    return {};
  }

  /**
   * Load global configuration (async with GlobalConfigManager)
   */
  async loadGlobalConfig() {
    try {
      // Use GlobalConfigManager to get global config
      const globalConfig = this.globalConfigManager.getAll();
      
      // Extract only the settings relevant for project use
      const relevantConfig = {
        defaults: globalConfig.defaults || {},
        resources: globalConfig.resources || {},
        logging: {
          level: globalConfig.logging?.level || 'info'
        }
      };
      
      return relevantConfig;
    } catch (error) {
      console.warn(`Global configuration loading error: ${error.message}`);
      return {};
    }
  }

  /**
   * Load global configuration (sync version for backward compatibility)
   */
  loadGlobalConfigSync() {
    try {
      if (fs.existsSync(this.globalConfigPath)) {
        const content = fs.readFileSync(this.globalConfigPath, 'utf-8');
        const globalConfig = JSON.parse(content);
        
        // Extract only the settings relevant for project use
        const relevantConfig = {
          defaults: globalConfig.defaults || {},
          resources: globalConfig.resources || {},
          logging: {
            level: globalConfig.logging?.level || 'info'
          }
        };
        
        return relevantConfig;
      }
    } catch (error) {
      console.warn(`Global configuration loading error: ${error.message}`);
    }
    return {};
  }

  /**
   * Load configuration from environment variables
   */
  loadEnvironmentConfig() {
    const envConfig = {};
    
    // Scan environment variables and collect those starting with POPPO_
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
   * Convert environment variable name to configuration path
   * Example: POPPO_LANGUAGE_PRIMARY -> ['language', 'primary']
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
        // If target[key] exists but is not an object, replace it
        if (target[key] && typeof target[key] !== 'object') {
          target[key] = {};
        } else if (!target[key]) {
          target[key] = {};
        }
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
   * Load configuration template by language
   */
  loadTemplate(language) {
    const templatePath = path.join(this.templatesDir, `config.${language}.json`);
    
    try {
      if (fs.existsSync(templatePath)) {
        const content = fs.readFileSync(templatePath, 'utf-8');
        const template = JSON.parse(content);
        // Remove meta information for production use
        delete template._meta;
        return template;
      }
    } catch (error) {
      console.warn(`Template loading error for language '${language}': ${error.message}`);
    }
    
    return null;
  }

  /**
   * Get available configuration templates
   */
  getAvailableTemplates() {
    const templates = [];
    
    try {
      if (fs.existsSync(this.templatesDir)) {
        const files = fs.readdirSync(this.templatesDir);
        
        for (const file of files) {
          if (file.startsWith('config.') && file.endsWith('.json')) {
            const language = file.replace('config.', '').replace('.json', '');
            const templatePath = path.join(this.templatesDir, file);
            
            try {
              const content = fs.readFileSync(templatePath, 'utf-8');
              const template = JSON.parse(content);
              
              templates.push({
                language,
                path: templatePath,
                meta: template._meta || { description: `Configuration template for ${language}` }
              });
            } catch (error) {
              console.warn(`Error reading template ${file}: ${error.message}`);
            }
          }
        }
      }
    } catch (error) {
      console.warn(`Error reading templates directory: ${error.message}`);
    }
    
    return templates;
  }

  /**
   * Create configuration from template
   */
  createFromTemplate(language, targetPath = null) {
    const template = this.loadTemplate(language);
    
    if (!template) {
      throw new Error(`Template for language '${language}' not found`);
    }
    
    const outputPath = targetPath || path.join(process.cwd(), 'config', 'config.json');
    const outputDir = path.dirname(outputPath);
    
    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Write template to target location
    fs.writeFileSync(outputPath, JSON.stringify(template, null, 2));
    
    console.log(`Configuration created from template '${language}' at: ${outputPath}`);
    return template;
  }

  /**
   * Display configuration hierarchy information
   */
  displayConfigHierarchy() {
    const sources = this.getConfigSources();
    const templates = this.getAvailableTemplates();
    
    console.log('\nPoppoBuilder Configuration Hierarchy:');
    console.log('====================================');
    console.log('Priority (High → Low):');
    console.log('1. Environment Variables:');
    const envVars = sources.environment.variables;
    if (Object.keys(envVars).length > 0) {
      Object.entries(envVars).forEach(([key, value]) => {
        console.log(`   ${key} = ${value}`);
      });
    } else {
      console.log('   (No settings)');
    }
    
    console.log(`2. Project Configuration: ${sources.project.path}`);
    console.log(`   ${sources.project.exists ? '✓ Exists' : '✗ Not found'}`);
    
    console.log(`3. Global Configuration: ${sources.global.path}`);
    console.log(`   ${sources.global.exists ? '✓ Exists' : '✗ Not found'}`);
    
    console.log(`4. System Defaults: ${sources.systemDefault.path}`);
    console.log(`   ${sources.systemDefault.exists ? '✓ Exists' : '✗ Not found'}`);
    
    if (templates.length > 0) {
      console.log('\nAvailable Templates:');
      templates.forEach(template => {
        console.log(`   ${template.language}: ${template.meta.description || 'No description'}`);
        console.log(`     Path: ${template.path}`);
      });
    }
    
    console.log('====================================\n');
  }
}

module.exports = ConfigLoader;