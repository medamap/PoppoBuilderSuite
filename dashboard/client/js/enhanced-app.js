/**
 * Enhanced Dashboard Application - Issue #127
 * Main JavaScript for improved UI/UX with accessibility features
 */

class EnhancedDashboardApp {
    constructor() {
        this.currentTheme = 'light';
        this.currentLanguage = 'ja';
        this.currentPanel = 'system';
        this.websocket = null;
        this.isKeyboardUser = false;
        this.toastContainer = null;
        this.modalStack = [];
        this.focusHistory = [];
        
        this.init();
    }

    /**
     * Initialize the dashboard application
     */
    async init() {
        this.setupEventListeners();
        this.setupKeyboardNavigation();
        this.setupAccessibility();
        this.initializeTheme();
        this.initializeLanguage();
        this.setupWebSocket();
        this.hideLoadingScreen();
        this.startDataPolling();
        
        console.log('Enhanced Dashboard initialized');
    }

    /**
     * Set up all event listeners
     */
    setupEventListeners() {
        // Theme toggle
        const themeToggle = document.getElementById('theme-toggle');
        if (themeToggle) {
            themeToggle.addEventListener('click', () => this.toggleTheme());
        }

        // Language toggle
        const languageToggle = document.getElementById('language-toggle');
        if (languageToggle) {
            languageToggle.addEventListener('click', () => this.toggleLanguage());
        }

        // Navigation tabs
        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.addEventListener('click', (e) => this.switchPanel(e.target.dataset.tab));
        });

        // Sub-navigation tabs (analytics)
        document.querySelectorAll('.sub-nav-tab').forEach(tab => {
            tab.addEventListener('click', (e) => this.switchSubPanel(e.target.dataset.subtab));
        });

        // Refresh button
        const refreshBtn = document.getElementById('refresh-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.refreshData());
        }

        // Stop all button
        const stopAllBtn = document.getElementById('stop-all-btn');
        if (stopAllBtn) {
            stopAllBtn.addEventListener('click', () => this.stopAllProcesses());
        }

        // Settings dropdown
        const settingsBtn = document.getElementById('settings-btn');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', () => this.toggleSettingsMenu());
        }

        // Modal close buttons
        document.querySelectorAll('.modal-close').forEach(button => {
            button.addEventListener('click', (e) => this.closeModal(e.target.closest('.modal')));
        });

        // Settings modal triggers
        document.getElementById('layout-settings')?.addEventListener('click', () => this.openSettingsModal());
        document.getElementById('accessibility-settings')?.addEventListener('click', () => this.openSettingsModal());
        document.getElementById('keyboard-shortcuts')?.addEventListener('click', () => this.openShortcutsModal());

        // Form submissions
        const searchForm = document.querySelector('.search-form');
        if (searchForm) {
            searchForm.addEventListener('submit', (e) => this.handleSearchSubmit(e));
        }

        // Resize handler
        window.addEventListener('resize', () => this.handleResize());

        // Click outside to close dropdowns
        document.addEventListener('click', (e) => this.handleOutsideClick(e));

        // Escape key to close modals
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.handleEscapeKey(e);
            }
        });
    }

    /**
     * Set up keyboard navigation
     */
    setupKeyboardNavigation() {
        // Detect keyboard users
        document.addEventListener('keydown', () => {
            if (!this.isKeyboardUser) {
                this.isKeyboardUser = true;
                document.body.classList.add('keyboard-user');
            }
        });

        document.addEventListener('mousedown', () => {
            if (this.isKeyboardUser) {
                this.isKeyboardUser = false;
                document.body.classList.remove('keyboard-user');
            }
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.altKey && !e.ctrlKey && !e.shiftKey) {
                switch (e.key) {
                    case 'r':
                        e.preventDefault();
                        this.refreshData();
                        this.announceToScreenReader('ページを更新しました');
                        break;
                    case 's':
                        e.preventDefault();
                        this.stopAllProcesses();
                        break;
                    case 'd':
                        e.preventDefault();
                        this.toggleTheme();
                        break;
                    case '1':
                        e.preventDefault();
                        this.switchPanel('system');
                        break;
                    case '2':
                        e.preventDefault();
                        this.switchPanel('processes');
                        break;
                    case '3':
                        e.preventDefault();
                        this.switchPanel('logs');
                        break;
                    case '4':
                        e.preventDefault();
                        this.switchPanel('analytics');
                        break;
                }
            } else if (e.ctrlKey && e.key === 'f') {
                e.preventDefault();
                const searchInput = document.getElementById('search-keyword');
                if (searchInput) {
                    searchInput.focus();
                    this.announceToScreenReader('検索フィールドにフォーカスしました');
                }
            }
        });

        // Tab key navigation management
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                this.manageFocus(e);
            }
        });
    }

    /**
     * Set up accessibility features
     */
    setupAccessibility() {
        // Create toast container
        this.toastContainer = document.getElementById('toast-container');
        if (!this.toastContainer) {
            this.toastContainer = document.createElement('div');
            this.toastContainer.id = 'toast-container';
            this.toastContainer.className = 'toast-container';
            this.toastContainer.setAttribute('aria-live', 'assertive');
            this.toastContainer.setAttribute('aria-atomic', 'true');
            document.body.appendChild(this.toastContainer);
        }

        // Setup announcements region
        const announcements = document.getElementById('announcements');
        if (announcements) {
            this.announcementsRegion = announcements;
        }

        // Setup progress bars with proper ARIA
        document.querySelectorAll('.progress-bar').forEach(progressBar => {
            const fill = progressBar.querySelector('.progress-fill');
            const text = progressBar.querySelector('.progress-text');
            if (fill && text) {
                progressBar.addEventListener('update', (e) => {
                    const value = e.detail.value || 0;
                    progressBar.setAttribute('aria-valuenow', value);
                    text.textContent = `${value}%`;
                });
            }
        });

        // Setup form validation
        this.setupFormValidation();

        // Setup virtual scrolling for large lists
        this.setupVirtualScrolling();
    }

    /**
     * Initialize theme based on user preference or system setting
     */
    initializeTheme() {
        const savedTheme = localStorage.getItem('dashboard-theme');
        const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        
        this.currentTheme = savedTheme || (systemPrefersDark ? 'dark' : 'light');
        this.applyTheme(this.currentTheme);

        // Listen for system theme changes
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
            if (!localStorage.getItem('dashboard-theme')) {
                this.currentTheme = e.matches ? 'dark' : 'light';
                this.applyTheme(this.currentTheme);
            }
        });
    }

    /**
     * Initialize language based on user preference or browser setting
     */
    initializeLanguage() {
        const savedLanguage = localStorage.getItem('dashboard-language');
        const browserLanguage = navigator.language || navigator.userLanguage;
        
        this.currentLanguage = savedLanguage || (browserLanguage.startsWith('ja') ? 'ja' : 'en');
        this.applyLanguage(this.currentLanguage);
    }

    /**
     * Toggle between light and dark themes
     */
    toggleTheme() {
        this.currentTheme = this.currentTheme === 'light' ? 'dark' : 'light';
        this.applyTheme(this.currentTheme);
        localStorage.setItem('dashboard-theme', this.currentTheme);
        
        const message = this.currentTheme === 'dark' ? 'ダークモードに切り替えました' : 'ライトモードに切り替えました';
        this.showToast(message, 'info');
        this.announceToScreenReader(message);
    }

    /**
     * Apply theme to the document
     */
    applyTheme(theme) {
        document.body.classList.remove('theme-light', 'theme-dark');
        document.body.classList.add(`theme-${theme}`);
        
        // Add transition class for smooth switching
        document.body.classList.add('theme-transition');
        setTimeout(() => {
            document.body.classList.remove('theme-transition');
        }, 300);

        // Update theme toggle button
        const themeToggle = document.getElementById('theme-toggle');
        if (themeToggle) {
            const label = theme === 'dark' ? 'ライトモードに切り替え' : 'ダークモードに切り替え';
            themeToggle.setAttribute('aria-label', label);
        }
    }

    /**
     * Toggle between languages
     */
    toggleLanguage() {
        this.currentLanguage = this.currentLanguage === 'ja' ? 'en' : 'ja';
        this.applyLanguage(this.currentLanguage);
        localStorage.setItem('dashboard-language', this.currentLanguage);
        
        const message = this.currentLanguage === 'ja' ? '日本語に切り替えました' : 'Switched to English';
        this.showToast(message, 'info');
        this.announceToScreenReader(message);
    }

    /**
     * Apply language to the document
     */
    applyLanguage(language) {
        document.documentElement.lang = language;
        document.body.classList.remove('lang-ja', 'lang-en');
        document.body.classList.add(`lang-${language}`);
        
        // Update language toggle button
        const languageToggle = document.getElementById('language-toggle');
        if (languageToggle) {
            const langText = languageToggle.querySelector('.lang-text');
            if (langText) {
                langText.textContent = language === 'ja' ? 'EN' : 'JA';
            }
        }

        // Update content using i18n if available
        if (window.i18n) {
            window.i18n.setLanguage(language);
        }
    }

    /**
     * Switch to a different panel
     */
    switchPanel(panelId) {
        if (panelId === this.currentPanel) return;

        // Update navigation tabs
        document.querySelectorAll('.nav-tab').forEach(tab => {
            const isActive = tab.dataset.tab === panelId;
            tab.classList.toggle('active', isActive);
            tab.setAttribute('aria-selected', isActive);
        });

        // Update panels
        document.querySelectorAll('.dashboard-panel').forEach(panel => {
            const isActive = panel.id === `${panelId}-panel`;
            panel.classList.toggle('active', isActive);
            if (isActive) {
                panel.focus();
            }
        });

        this.currentPanel = panelId;
        
        // Announce panel change to screen readers
        const panelNames = {
            system: 'システム状態',
            processes: 'プロセス一覧',
            logs: 'ログ検索',
            analytics: 'パフォーマンス分析'
        };
        
        this.announceToScreenReader(`${panelNames[panelId]}パネルに切り替えました`);
        
        // Load panel data if needed
        this.loadPanelData(panelId);
    }

    /**
     * Switch to a different sub-panel within analytics
     */
    switchSubPanel(subPanelId) {
        const parentPanel = document.querySelector('.analytics-panel, #analytics-panel');
        if (!parentPanel) return;

        // Update sub-navigation tabs
        parentPanel.querySelectorAll('.sub-nav-tab').forEach(tab => {
            const isActive = tab.dataset.subtab === subPanelId;
            tab.classList.toggle('active', isActive);
            tab.setAttribute('aria-selected', isActive);
        });

        // Update sub-panels
        parentPanel.querySelectorAll('.analytics-section').forEach(section => {
            const isActive = section.id === `${subPanelId}-section`;
            section.classList.toggle('active', isActive);
        });

        this.loadSubPanelData(subPanelId);
    }

    /**
     * Set up WebSocket connection for real-time updates
     */
    setupWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        
        try {
            this.websocket = new WebSocket(wsUrl);
            
            this.websocket.onopen = () => {
                console.log('WebSocket connected');
                this.showToast('リアルタイム更新が有効になりました', 'success');
            };
            
            this.websocket.onmessage = (event) => {
                this.handleWebSocketMessage(JSON.parse(event.data));
            };
            
            this.websocket.onclose = () => {
                console.log('WebSocket disconnected');
                this.showToast('リアルタイム更新が切断されました', 'warning');
                // Attempt to reconnect after 5 seconds
                setTimeout(() => this.setupWebSocket(), 5000);
            };
            
            this.websocket.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.showToast('接続エラーが発生しました', 'error');
            };
        } catch (error) {
            console.error('Failed to create WebSocket:', error);
            this.fallbackToPolling();
        }
    }

    /**
     * Handle incoming WebSocket messages
     */
    handleWebSocketMessage(data) {
        switch (data.type) {
            case 'process-update':
                this.updateProcessDisplay(data.payload);
                break;
            case 'system-update':
                this.updateSystemStatus(data.payload);
                break;
            case 'notification':
                this.showToast(data.message, data.level || 'info');
                break;
            case 'log':
                this.addLogEntry(data.payload);
                break;
            default:
                console.log('Unknown WebSocket message type:', data.type);
        }
    }

    /**
     * Show toast notification
     */
    showToast(message, type = 'info', duration = 5000) {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.setAttribute('role', 'alert');
        toast.innerHTML = `
            <div class="toast-content">
                <span class="toast-message">${this.escapeHtml(message)}</span>
                <button class="toast-close" aria-label="閉じる">&times;</button>
            </div>
        `;

        const closeButton = toast.querySelector('.toast-close');
        closeButton.addEventListener('click', () => this.removeToast(toast));

        this.toastContainer.appendChild(toast);
        
        // Trigger animation
        requestAnimationFrame(() => {
            toast.classList.add('show');
        });

        // Auto-remove after duration
        if (duration > 0) {
            setTimeout(() => this.removeToast(toast), duration);
        }

        return toast;
    }

    /**
     * Remove toast notification
     */
    removeToast(toast) {
        if (!toast.parentNode) return;
        
        toast.classList.remove('show');
        setTimeout(() => {
            if (toast.parentNode) {
                this.toastContainer.removeChild(toast);
            }
        }, 300);
    }

    /**
     * Announce message to screen readers
     */
    announceToScreenReader(message) {
        if (this.announcementsRegion) {
            this.announcementsRegion.textContent = message;
            // Clear after a short delay to allow for repeated announcements
            setTimeout(() => {
                this.announcementsRegion.textContent = '';
            }, 1000);
        }
    }

    /**
     * Open modal dialog
     */
    openModal(modalId) {
        const modal = document.getElementById(modalId);
        if (!modal) return;

        // Store currently focused element
        this.focusHistory.push(document.activeElement);
        
        modal.setAttribute('aria-hidden', 'false');
        modal.style.display = 'flex';
        this.modalStack.push(modal);

        // Focus management
        const firstFocusable = modal.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (firstFocusable) {
            firstFocusable.focus();
        }

        // Prevent body scroll
        document.body.style.overflow = 'hidden';
        
        // Trap focus within modal
        this.trapFocus(modal);
    }

    /**
     * Close modal dialog
     */
    closeModal(modal) {
        if (!modal) {
            modal = this.modalStack[this.modalStack.length - 1];
        }
        if (!modal) return;

        modal.setAttribute('aria-hidden', 'true');
        modal.style.display = 'none';
        
        // Remove from stack
        const index = this.modalStack.indexOf(modal);
        if (index > -1) {
            this.modalStack.splice(index, 1);
        }

        // Restore focus
        if (this.focusHistory.length > 0) {
            const previousFocus = this.focusHistory.pop();
            if (previousFocus && previousFocus.focus) {
                previousFocus.focus();
            }
        }

        // Restore body scroll if no more modals
        if (this.modalStack.length === 0) {
            document.body.style.overflow = '';
        }
    }

    /**
     * Trap focus within element
     */
    trapFocus(element) {
        const focusableElements = element.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        const firstFocusable = focusableElements[0];
        const lastFocusable = focusableElements[focusableElements.length - 1];

        const handleTabKey = (e) => {
            if (e.key !== 'Tab') return;

            if (e.shiftKey) {
                if (document.activeElement === firstFocusable) {
                    lastFocusable.focus();
                    e.preventDefault();
                }
            } else {
                if (document.activeElement === lastFocusable) {
                    firstFocusable.focus();
                    e.preventDefault();
                }
            }
        };

        element.addEventListener('keydown', handleTabKey);
        
        // Return cleanup function
        return () => {
            element.removeEventListener('keydown', handleTabKey);
        };
    }

    /**
     * Handle escape key press
     */
    handleEscapeKey(e) {
        // Close topmost modal
        if (this.modalStack.length > 0) {
            e.preventDefault();
            this.closeModal(this.modalStack[this.modalStack.length - 1]);
            return;
        }

        // Close dropdowns
        document.querySelectorAll('.dropdown-menu.show').forEach(menu => {
            menu.classList.remove('show');
            menu.setAttribute('aria-expanded', 'false');
        });
    }

    /**
     * Handle click outside dropdowns
     */
    handleOutsideClick(e) {
        // Close any open dropdowns that weren't clicked
        document.querySelectorAll('.dropdown').forEach(dropdown => {
            if (!dropdown.contains(e.target)) {
                const menu = dropdown.querySelector('.dropdown-menu');
                if (menu && menu.classList.contains('show')) {
                    menu.classList.remove('show');
                    menu.setAttribute('aria-expanded', 'false');
                }
            }
        });
    }

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Hide loading screen
     */
    hideLoadingScreen() {
        const loadingScreen = document.getElementById('loading-screen');
        if (loadingScreen) {
            loadingScreen.setAttribute('aria-hidden', 'true');
            setTimeout(() => {
                loadingScreen.style.display = 'none';
            }, 300);
        }
    }

    /**
     * Load panel-specific data
     */
    async loadPanelData(panelId) {
        switch (panelId) {
            case 'system':
                await this.loadSystemData();
                break;
            case 'processes':
                await this.loadProcessData();
                break;
            case 'logs':
                await this.loadLogData();
                break;
            case 'analytics':
                await this.loadAnalyticsData();
                break;
        }
    }

    /**
     * Start data polling for real-time updates
     */
    startDataPolling() {
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            // WebSocket is available, no need for polling
            return;
        }

        // Fallback to polling
        this.pollingInterval = setInterval(() => {
            this.refreshData();
        }, 5000);
    }

    /**
     * Refresh all data
     */
    async refreshData() {
        try {
            await Promise.all([
                this.loadSystemData(),
                this.loadProcessData()
            ]);
            
            this.announceToScreenReader('データを更新しました');
        } catch (error) {
            console.error('Failed to refresh data:', error);
            this.showToast('データの更新に失敗しました', 'error');
        }
    }

    /**
     * Load system status data
     */
    async loadSystemData() {
        // Implementation will depend on API endpoints
        // This is a placeholder for the actual implementation
        console.log('Loading system data...');
    }

    /**
     * Load process data
     */
    async loadProcessData() {
        // Implementation will depend on API endpoints
        // This is a placeholder for the actual implementation
        console.log('Loading process data...');
    }

    /**
     * Load log data
     */
    async loadLogData() {
        // Implementation will depend on API endpoints
        console.log('Loading log data...');
    }

    /**
     * Load analytics data
     */
    async loadAnalyticsData() {
        // Implementation will depend on API endpoints
        console.log('Loading analytics data...');
    }

    /**
     * Stop all processes
     */
    async stopAllProcesses() {
        if (!confirm('すべてのプロセスを停止しますか？')) {
            return;
        }

        try {
            // Implementation will depend on API endpoints
            console.log('Stopping all processes...');
            this.showToast('すべてのプロセスを停止しました', 'success');
        } catch (error) {
            console.error('Failed to stop processes:', error);
            this.showToast('プロセスの停止に失敗しました', 'error');
        }
    }

    // Additional methods for form validation, virtual scrolling, etc.
    // would be implemented here based on specific requirements
    
    setupFormValidation() {
        // Implement form validation logic
    }
    
    setupVirtualScrolling() {
        // Implement virtual scrolling for large process lists
    }
    
    toggleSettingsMenu() {
        // Implement settings dropdown toggle
    }
    
    openSettingsModal() {
        // Implement settings modal
    }
    
    openShortcutsModal() {
        // Implement keyboard shortcuts modal
    }
    
    handleSearchSubmit(e) {
        // Implement search functionality
        e.preventDefault();
    }
    
    handleResize() {
        // Handle window resize events
    }
    
    manageFocus(e) {
        // Implement focus management for tab navigation
    }
    
    fallbackToPolling() {
        // Implement polling fallback when WebSocket fails
        this.startDataPolling();
    }
    
    updateProcessDisplay(data) {
        // Update process display with real-time data
    }
    
    updateSystemStatus(data) {
        // Update system status with real-time data
    }
    
    addLogEntry(data) {
        // Add new log entry to display
    }
    
    loadSubPanelData(subPanelId) {
        // Load data for analytics sub-panels
    }
}

// Initialize the enhanced dashboard when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.dashboardApp = new EnhancedDashboardApp();
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = EnhancedDashboardApp;
}