/**
 * Accessibility JavaScript - Issue #127
 * Enhanced accessibility features and assistive technology support
 */

class AccessibilityManager {
    constructor() {
        this.highContrastMode = false;
        this.reducedMotion = false;
        this.fontSize = 16;
        this.screenReaderMode = false;
        this.keyboardOnly = false;
        
        this.init();
    }

    /**
     * Initialize accessibility features
     */
    init() {
        this.detectAccessibilityPreferences();
        this.setupAccessibilitySettings();
        this.setupScreenReaderSupport();
        this.setupKeyboardSupport();
        this.setupFocusManagement();
        this.setupReducedMotion();
        this.setupHighContrast();
        this.setupFontSizeAdjustment();
        this.setupAccessibilityAnnouncements();
        
        console.log('Accessibility Manager initialized');
    }

    /**
     * Detect user's accessibility preferences
     */
    detectAccessibilityPreferences() {
        // Check for reduced motion preference
        this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        
        // Check for high contrast preference
        this.highContrastMode = window.matchMedia('(prefers-contrast: high)').matches;
        
        // Check for screen reader
        this.screenReaderMode = this.detectScreenReader();
        
        // Load saved preferences
        this.loadSavedPreferences();
        
        // Apply initial settings
        this.applyAccessibilitySettings();
    }

    /**
     * Detect if screen reader is likely being used
     */
    detectScreenReader() {
        // Check for common screen reader indicators
        return (
            navigator.userAgent.includes('NVDA') ||
            navigator.userAgent.includes('JAWS') ||
            navigator.userAgent.includes('VoiceOver') ||
            navigator.userAgent.includes('TalkBack') ||
            window.speechSynthesis ||
            navigator.userAgent.includes('Dragon')
        );
    }

    /**
     * Load saved accessibility preferences
     */
    loadSavedPreferences() {
        const saved = localStorage.getItem('accessibility-preferences');
        if (saved) {
            try {
                const preferences = JSON.parse(saved);
                this.highContrastMode = preferences.highContrast || this.highContrastMode;
                this.reducedMotion = preferences.reducedMotion || this.reducedMotion;
                this.fontSize = preferences.fontSize || this.fontSize;
                this.keyboardOnly = preferences.keyboardOnly || false;
            } catch (e) {
                console.warn('Failed to load accessibility preferences:', e);
            }
        }
    }

    /**
     * Save accessibility preferences
     */
    savePreferences() {
        const preferences = {
            highContrast: this.highContrastMode,
            reducedMotion: this.reducedMotion,
            fontSize: this.fontSize,
            keyboardOnly: this.keyboardOnly
        };
        
        localStorage.setItem('accessibility-preferences', JSON.stringify(preferences));
    }

    /**
     * Apply accessibility settings to the document
     */
    applyAccessibilitySettings() {
        document.body.classList.toggle('high-contrast', this.highContrastMode);
        document.body.classList.toggle('reduced-motion', this.reducedMotion);
        document.body.classList.toggle('screen-reader-mode', this.screenReaderMode);
        document.body.classList.toggle('keyboard-only', this.keyboardOnly);
        
        // Apply font size
        document.documentElement.style.fontSize = `${this.fontSize}px`;
        
        this.savePreferences();
    }

    /**
     * Set up accessibility settings panel
     */
    setupAccessibilitySettings() {
        // High contrast toggle
        const highContrastToggle = document.getElementById('high-contrast');
        if (highContrastToggle) {
            highContrastToggle.checked = this.highContrastMode;
            highContrastToggle.addEventListener('change', (e) => {
                this.highContrastMode = e.target.checked;
                this.applyAccessibilitySettings();
                this.announceChange(`高コントラストモードを${this.highContrastMode ? '有効' : '無効'}にしました`);
            });
        }

        // Reduced motion toggle
        const reducedMotionToggle = document.getElementById('reduce-motion');
        if (reducedMotionToggle) {
            reducedMotionToggle.checked = this.reducedMotion;
            reducedMotionToggle.addEventListener('change', (e) => {
                this.reducedMotion = e.target.checked;
                this.applyAccessibilitySettings();
                this.announceChange(`アニメーション${this.reducedMotion ? '削減' : '標準'}モードに変更しました`);
            });
        }

        // Font size slider
        const fontSizeSlider = document.getElementById('font-size');
        if (fontSizeSlider) {
            fontSizeSlider.value = this.fontSize;
            fontSizeSlider.addEventListener('input', (e) => {
                this.fontSize = parseInt(e.target.value);
                this.applyAccessibilitySettings();
                this.announceChange(`フォントサイズを${this.fontSize}pxに変更しました`);
            });
        }
    }

