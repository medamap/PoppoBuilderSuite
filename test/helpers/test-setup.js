const chai = require('chai');

// 依存関係を追加（互換性のためのバージョンチェック）
try {
    // chai-as-promisedがChaiの新しいバージョンと互換性があるかチェック
    const chaiAsPromised = require('chai-as-promised');
    if (typeof chaiAsPromised === 'function') {
        chai.use(chaiAsPromised);
        console.log('✅ chai-as-promised loaded successfully');
    } else {
        console.warn('❌ chai-as-promised: incompatible version');
    }
} catch (e) {
    console.warn('❌ chai-as-promised not available:', e.message);
}

try {
    // sinon-chaiの互換性チェック
    const sinonChai = require('sinon-chai');
    if (typeof sinonChai === 'function') {
        chai.use(sinonChai);
        console.log('✅ sinon-chai loaded successfully');
    } else {
        console.warn('❌ sinon-chai: incompatible version');
    }
} catch (e) {
    console.warn('❌ sinon-chai not available:', e.message);
}

// 重複した設定を削除

// グローバルなchai設定
chai.config.includeStack = true;
chai.config.showDiff = true;

// テスト用の共通設定
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error'; // テスト中はログを最小限に

// 未処理の Promise rejection をキャッチ
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // テスト環境では process.exit(1) はしない
});

// 未処理の Exception をキャッチ
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    // テスト環境では process.exit(1) はしない
});

module.exports = chai;