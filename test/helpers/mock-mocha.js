/**
 * Mocha環境セットアップ用のモック
 * test-setup.jsの代替として使用
 */

// Mochaのグローバル関数が存在しない場合は定義
if (typeof global.describe === 'undefined') {
  global.describe = function(name, fn) {
    console.log(`Suite: ${name}`);
    if (typeof fn === 'function') fn();
  };
}

if (typeof global.it === 'undefined') {
  global.it = function(name, fn) {
    console.log(`Test: ${name}`);
    if (typeof fn === 'function') fn();
  };
}

if (typeof global.before === 'undefined') {
  global.before = function(fn) {
    if (typeof fn === 'function') fn();
  };
}

if (typeof global.after === 'undefined') {
  global.after = function(fn) {
    if (typeof fn === 'function') fn();
  };
}

if (typeof global.beforeEach === 'undefined') {
  global.beforeEach = function(fn) {
    if (typeof fn === 'function') fn();
  };
}

if (typeof global.afterEach === 'undefined') {
  global.afterEach = function(fn) {
    if (typeof fn === 'function') fn();
  };
}

// Mock Mocha environment loaded (no console output)