    /**
     * Set up screen reader support
     */
    setupScreenReaderSupport() {
        // Add live regions for dynamic content
        this.createLiveRegions();
        
        // Enhance form labels and descriptions
        this.enhanceFormAccessibility();
        
        // Add skip navigation links
        this.addSkipNavigation();
        
        // Set up table headers and captions
        this.enhanceTableAccessibility();
        
        // Add landmark roles
        this.addLandmarkRoles();
    }

    /**
     * Create ARIA live regions for announcements
     */
    createLiveRegions() {
        // Polite live region for general updates
        if (!document.getElementById('aria-live-polite')) {
            const politeRegion = document.createElement('div');
            politeRegion.id = 'aria-live-polite';
            politeRegion.setAttribute('aria-live', 'polite');
            politeRegion.setAttribute('aria-atomic', 'true');
            politeRegion.className = 'sr-only';
            document.body.appendChild(politeRegion);
        }

        // Assertive live region for important updates
        if (!document.getElementById('aria-live-assertive')) {
            const assertiveRegion = document.createElement('div');
            assertiveRegion.id = 'aria-live-assertive';
            assertiveRegion.setAttribute('aria-live', 'assertive');
            assertiveRegion.setAttribute('aria-atomic', 'true');
            assertiveRegion.className = 'sr-only';
            document.body.appendChild(assertiveRegion);
        }
    }

    /**
     * Enhance form accessibility
     */
    enhanceFormAccessibility() {
        // Associate labels with form controls
        document.querySelectorAll('input, select, textarea').forEach(input => {
            const label = document.querySelector(`label[for="${input.id}"]`) || 
                         input.closest('label');
            
            if (!label && input.placeholder) {
                // Create accessible label from placeholder
                const labelElement = document.createElement('label');
                labelElement.textContent = input.placeholder;
                labelElement.className = 'sr-only';
                labelElement.setAttribute('for', input.id || this.generateId());
                input.parentNode.insertBefore(labelElement, input);
            }
        });

        // Add error announcement for form validation
        document.addEventListener('invalid', (e) => {
            const input = e.target;
            const errorMessage = input.validationMessage || '入力内容に問題があります';
            this.announceError(`${input.name || 'フィールド'}: ${errorMessage}`);
        }, true);
    }

    /**
     * Add skip navigation links
     */
    addSkipNavigation() {
        const skipNav = document.querySelector('.skip-link');
        if (!skipNav) {
            const skipLink = document.createElement('a');
            skipLink.href = '#main-content';
            skipLink.className = 'skip-link';
            skipLink.textContent = 'メインコンテンツへスキップ';
            document.body.insertBefore(skipLink, document.body.firstChild);
        }
    }

    /**
     * Enhance table accessibility
     */
    enhanceTableAccessibility() {
        document.querySelectorAll('table').forEach(table => {
            // Add table caption if missing
            if (!table.caption && !table.getAttribute('aria-label')) {
                const firstHeading = table.previousElementSibling;
                if (firstHeading && /^h[1-6]$/i.test(firstHeading.tagName)) {
                    table.setAttribute('aria-labelledby', firstHeading.id || this.generateId());
                }
            }

            // Enhance header associations
            const headers = table.querySelectorAll('th');
            headers.forEach((header, index) => {
                if (!header.id) {
                    header.id = `table-header-${index}`;
                }
                if (!header.getAttribute('scope')) {
                    header.setAttribute('scope', 'col');
                }
            });
        });
    }

