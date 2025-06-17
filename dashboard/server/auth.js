const bcrypt = require('bcrypt');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

/**
 * 認証ミドルウェア
 */
class AuthMiddleware {
  constructor(config, logger) {
    this.config = config.dashboard?.authentication || {
      enabled: false,
      username: 'admin',
      password: 'changeme'
    };
    
    this.logger = logger;
    
    // セッションシークレットの生成（設定にない場合はランダム生成）
    this.sessionSecret = config.sessionSecret || crypto.randomBytes(32).toString('hex');
    
    // ユーザー情報（将来的にはDBから取得）
    this.users = {};
    this.initializeUsers();
  }
  
  /**
   * ユーザー情報の初期化
   */
  async initializeUsers() {
    // デフォルトユーザーのパスワードをハッシュ化
    const hashedPassword = await bcrypt.hash(this.config.password, 10);
    this.users[this.config.username] = {
      username: this.config.username,
      password: hashedPassword,
      role: 'admin'
    };
    
    this.logger?.info('認証システムを初期化しました');
  }
  
  /**
   * セッションミドルウェアの設定
   */
  getSessionMiddleware() {
    return session({
      secret: this.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 1000 * 60 * 60 * 24, // 24時間
        sameSite: 'strict'
      },
      name: 'poppo.sid' // セッションIDのクッキー名
    });
  }
  
  /**
   * 認証確認ミドルウェア
   */
  requireAuth() {
    return (req, res, next) => {
      // 認証が無効の場合はスキップ
      if (!this.config.enabled) {
        return next();
      }
      
      // 認証APIとログインページは除外
      if (req.path === '/api/auth/login' || 
          req.path === '/login' || 
          req.path === '/api/health' ||
          req.path.startsWith('/css/') ||
          req.path.startsWith('/js/')) {
        return next();
      }
      
      // セッション確認
      if (req.session && req.session.authenticated) {
        // セッションの更新
        req.session.lastActivity = Date.now();
        return next();
      }
      
      // API呼び出しの場合は401を返す
      if (req.path.startsWith('/api/')) {
        return res.status(401).json({ 
          error: 'Authentication required',
          redirectTo: '/login'
        });
      }
      
      // それ以外はログインページにリダイレクト
      res.redirect('/login');
    };
  }
  
  /**
   * ログイン処理
   */
  async login(username, password) {
    const user = this.users[username];
    
    if (!user) {
      this.logger?.warn(`ログイン失敗: ユーザーが存在しません - ${username}`);
      return null;
    }
    
    const isValid = await bcrypt.compare(password, user.password);
    
    if (!isValid) {
      this.logger?.warn(`ログイン失敗: パスワードが不正です - ${username}`);
      return null;
    }
    
    this.logger?.info(`ログイン成功: ${username}`);
    return {
      username: user.username,
      role: user.role
    };
  }
  
  /**
   * ログアウト処理
   */
  logout(req) {
    if (req.session) {
      const username = req.session.user?.username;
      req.session.destroy((err) => {
        if (err) {
          this.logger?.error('セッション削除エラー:', err);
        } else {
          this.logger?.info(`ログアウト: ${username}`);
        }
      });
    }
  }
  
  /**
   * パスワード変更
   */
  async changePassword(username, oldPassword, newPassword) {
    const user = this.users[username];
    
    if (!user) {
      return { success: false, message: 'ユーザーが存在しません' };
    }
    
    const isValid = await bcrypt.compare(oldPassword, user.password);
    
    if (!isValid) {
      return { success: false, message: '現在のパスワードが正しくありません' };
    }
    
    // 新しいパスワードをハッシュ化
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    this.users[username].password = hashedPassword;
    
    this.logger?.info(`パスワード変更成功: ${username}`);
    return { success: true, message: 'パスワードを変更しました' };
  }
  
  /**
   * ブルートフォース対策
   */
  getRateLimiter() {
    const attempts = new Map();
    
    return (req, res, next) => {
      if (!this.config.enabled) {
        return next();
      }
      
      const ip = req.ip;
      const key = `${ip}:${req.path}`;
      const now = Date.now();
      
      // ログインAPIのみ制限
      if (req.path !== '/api/auth/login') {
        return next();
      }
      
      // 試行回数の記録
      if (!attempts.has(key)) {
        attempts.set(key, { count: 0, lastAttempt: now });
      }
      
      const attempt = attempts.get(key);
      
      // 1分以上経過していたらリセット
      if (now - attempt.lastAttempt > 60000) {
        attempt.count = 0;
      }
      
      // 5回以上の試行でブロック
      if (attempt.count >= 5) {
        this.logger?.warn(`ブルートフォース攻撃の可能性: ${ip}`);
        return res.status(429).json({ 
          error: 'Too many login attempts. Please try again later.' 
        });
      }
      
      attempt.count++;
      attempt.lastAttempt = now;
      
      next();
    };
  }
}

module.exports = AuthMiddleware;