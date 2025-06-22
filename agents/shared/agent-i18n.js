/**
 * Agent Internationalization (i18n) System
 * Provides multi-language message support for PoppoBuilder agents
 */

const fs = require('fs').promises;
const path = require('path');

class AgentI18n {
  constructor(agentName, language = 'ja') {
    this.agentName = agentName;
    this.currentLanguage = language;
    this.translations = {};
    this.supportedLanguages = ['ja', 'en'];
    this.fallbackLanguage = 'ja';
    
    // Cache for performance
    this.translationCache = new Map();
  }

  /**
   * Initialize i18n system with message files
   */
  async init() {
    const messagesDir = path.join(__dirname, '../messages');
    
    // Create messages directory if it doesn't exist
    try {
      await fs.mkdir(messagesDir, { recursive: true });
    } catch (error) {
      // Directory already exists
    }
    
    // Load translation files
    await this.loadTranslations();
    
    // Set language from environment variable if available
    const envLang = process.env.POPPO_AGENT_LANGUAGE;
    if (envLang && this.supportedLanguages.includes(envLang)) {
      this.currentLanguage = envLang;
    }
  }

  /**
   * Load translation files for all supported languages
   */
  async loadTranslations() {
    const messagesDir = path.join(__dirname, '../messages');
    
    for (const lang of this.supportedLanguages) {
      const langFile = path.join(messagesDir, `${lang}.json`);
      
      try {
        const content = await fs.readFile(langFile, 'utf-8');
        this.translations[lang] = JSON.parse(content);
      } catch (error) {
        // Create default translation file if it doesn't exist
        if (error.code === 'ENOENT') {
          await this.createDefaultTranslations(lang);
        } else {
          console.error(`Failed to load ${lang} translations:`, error);
        }
      }
    }
  }

  /**
   * Create default translation files
   */
  async createDefaultTranslations(lang) {
    const messagesDir = path.join(__dirname, '../messages');
    const langFile = path.join(messagesDir, `${lang}.json`);
    
    const defaultTranslations = lang === 'en' ? {
      "common": {
        "initializing": "Initializing agent {agentName}...",
        "initialized": "Agent {agentName} initialized successfully",
        "starting": "Starting agent {agentName}...",
        "started": "Agent {agentName} started successfully",
        "stopping": "Stopping agent {agentName}...",
        "stopped": "Agent {agentName} stopped",
        "error": "Error in agent {agentName}: {error}",
        "taskReceived": "Task received: {taskId}",
        "taskCompleted": "Task completed: {taskId}",
        "taskFailed": "Task failed: {taskId} - {error}",
        "heartbeat": "Heartbeat from {agentName}",
        "shutdown": "Shutting down {agentName}...",
        "cleanupComplete": "Cleanup completed for {agentName}"
      },
      "status": {
        "initializing": "Initializing",
        "ready": "Ready",
        "running": "Running",
        "stopping": "Stopping",
        "stopped": "Stopped",
        "error": "Error"
      },
      "messages": {
        "messageProcessed": "Message processed: {messageId}",
        "messageError": "Error processing message {messageId}: {error}",
        "inboxChecked": "Inbox checked - {count} messages found",
        "outboxProcessed": "Outbox processed - {count} messages sent"
      }
    } : {
      "common": {
        "initializing": "エージェント {agentName} を初期化中...",
        "initialized": "エージェント {agentName} の初期化が完了しました",
        "starting": "エージェント {agentName} を開始中...",
        "started": "エージェント {agentName} が正常に開始されました",
        "stopping": "エージェント {agentName} を停止中...",
        "stopped": "エージェント {agentName} が停止しました",
        "error": "エージェント {agentName} でエラーが発生: {error}",
        "taskReceived": "タスクを受信: {taskId}",
        "taskCompleted": "タスクが完了: {taskId}",
        "taskFailed": "タスクが失敗: {taskId} - {error}",
        "heartbeat": "{agentName} からのハートビート",
        "shutdown": "{agentName} をシャットダウン中...",
        "cleanupComplete": "{agentName} のクリーンアップが完了しました"
      },
      "status": {
        "initializing": "初期化中",
        "ready": "準備完了",
        "running": "実行中",
        "stopping": "停止中",
        "stopped": "停止済み",
        "error": "エラー"
      },
      "messages": {
        "messageProcessed": "メッセージを処理しました: {messageId}",
        "messageError": "メッセージ {messageId} の処理でエラー: {error}",
        "inboxChecked": "受信箱をチェック - {count} 件のメッセージを発見",
        "outboxProcessed": "送信箱を処理 - {count} 件のメッセージを送信"
      }
    };

    try {
      await fs.writeFile(langFile, JSON.stringify(defaultTranslations, null, 2), 'utf-8');
      this.translations[lang] = defaultTranslations;
    } catch (error) {
      console.error(`Failed to create default ${lang} translations:`, error);
    }
  }

  /**
   * Get translated message with parameter substitution
   * @param {string} key - Message key (e.g., 'common.initializing')
   * @param {object} params - Parameters for substitution
   * @param {string} language - Target language (defaults to current)
   * @returns {string} Translated message
   */
  t(key, params = {}, language = this.currentLanguage) {
    // Check cache first
    const cacheKey = `${language}:${key}:${JSON.stringify(params)}`;
    if (this.translationCache.has(cacheKey)) {
      return this.translationCache.get(cacheKey);
    }

    let message = this.getMessage(key, language);
    
    // If not found in current language, try fallback
    if (!message && language !== this.fallbackLanguage) {
      message = this.getMessage(key, this.fallbackLanguage);
    }
    
    // If still not found, return the key
    if (!message) {
      message = key;
    }
    
    // Substitute parameters
    const translatedMessage = this.substituteParams(message, params);
    
    // Cache the result
    this.translationCache.set(cacheKey, translatedMessage);
    
    return translatedMessage;
  }

  /**
   * Get message from translations object
   */
  getMessage(key, language) {
    const keys = key.split('.');
    let value = this.translations[language];
    
    for (const k of keys) {
      if (value && typeof value === 'object') {
        value = value[k];
      } else {
        return null;
      }
    }
    
    return typeof value === 'string' ? value : null;
  }

  /**
   * Substitute parameters in message template
   */
  substituteParams(message, params) {
    return message.replace(/\{(\w+)\}/g, (match, param) => {
      return params[param] !== undefined ? params[param] : match;
    });
  }

  /**
   * Set current language
   */
  setLanguage(language) {
    if (this.supportedLanguages.includes(language)) {
      this.currentLanguage = language;
      this.translationCache.clear(); // Clear cache when language changes
    }
  }

  /**
   * Get current language
   */
  getCurrentLanguage() {
    return this.currentLanguage;
  }

  /**
   * Get available languages
   */
  getSupportedLanguages() {
    return [...this.supportedLanguages];
  }

  /**
   * Add custom translation
   */
  addTranslation(language, key, message) {
    if (!this.translations[language]) {
      this.translations[language] = {};
    }
    
    const keys = key.split('.');
    let current = this.translations[language];
    
    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]]) {
        current[keys[i]] = {};
      }
      current = current[keys[i]];
    }
    
    current[keys[keys.length - 1]] = message;
    this.translationCache.clear(); // Clear cache when translations change
  }

  /**
   * Clear translation cache
   */
  clearCache() {
    this.translationCache.clear();
  }
}

// Export factory function
function createAgentI18n(agentName, language) {
  return new AgentI18n(agentName, language);
}

module.exports = { AgentI18n, createAgentI18n };