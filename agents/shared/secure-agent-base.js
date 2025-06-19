const AgentBase = require('./agent-base');
const AuthMiddleware = require('../../src/security/auth-middleware');
const path = require('path');
const fs = require('fs').promises;

/**
 * セキュリティ強化されたエージェント基盤クラス
 * JWT認証とRBACをサポート
 */
class SecureAgentBase extends AgentBase {
    constructor(agentName, config = {}) {
        super(agentName, config);
        
        this.authMiddleware = new AuthMiddleware();
        this.accessToken = null;
        this.refreshToken = null;
        this.tokenExpiry = null;
        this.apiKey = config.apiKey || process.env[`${agentName.toUpperCase()}_API_KEY`];
        this.agentCredentialId = config.agentCredentialId || agentName.toLowerCase().replace(/\s+/g, '-');
    }

    /**
     * エージェントの初期化（認証を含む）
     */
    async initialize() {
        try {
            this.logger.info(`セキュアエージェント ${this.agentName} を初期化中...`);
            
            // 認証ミドルウェアの初期化
            await this.authMiddleware.initialize();
            
            // APIキーの読み込み（環境変数または設定ファイルから）
            if (!this.apiKey) {
                await this.loadApiKey();
            }
            
            // 認証の実行
            await this.authenticate();
            
            // トークン自動更新の設定
            this.setupTokenRefresh();
            
            // 親クラスの初期化を呼び出し
            await super.initialize();
            
        } catch (error) {
            this.logger.error(`セキュアエージェント初期化エラー: ${error.message}`);
            throw error;
        }
    }

    /**
     * APIキーの読み込み
     */
    async loadApiKey() {
        try {
            const keyPath = path.join(process.cwd(), 'config', 'security', 'keys', `${this.agentCredentialId}.key`);
            this.apiKey = await fs.readFile(keyPath, 'utf8');
            this.apiKey = this.apiKey.trim();
        } catch (error) {
            throw new Error(`APIキーの読み込みに失敗しました: ${error.message}`);
        }
    }

    /**
     * 認証の実行
     */
    async authenticate() {
        try {
            const authResult = await this.authMiddleware.authenticate(
                this.agentCredentialId,
                this.apiKey,
                {
                    agentName: this.agentName,
                    version: this.config.version || '1.0.0'
                }
            );
            
            this.accessToken = authResult.accessToken;
            this.refreshToken = authResult.refreshToken;
            this.tokenExpiry = new Date(Date.now() + this.parseExpiry(authResult.expiresIn));
            this.permissions = authResult.permissions;
            this.role = authResult.role;
            
            this.logger.info(`認証成功: ${this.agentName} (ロール: ${this.role})`);
            
        } catch (error) {
            this.logger.error(`認証失敗: ${error.message}`);
            throw error;
        }
    }

    /**
     * トークン有効期限の解析
     */
    parseExpiry(expiresIn) {
        const match = expiresIn.match(/(\d+)([mhd])/);
        if (!match) return 0;
        
        const value = parseInt(match[1]);
        const unit = match[2];
        
        switch (unit) {
            case 'm': return value * 60 * 1000;
            case 'h': return value * 60 * 60 * 1000;
            case 'd': return value * 24 * 60 * 60 * 1000;
            default: return 0;
        }
    }

    /**
     * トークン自動更新の設定
     */
    setupTokenRefresh() {
        const refreshInterval = (this.tokenExpiry - Date.now()) * 0.8;
        
        this.tokenRefreshTimer = setTimeout(async () => {
            try {
                await this.refreshAccessToken();
                this.setupTokenRefresh();
            } catch (error) {
                this.logger.error(`トークン更新失敗: ${error.message}`);
                await this.authenticate();
            }
        }, refreshInterval);
    }

    /**
     * アクセストークンの更新
     */
    async refreshAccessToken() {
        try {
            const result = await this.authMiddleware.refreshToken(this.refreshToken, {
                agentName: this.agentName
            });
            
            this.accessToken = result.accessToken;
            this.tokenExpiry = new Date(Date.now() + this.parseExpiry(result.expiresIn));
            
            this.logger.debug('アクセストークンを更新しました');
            
        } catch (error) {
            this.logger.error(`トークン更新エラー: ${error.message}`);
            throw error;
        }
    }

    /**
     * メッセージの送信（認証付き）
     */
    async sendMessage(recipient, message) {
        message.auth = {
            token: this.accessToken,
            agentId: this.agentCredentialId,
            timestamp: new Date().toISOString()
        };
        
        await super.sendMessage(recipient, message);
    }

    /**
     * メッセージの処理（認証チェック付き）
     */
    async handleMessage(message) {
        if (message.from === 'core') {
            await super.handleMessage(message);
            return;
        }
        
        try {
            const validation = await this.authMiddleware.createFileMessageMiddleware()(message);
            
            if (!validation.valid) {
                this.logger.warn(`無効なメッセージを受信: ${validation.error}`);
                return;
            }
            
            await super.handleMessage(message);
            
        } catch (error) {
            this.logger.error(`メッセージ認証エラー: ${error.message}`);
            await this.sendErrorNotification(message, error);
        }
    }

    /**
     * 権限チェック
     */
    hasPermission(permission) {
        if (!this.permissions) return false;
        
        if (this.permissions.includes('*')) return true;
        
        if (this.permissions.includes(permission)) return true;
        
        const [resource, action] = permission.split('.');
        const wildcardPermission = `${resource}.*`;
        
        return this.permissions.includes(wildcardPermission);
    }

    /**
     * セキュアなタスク処理
     */
    async handleTaskAssignment(message) {
        const requiredPermission = this.getRequiredPermissionForTask(message);
        
        if (requiredPermission && !this.hasPermission(requiredPermission)) {
            this.logger.error(`権限不足: ${requiredPermission}`);
            
            await this.sendMessage('core', {
                type: 'TASK_REJECTED',
                taskId: message.taskId,
                reason: 'insufficient_permissions',
                requiredPermission,
                agentPermissions: this.permissions
            });
            
            return;
        }
        
        await super.handleTaskAssignment(message);
    }

    /**
     * タスクに必要な権限の取得（サブクラスで実装）
     */
    getRequiredPermissionForTask(message) {
        return null;
    }

    /**
     * セキュリティメトリクスの送信
     */
    async sendHeartbeat() {
        const baseHeartbeat = await super.sendHeartbeat();
        
        await this.sendMessage('core', {
            ...baseHeartbeat,
            security: {
                authenticated: true,
                role: this.role,
                tokenExpiry: this.tokenExpiry,
                permissionCount: this.permissions ? this.permissions.length : 0
            }
        });
    }

    /**
     * エージェントのシャットダウン
     */
    async shutdown() {
        if (this.tokenRefreshTimer) {
            clearTimeout(this.tokenRefreshTimer);
        }
        
        await super.shutdown();
    }

    /**
     * APIキーのローテーション
     */
    async rotateApiKey() {
        try {
            const newApiKey = await this.authMiddleware.generateNewApiKey(this.agentCredentialId);
            
            const keyPath = path.join(process.cwd(), 'config', 'security', 'keys', `${this.agentCredentialId}.key`);
            await fs.mkdir(path.dirname(keyPath), { recursive: true });
            await fs.writeFile(keyPath, newApiKey, { mode: 0o600 });
            
            this.apiKey = newApiKey;
            
            await this.authenticate();
            
            this.logger.info('APIキーをローテーションしました');
            
        } catch (error) {
            this.logger.error(`APIキーローテーションエラー: ${error.message}`);
            throw error;
        }
    }
}

module.exports = SecureAgentBase;