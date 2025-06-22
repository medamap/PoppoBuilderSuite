/**
 * Language Detector
 * Detects the appropriate language for GitHub comments
 */

class LanguageDetector {
  constructor() {
    // Common Japanese characters and patterns
    this.japanesePatterns = [
      /[\u3040-\u309F]/, // Hiragana
      /[\u30A0-\u30FF]/, // Katakana
      /[\u4E00-\u9FAF]/, // Kanji
      /[\u3000-\u303F]/, // Japanese punctuation
    ];

    // Japanese-specific keywords
    this.japaneseKeywords = [
      'について', 'ください', 'です', 'ます', 'から', 'まで',
      'として', 'ために', 'によって', 'における', 'に関して',
      'エラー', 'バグ', '機能', '実装', '修正', '追加', '削除',
      '更新', '改善', 'タスク', 'イシュー', 'プルリクエスト'
    ];

    // Language indicators in text
    this.languageIndicators = {
      ja: ['日本語', 'Japanese', 'JP', '日本'],
      en: ['English', 'EN', 'US', 'UK']
    };
  }

  /**
   * Detect language from issue/PR content
   * @param {Object} options - Detection options
   * @param {string} options.title - Issue/PR title
   * @param {string} options.body - Issue/PR body
   * @param {string[]} options.labels - Issue/PR labels
   * @param {Object} options.user - User object
   * @param {Object} options.repository - Repository object
   * @returns {string} Detected language code ('ja' or 'en')
   */
  detect(options = {}) {
    const {
      title = '',
      body = '',
      labels = [],
      user = {},
      repository = {}
    } = options;

    // Priority 1: Check explicit language labels
    const languageFromLabels = this.detectFromLabels(labels);
    if (languageFromLabels) {
      return languageFromLabels;
    }

    // Priority 2: Check content language
    const combinedText = `${title} ${body}`;
    const contentLanguage = this.detectFromContent(combinedText);
    if (contentLanguage) {
      return contentLanguage;
    }

    // Priority 3: Check user profile language (if available)
    if (user.language) {
      return this.normalizeLanguageCode(user.language);
    }

    // Priority 4: Check repository default language settings
    if (repository.language) {
      return this.detectFromRepositoryLanguage(repository.language);
    }

    // Default to English
    return 'en';
  }

  /**
   * Detect language from labels
   * @private
   */
  detectFromLabels(labels) {
    const labelNames = labels.map(l => 
      typeof l === 'string' ? l : l.name
    ).filter(Boolean);

    // Check for explicit language labels
    if (labelNames.some(label => 
      label.toLowerCase().includes('japanese') || 
      label.toLowerCase().includes('日本語') ||
      label === 'lang:ja'
    )) {
      return 'ja';
    }

    if (labelNames.some(label => 
      label.toLowerCase().includes('english') || 
      label === 'lang:en'
    )) {
      return 'en';
    }

    return null;
  }

  /**
   * Detect language from text content
   * @private
   */
  detectFromContent(text) {
    if (!text || text.length < 10) {
      return null;
    }

    // Check for explicit language indicators
    for (const [lang, indicators] of Object.entries(this.languageIndicators)) {
      if (indicators.some(indicator => text.includes(indicator))) {
        return lang;
      }
    }

    // Count Japanese characters
    const japaneseCharCount = this.countJapaneseCharacters(text);
    const totalCharCount = text.length;
    const japaneseRatio = japaneseCharCount / totalCharCount;

    // If more than 10% Japanese characters, consider it Japanese
    if (japaneseRatio > 0.1) {
      return 'ja';
    }

    // Check for Japanese keywords
    const hasJapaneseKeywords = this.japaneseKeywords.some(keyword => 
      text.includes(keyword)
    );

    if (hasJapaneseKeywords) {
      return 'ja';
    }

    // Default to null (no clear detection)
    return null;
  }

  /**
   * Count Japanese characters in text
   * @private
   */
  countJapaneseCharacters(text) {
    let count = 0;
    for (const char of text) {
      if (this.japanesePatterns.some(pattern => pattern.test(char))) {
        count++;
      }
    }
    return count;
  }

  /**
   * Detect from repository programming language
   * @private
   */
  detectFromRepositoryLanguage(repoLanguage) {
    // Some Japanese developers use Japanese in repos with Japanese names
    if (repoLanguage && repoLanguage.toLowerCase().includes('japan')) {
      return 'ja';
    }
    return null;
  }

  /**
   * Normalize language code
   * @private
   */
  normalizeLanguageCode(code) {
    if (!code) return 'en';
    
    const normalized = code.toLowerCase().substring(0, 2);
    
    // Map variations to standard codes
    const mapping = {
      'jp': 'ja',
      'jpn': 'ja',
      'eng': 'en',
      'us': 'en',
      'uk': 'en'
    };

    return mapping[normalized] || normalized;
  }

  /**
   * Get confidence score for language detection
   * @param {string} text - Text to analyze
   * @param {string} detectedLanguage - Detected language
   * @returns {number} Confidence score (0-1)
   */
  getConfidence(text, detectedLanguage) {
    if (!text || !detectedLanguage) return 0;

    if (detectedLanguage === 'ja') {
      const japaneseCharCount = this.countJapaneseCharacters(text);
      const totalCharCount = text.length;
      return Math.min(japaneseCharCount / totalCharCount * 2, 1);
    }

    // For English, check for absence of non-Latin scripts
    const nonLatinPattern = /[^\u0000-\u007F\s]/g;
    const nonLatinMatches = text.match(nonLatinPattern) || [];
    const latinRatio = 1 - (nonLatinMatches.length / text.length);
    
    return latinRatio;
  }

  /**
   * Detect language with confidence
   * @param {Object} options - Same as detect()
   * @returns {Object} { language: string, confidence: number }
   */
  detectWithConfidence(options) {
    const language = this.detect(options);
    const combinedText = `${options.title || ''} ${options.body || ''}`;
    const confidence = this.getConfidence(combinedText, language);

    return { language, confidence };
  }
}

// Export singleton instance
module.exports = new LanguageDetector();