    /**
     * Add landmark roles
     */
    addLandmarkRoles() {
        // Main content
        const main = document.querySelector('main, #main-content, .dashboard-main');
        if (main && !main.getAttribute('role')) {
            main.setAttribute('role', 'main');
        }

        // Navigation
        const nav = document.querySelector('nav, .main-nav');
        if (nav && !nav.getAttribute('role')) {
            nav.setAttribute('role', 'navigation');
        }

        // Banner
        const header = document.querySelector('header, .dashboard-header');
        if (header && !header.getAttribute('role')) {
            header.setAttribute('role', 'banner');
        }
    }

    /**
     * Set up keyboard support
     */
    setupKeyboardSupport() {
        // Track keyboard usage
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                this.keyboardOnly = true;
                document.body.classList.add('keyboard-navigation');
            }
        });

        document.addEventListener('mousedown', () => {
            this.keyboardOnly = false;
            document.body.classList.remove('keyboard-navigation');
        });

        // Arrow key navigation for tab lists
        this.setupArrowKeyNavigation();
        
        // Enter and space key activation
        this.setupKeyActivation();
        
        // Home/End navigation for lists
        this.setupHomeEndNavigation();
    }

    /**
     * Set up arrow key navigation for tab lists
     */
    setupArrowKeyNavigation() {
        document.querySelectorAll('[role="tablist"]').forEach(tablist => {
            tablist.addEventListener('keydown', (e) => {
                const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
                const currentIndex = tabs.indexOf(e.target);
                
                let nextIndex;
                switch (e.key) {
                    case 'ArrowRight':
                    case 'ArrowDown':
                        nextIndex = currentIndex + 1;
                        if (nextIndex >= tabs.length) nextIndex = 0;
                        break;
                    case 'ArrowLeft':
                    case 'ArrowUp':
                        nextIndex = currentIndex - 1;
                        if (nextIndex < 0) nextIndex = tabs.length - 1;
                        break;
                    case 'Home':
                        nextIndex = 0;
                        break;
                    case 'End':
                        nextIndex = tabs.length - 1;
                        break;
                    default:
                        return;
                }
                
                e.preventDefault();
                tabs[nextIndex].focus();
                tabs[nextIndex].click();
            });
        });
    }

    /**
     * Set up Enter and Space key activation
     */
    setupKeyActivation() {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                const target = e.target;
                if (target.getAttribute('role') === 'button' || 
                    target.classList.contains('btn') ||
                    target.classList.contains('nav-tab')) {
                    e.preventDefault();
                    target.click();
                }
            }
        });
    }

    /**
     * Set up Home/End navigation for lists
     */
    setupHomeEndNavigation() {
        document.querySelectorAll('[role="listbox"], [role="menu"]').forEach(list => {
            list.addEventListener('keydown', (e) => {
                const items = Array.from(list.querySelectorAll('[role="option"], [role="menuitem"]'));
                
                switch (e.key) {
                    case 'Home':
                        e.preventDefault();
                        items[0]?.focus();
                        break;
                    case 'End':
                        e.preventDefault();
                        items[items.length - 1]?.focus();
                        break;
                }
            });
        });
    }

    /**
     * Set up focus management
     */
    setupFocusManagement() {
        // Focus visible indicators
        this.setupFocusIndicators();
        
        // Focus trap for modals
        this.setupModalFocusTrap();
        
        // Focus restoration
        this.setupFocusRestoration();
        
        // Focus announcement
        this.setupFocusAnnouncement();
    }

    /**
     * Set up focus indicators
     */
    setupFocusIndicators() {
        // Add focus indicators for custom elements
        document.querySelectorAll('.btn, .nav-tab, .metric-card').forEach(element => {
            if (!element.hasAttribute('tabindex')) {
                element.setAttribute('tabindex', '0');
            }
            
            element.addEventListener('focus', () => {
                element.classList.add('focused');
            });
            
            element.addEventListener('blur', () => {
                element.classList.remove('focused');
            });
        });
    }

    /**
     * Set up modal focus trap
     */
    setupModalFocusTrap() {
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('keydown', (e) => {
                if (e.key === 'Tab') {
                    const focusableElements = modal.querySelectorAll(
                        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
                    );
                    
                    const firstElement = focusableElements[0];
                    const lastElement = focusableElements[focusableElements.length - 1];
                    
                    if (e.shiftKey && document.activeElement === firstElement) {
                        e.preventDefault();
                        lastElement.focus();
                    } else if (!e.shiftKey && document.activeElement === lastElement) {
                        e.preventDefault();
                        firstElement.focus();
                    }
                }
            });
        });
    }

    /**
     * Set up focus restoration
     */
    setupFocusRestoration() {
        this.focusHistory = [];
        
        // Save focus before opening modals
        document.addEventListener('modal-open', (e) => {
            this.focusHistory.push(document.activeElement);
        });
        
        // Restore focus when closing modals
        document.addEventListener('modal-close', (e) => {
            const previousFocus = this.focusHistory.pop();
            if (previousFocus && previousFocus.focus) {
                previousFocus.focus();
            }
        });
    }

    /**
     * Set up focus announcement
     */
    setupFocusAnnouncement() {
        document.addEventListener('focus', (e) => {
            const target = e.target;
            const announcement = this.getFocusAnnouncement(target);
            if (announcement && this.screenReaderMode) {
                this.announceToScreenReader(announcement);
            }
        }, true);
    }

    /**
     * Get appropriate announcement for focused element
     */
    getFocusAnnouncement(element) {
        const role = element.getAttribute('role');
        const ariaLabel = element.getAttribute('aria-label');
        const text = element.textContent?.trim();
        
        if (ariaLabel) return ariaLabel;
        if (text) return text;
        
        switch (role) {
            case 'button':
                return 'ボタン';
            case 'tab':
                return 'タブ';
            case 'menuitem':
                return 'メニュー項目';
            default:
                return element.tagName === 'BUTTON' ? 'ボタン' : null;
        }
    }

    /**
     * Set up reduced motion support
     */
    setupReducedMotion() {
        // Listen for system preference changes
        window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => {
            this.reducedMotion = e.matches;
            this.applyAccessibilitySettings();
        });
        
        // Disable animations when reduced motion is preferred
        if (this.reducedMotion) {
            this.disableAnimations();
        }
    }

    /**
     * Disable animations for reduced motion
     */
    disableAnimations() {
        const style = document.createElement('style');
        style.textContent = `
            *, *::before, *::after {
                animation-duration: 0.01ms !important;
                animation-iteration-count: 1 !important;
                transition-duration: 0.01ms !important;
                scroll-behavior: auto !important;
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * Set up high contrast support
     */
    setupHighContrast() {
        // Listen for system preference changes
        window.matchMedia('(prefers-contrast: high)').addEventListener('change', (e) => {
            this.highContrastMode = e.matches;
            this.applyAccessibilitySettings();
        });
    }

    /**
     * Set up font size adjustment
     */
    setupFontSizeAdjustment() {
        // Keyboard shortcuts for font size
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey) {
                switch (e.key) {
                    case '+':
                    case '=':
                        e.preventDefault();
                        this.increaseFontSize();
                        break;
                    case '-':
                        e.preventDefault();
                        this.decreaseFontSize();
                        break;
                    case '0':
                        e.preventDefault();
                        this.resetFontSize();
                        break;
                }
            }
        });
    }

    /**
     * Increase font size
     */
    increaseFontSize() {
        if (this.fontSize < 24) {
            this.fontSize += 2;
            this.applyAccessibilitySettings();
            this.announceChange(`フォントサイズを${this.fontSize}pxに拡大しました`);
        }
    }

    /**
     * Decrease font size
     */
    decreaseFontSize() {
        if (this.fontSize > 12) {
            this.fontSize -= 2;
            this.applyAccessibilitySettings();
            this.announceChange(`フォントサイズを${this.fontSize}pxに縮小しました`);
        }
    }

    /**
     * Reset font size to default
     */
    resetFontSize() {
        this.fontSize = 16;
        this.applyAccessibilitySettings();
        this.announceChange('フォントサイズをデフォルトにリセットしました');
    }

    /**
     * Set up accessibility announcements
     */
    setupAccessibilityAnnouncements() {
        // Listen for dynamic content changes
        this.setupContentChangeAnnouncements();
        
        // Listen for status changes
        this.setupStatusChangeAnnouncements();
        
        // Listen for error announcements
        this.setupErrorAnnouncements();
    }

    /**
     * Set up content change announcements
     */
    setupContentChangeAnnouncements() {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            const announcement = this.getContentChangeAnnouncement(node);
                            if (announcement) {
                                this.announceToScreenReader(announcement);
                            }
                        }
                    });
                }
            });
        });

        // Observe specific containers for changes
        document.querySelectorAll('.process-list, .search-results, .metric-card').forEach(container => {
            observer.observe(container, { childList: true, subtree: true });
        });
    }

    /**
     * Get announcement for content changes
     */
    getContentChangeAnnouncement(element) {
        if (element.classList.contains('process-item')) {
            return 'プロセス一覧が更新されました';
        }
        if (element.classList.contains('search-result')) {
            return '検索結果が更新されました';
        }
        if (element.classList.contains('toast')) {
            return element.textContent;
        }
        return null;
    }

    /**
     * Set up status change announcements
     */
    setupStatusChangeAnnouncements() {
        // Monitor status indicators
        document.querySelectorAll('[role="status"]').forEach(status => {
            const observer = new MutationObserver(() => {
                const text = status.textContent?.trim();
                if (text) {
                    this.announceToScreenReader(`ステータス: ${text}`);
                }
            });
            
            observer.observe(status, { childList: true, subtree: true, characterData: true });
        });
    }

    /**
     * Set up error announcements
     */
    setupErrorAnnouncements() {
        // Monitor for error messages
        document.addEventListener('error-message', (e) => {
            this.announceError(e.detail.message);
        });
        
        // Monitor for form errors
        document.addEventListener('invalid', (e) => {
            const message = e.target.validationMessage || '入力内容に問題があります';
            this.announceError(message);
        }, true);
    }

    /**
     * Announce message to screen reader (polite)
     */
    announceToScreenReader(message) {
        const region = document.getElementById('aria-live-polite');
        if (region) {
            region.textContent = message;
            setTimeout(() => {
                region.textContent = '';
            }, 1000);
        }
    }

    /**
     * Announce important message to screen reader (assertive)
     */
    announceImportant(message) {
        const region = document.getElementById('aria-live-assertive');
        if (region) {
            region.textContent = message;
            setTimeout(() => {
                region.textContent = '';
            }, 1000);
        }
    }

    /**
     * Announce error message
     */
    announceError(message) {
        this.announceImportant(`エラー: ${message}`);
    }

    /**
     * Announce change/update
     */
    announceChange(message) {
        this.announceToScreenReader(message);
    }

    /**
     * Generate unique ID
     */
    generateId() {
        return `accessibility-${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Get accessibility status
     */
    getStatus() {
        return {
            highContrastMode: this.highContrastMode,
            reducedMotion: this.reducedMotion,
            fontSize: this.fontSize,
            screenReaderMode: this.screenReaderMode,
            keyboardOnly: this.keyboardOnly
        };
    }

    /**
     * Test accessibility compliance
     */
    runAccessibilityTests() {
        const issues = [];
        
        // Check for images without alt text
        document.querySelectorAll('img:not([alt])').forEach(img => {
            issues.push({
                type: 'missing-alt-text',
                element: img,
                message: '画像にalt属性がありません'
            });
        });
        
        // Check for form inputs without labels
        document.querySelectorAll('input, select, textarea').forEach(input => {
            const hasLabel = document.querySelector(`label[for="${input.id}"]`) || input.closest('label');
            if (!hasLabel && !input.getAttribute('aria-label') && !input.getAttribute('aria-labelledby')) {
                issues.push({
                    type: 'missing-label',
                    element: input,
                    message: 'フォーム要素にラベルがありません'
                });
            }
        });
        
        // Check for adequate color contrast
        // This would require more complex analysis
        
        return issues;
    }
}

// Initialize accessibility manager
document.addEventListener('DOMContentLoaded', () => {
    window.accessibilityManager = new AccessibilityManager();
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AccessibilityManager;
}