const fs = require('fs');
const path = require('path');

/**
 * PoppoBuilder設定読み込みユーティリティ
 */
class ConfigLoader {
  constructor() {
    this.projectConfigPath = path.join(process.cwd(), '.poppo', 'config.json');
    this.globalConfigPath = path.join(require('os').homedir(), '.poppo', 'config.json');
    this.defaultConfig = {
      language: {
        primary: 'ja',
        fallback: 'en'
      },
      systemPrompt: {
        enforceLanguage: true,
        customInstructions: ''
      }
    };
  }

  /**
   * 設定を読み込み（プロジェクト→グローバル→デフォルトの順）
   */
  loadConfig() {
    const configs = [
      this.loadProjectConfig(),
      this.loadGlobalConfig(),
      this.defaultConfig
    ];

    // 設定をマージ（最初に見つかった値を優先）
    return this.mergeConfigs(configs);
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
   * 設定配列をマージ
   */
  mergeConfigs(configs) {
    const result = {};
    
    // 逆順でマージして、最初の設定を優先
    for (let i = configs.length - 1; i >= 0; i--) {
      this.deepMerge(result, configs[i]);
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
   * プロジェクト設定ファイルの作成
   */
  createProjectConfig(config = {}) {
    this.ensureConfigDirectory();
    const mergedConfig = this.mergeConfigs([config, this.defaultConfig]);
    fs.writeFileSync(this.projectConfigPath, JSON.stringify(mergedConfig, null, 2));
    console.log('プロジェクト設定ファイルを作成しました:', this.projectConfigPath);
    return mergedConfig;
  }
}

module.exports = ConfigLoader;