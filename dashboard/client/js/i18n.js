/**
 * Dashboard Internationalization (i18n) System
 * Provides language switching functionality for the PoppoBuilder Dashboard
 */

class DashboardI18n {
  constructor() {
    this.currentLanguage = 'ja'; // Default to Japanese
    this.translations = {};
    this.supportedLanguages = ['ja', 'en'];
  }

  /**
   * Initialize i18n system
   */
  async init() {
    // Get language from localStorage or use default
    this.currentLanguage = localStorage.getItem('dashboard_language') || 'ja';
    
    // Load translation files
    await this.loadTranslations();
    
    // Apply translations to current page
    this.applyTranslations();
    
    // Set up language switcher if exists
    this.setupLanguageSwitcher();
  }

  /**
   * Load translation files
   */
  async loadTranslations() {
    for (const lang of this.supportedLanguages) {
      try {
        const response = await fetch(`i18n/${lang}.json`);
        this.translations[lang] = await response.json();
      } catch (error) {
        console.error(`Failed to load ${lang} translation:`, error);
        // Fallback to Japanese if English fails
        if (lang === 'en' && this.translations.ja) {
          this.translations[lang] = this.translations.ja;
        }
      }
    }
  }

  /**
   * Get translated text by key path
   * @param {string} keyPath - Dot notation path (e.g., 'header.title')
   * @param {string} [language] - Language code, defaults to current
   * @returns {string} Translated text or key if not found
   */
  t(keyPath, language = this.currentLanguage) {
    const keys = keyPath.split('.');
    let value = this.translations[language];
    
    for (const key of keys) {
      if (value && typeof value === 'object') {
        value = value[key];
      } else {
        // Fallback to Japanese if English key not found
        if (language === 'en' && this.translations.ja) {
          return this.t(keyPath, 'ja');
        }
        return keyPath; // Return key if translation not found
      }
    }
    
    return value || keyPath;
  }

  /**
   * Switch language
   * @param {string} language - Language code
   */
  async setLanguage(language) {
    if (!this.supportedLanguages.includes(language)) {
      console.error(`Unsupported language: ${language}`);
      return;
    }
    
    this.currentLanguage = language;
    localStorage.setItem('dashboard_language', language);
    
    // Update document language attribute
    document.documentElement.lang = language;
    
    // Apply translations
    this.applyTranslations();
    
    // Trigger custom event for other components
    window.dispatchEvent(new CustomEvent('languageChanged', {
      detail: { language }
    }));
  }

  /**
   * Apply translations to elements with data-i18n attributes
   */
  applyTranslations() {
    // Update page title
    document.title = this.t('title');
    
    // Update elements with data-i18n attributes
    const elements = document.querySelectorAll('[data-i18n]');
    elements.forEach(element => {
      const key = element.getAttribute('data-i18n');
      const text = this.t(key);
      
      // Handle different element types
      if (element.tagName === 'INPUT') {
        if (element.type === 'text' || element.type === 'search') {
          element.placeholder = text;
        } else {
          element.value = text;
        }
      } else if (element.tagName === 'OPTION') {
        element.textContent = text;
      } else {
        element.textContent = text;
      }
    });

    // Update elements with data-i18n-html attributes (for HTML content)
    const htmlElements = document.querySelectorAll('[data-i18n-html]');
    htmlElements.forEach(element => {
      const key = element.getAttribute('data-i18n-html');
      element.innerHTML = this.t(key);
    });
  }

  /**
   * Set up language switcher UI
   */
  setupLanguageSwitcher() {
    // Create language switcher if it doesn't exist
    let switcher = document.getElementById('languageSwitcher');
    if (!switcher) {
      switcher = this.createLanguageSwitcher();
    }

    // Update switcher state
    this.updateLanguageSwitcher(switcher);
  }

  /**
   * Create language switcher element
   */
  createLanguageSwitcher() {
    const headerActions = document.querySelector('.header-actions');
    if (!headerActions) return null;

    const switcher = document.createElement('div');
    switcher.id = 'languageSwitcher';
    switcher.className = 'language-switcher';
    
    switcher.innerHTML = `
      <button class="lang-btn ${this.currentLanguage === 'ja' ? 'active' : ''}" data-lang="ja">日本語</button>
      <button class="lang-btn ${this.currentLanguage === 'en' ? 'active' : ''}" data-lang="en">English</button>
    `;

    // Add event listeners
    switcher.addEventListener('click', (e) => {
      if (e.target.classList.contains('lang-btn')) {
        const lang = e.target.getAttribute('data-lang');
        this.setLanguage(lang);
      }
    });

    // Insert before first button
    headerActions.insertBefore(switcher, headerActions.firstChild);
    return switcher;
  }

  /**
   * Update language switcher active state
   */
  updateLanguageSwitcher(switcher) {
    if (!switcher) return;
    
    const buttons = switcher.querySelectorAll('.lang-btn');
    buttons.forEach(btn => {
      const lang = btn.getAttribute('data-lang');
      btn.classList.toggle('active', lang === this.currentLanguage);
    });
  }

  /**
   * Get current language
   */
  getCurrentLanguage() {
    return this.currentLanguage;
  }

  /**
   * Check if language is supported
   */
  isLanguageSupported(language) {
    return this.supportedLanguages.includes(language);
  }
}

// Create global instance
window.i18n = new DashboardI18n();

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => window.i18n.init());
} else {
  window.i18n.init();
}