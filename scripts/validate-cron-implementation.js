#!/usr/bin/env node
/**
 * Issue #98 実装検証スクリプト
 * 
 * minimal-poppo-cron.js の実装を検証します
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

class CronImplementationValidator {
  constructor() {
    this.projectRoot = path.join(__dirname, '..');
    this.cronScript = path.join(this.projectRoot, 'src/minimal-poppo-cron.js');
    this.testResults = [];
  }

  /**
   * 全ての検証を実行
   */
  async runValidation() {
    console.log('🔍 Issue #98 実装検証開始...');
    console.log('');

    await this.validateFileStructure();
    await this.validateDuplicateStartupPrevention();
    await this.validateStateManagement();
    await this.validateErrorHandling();
    await this.validateCleanupProcess();

    this.generateReport();
  }

  /**
   * ファイル構造の検証
   */
  async validateFileStructure() {
    console.log('📁 ファイル構造検証...');
    
    const requiredFiles = [
      'src/minimal-poppo-cron.js',
      'state/running-tasks.json'
    ];

    let allFilesExist = true;
    
    for (const file of requiredFiles) {
      const filePath = path.join(this.projectRoot, file);
      const exists = fs.existsSync(filePath);
      
      if (exists) {
        console.log(`  ✅ ${file} - 存在`);
      } else {
        console.log(`  ❌ ${file} - 見つからない`);
        allFilesExist = false;
      }
    }

    this.testResults.push({
      test: 'ファイル構造',
      status: allFilesExist ? 'PASS' : 'FAIL',
      details: `必要ファイル ${requiredFiles.length}件中 ${requiredFiles.filter(f => fs.existsSync(path.join(this.projectRoot, f))).length}件存在`
    });

    console.log('');
  }

  /**
   * 二重起動防止の検証
   */
  async validateDuplicateStartupPrevention() {
    console.log('🚫 二重起動防止検証...');
    
    return new Promise((resolve) => {
      let firstProcess, secondProcess;
      let firstStarted = false, secondBlocked = false;
      
      try {
        // 1つ目のプロセス起動
        firstProcess = spawn('node', [this.cronScript], {
          env: { ...process.env, TEST_MODE: 'true' },
          stdio: 'pipe'
        });

        firstProcess.stdout.on('data', (data) => {
          if (data.toString().includes('初期化')) {
            firstStarted = true;
            console.log('  ✅ 1つ目のプロセス起動成功');
            
            // 1秒後に2つ目のプロセス起動
            setTimeout(() => {
              secondProcess = spawn('node', [this.cronScript], {
                env: { ...process.env, TEST_MODE: 'true' },
                stdio: 'pipe'
              });

              secondProcess.stdout.on('data', (data) => {
                if (data.toString().includes('他のcronプロセスが実行中')) {
                  secondBlocked = true;
                  console.log('  ✅ 2つ目のプロセスが正しくブロックされた');
                }
              });

              secondProcess.on('exit', (code) => {
                if (code === 0 && secondBlocked) {
                  console.log('  ✅ 2つ目のプロセスが適切に終了');
                  
                  this.testResults.push({
                    test: '二重起動防止',
                    status: 'PASS',
                    details: '2つ目のプロセスが正しくブロックされ、適切に終了'
                  });
                } else {
                  console.log('  ❌ 2つ目のプロセスの動作に問題');
                  
                  this.testResults.push({
                    test: '二重起動防止',
                    status: 'FAIL',
                    details: '2つ目のプロセスが期待通りに動作しない'
                  });
                }
                
                // 1つ目のプロセスを終了
                if (firstProcess && !firstProcess.killed) {
                  firstProcess.kill('SIGTERM');
                }
                resolve();
              });

              // 5秒後に強制終了
              setTimeout(() => {
                if (secondProcess && !secondProcess.killed) {
                  secondProcess.kill('SIGTERM');
                }
              }, 5000);
            }, 1000);
          }
        });

        firstProcess.on('error', (error) => {
          console.log(`  ❌ 1つ目のプロセス起動エラー: ${error.message}`);
          this.testResults.push({
            test: '二重起動防止',
            status: 'FAIL',
            details: `1つ目のプロセス起動エラー: ${error.message}`
          });
          resolve();
        });

        // 10秒でタイムアウト
        setTimeout(() => {
          if (firstProcess && !firstProcess.killed) {
            firstProcess.kill('SIGTERM');
          }
          if (secondProcess && !secondProcess.killed) {
            secondProcess.kill('SIGTERM');
          }
          
          if (!firstStarted) {
            console.log('  ❌ 1つ目のプロセスが起動しない');
            this.testResults.push({
              test: '二重起動防止',
              status: 'FAIL',
              details: '1つ目のプロセスがタイムアウト'
            });
          }
          resolve();
        }, 10000);

      } catch (error) {
        console.log(`  ❌ テスト実行エラー: ${error.message}`);
        this.testResults.push({
          test: '二重起動防止',
          status: 'FAIL',
          details: `テスト実行エラー: ${error.message}`
        });
        resolve();
      }
    });
  }

  /**
   * 状態管理の検証
   */
  async validateStateManagement() {
    console.log('💾 状態管理検証...');
    
    const lockDir = path.join(this.projectRoot, 'state/.locks');
    const lockFile = path.join(lockDir, 'cron-process.lock');
    
    // ロックファイルディレクトリの確認
    if (!fs.existsSync(lockDir)) {
      fs.mkdirSync(lockDir, { recursive: true });
    }
    
    // 既存のロックファイルをクリーンアップ
    if (fs.existsSync(lockFile)) {
      fs.unlinkSync(lockFile);
    }

    return new Promise((resolve) => {
      const testProcess = spawn('node', [this.cronScript], {
        env: { ...process.env, TEST_MODE: 'quick' },
        stdio: 'pipe'
      });

      let lockCreated = false;
      
      // より早いタイミングでロックファイルをチェック
      const checkLockFile = () => {
        if (fs.existsSync(lockFile)) {
          lockCreated = true;
          console.log('  ✅ ロックファイル作成');
          
          try {
            const lockContent = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
            if (lockContent.pid && lockContent.startTime && lockContent.hostname) {
              console.log('  ✅ ロックファイル内容が正しい');
            } else {
              console.log('  ❌ ロックファイル内容に不備');
            }
          } catch (error) {
            console.log('  ❌ ロックファイル形式エラー');
          }
          return true;
        }
        return false;
      };
      
      // 500ms間隔で最大4秒間チェック
      let checkCount = 0;
      const lockCheckInterval = setInterval(() => {
        checkCount++;
        if (checkLockFile() || checkCount >= 8) {
          clearInterval(lockCheckInterval);
          if (!lockCreated && checkCount >= 8) {
            console.log('  ❌ ロックファイル未作成（タイムアウト）');
          }
        }
      }, 500);

      testProcess.on('exit', () => {
        setTimeout(() => {
          // ロックファイルの削除確認
          const lockDeleted = !fs.existsSync(lockFile);
          
          if (lockCreated && lockDeleted) {
            console.log('  ✅ ロックファイル適切に削除');
            this.testResults.push({
              test: '状態管理',
              status: 'PASS',
              details: 'ロックファイルの作成・削除が正常'
            });
          } else {
            console.log('  ❌ 状態管理に問題');
            this.testResults.push({
              test: '状態管理',
              status: 'FAIL',
              details: `ロック作成: ${lockCreated}, ロック削除: ${lockDeleted}`
            });
          }
          resolve();
        }, 1000);
      });

      // 5秒後にプロセス終了
      setTimeout(() => {
        testProcess.kill('SIGTERM');
      }, 5000);
    });
  }

  /**
   * エラーハンドリング検証
   */
  async validateErrorHandling() {
    console.log('🚨 エラーハンドリング検証...');
    
    return new Promise((resolve) => {
      // 存在しない設定ファイルでテスト
      const testProcess = spawn('node', [this.cronScript], {
        env: { 
          ...process.env, 
          TEST_MODE: 'error_test',
          CONFIG_PATH: '/nonexistent/config.json'
        },
        stdio: 'pipe'
      });

      let errorHandled = false;
      
      testProcess.stderr.on('data', (data) => {
        if (data.toString().includes('エラー')) {
          errorHandled = true;
        }
      });

      testProcess.on('exit', (code) => {
        if (code !== 0) {
          console.log('  ✅ エラー時に適切な終了コード');
          this.testResults.push({
            test: 'エラーハンドリング',
            status: 'PASS',
            details: `非ゼロ終了コード: ${code}`
          });
        } else {
          console.log('  ❌ エラー時の終了コードが不適切');
          this.testResults.push({
            test: 'エラーハンドリング',
            status: 'FAIL',
            details: 'エラー時も終了コード0'
          });
        }
        resolve();
      });

      // 10秒でタイムアウト
      setTimeout(() => {
        testProcess.kill('SIGTERM');
        resolve();
      }, 10000);
    });
  }

  /**
   * クリーンアップ処理検証
   */
  async validateCleanupProcess() {
    console.log('🧹 クリーンアップ処理検証...');
    
    return new Promise((resolve) => {
      const testProcess = spawn('node', [this.cronScript], {
        env: { ...process.env, TEST_MODE: 'cleanup_test' },
        stdio: 'pipe'
      });

      let cleanupDetected = false;
      
      testProcess.stdout.on('data', (data) => {
        if (data.toString().includes('クリーンアップ')) {
          cleanupDetected = true;
          console.log('  ✅ クリーンアップ処理実行');
        }
      });

      // 3秒後にSIGTERM送信
      setTimeout(() => {
        testProcess.kill('SIGTERM');
      }, 3000);

      testProcess.on('exit', (code) => {
        if (cleanupDetected && code === 0) {
          console.log('  ✅ クリーンアップ後の正常終了');
          this.testResults.push({
            test: 'クリーンアップ処理',
            status: 'PASS',
            details: 'SIGTERM受信後のクリーンアップが正常'
          });
        } else {
          console.log('  ❌ クリーンアップ処理に問題');
          this.testResults.push({
            test: 'クリーンアップ処理',
            status: 'FAIL',
            details: `クリーンアップ検出: ${cleanupDetected}, 終了コード: ${code}`
          });
        }
        resolve();
      });
    });
  }

  /**
   * 検証レポート生成
   */
  generateReport() {
    console.log('');
    console.log('📋 検証結果レポート');
    console.log('='.repeat(50));
    
    const passCount = this.testResults.filter(r => r.status === 'PASS').length;
    const failCount = this.testResults.filter(r => r.status === 'FAIL').length;
    
    this.testResults.forEach(result => {
      const icon = result.status === 'PASS' ? '✅' : '❌';
      console.log(`${icon} ${result.test}: ${result.status}`);
      console.log(`   ${result.details}`);
    });
    
    console.log('');
    console.log(`📊 結果サマリー: ${passCount}件成功, ${failCount}件失敗`);
    
    if (failCount === 0) {
      console.log('🎉 Issue #98 の実装は正常に完了しました！');
    } else {
      console.log('⚠️ 一部のテストが失敗しました。実装の見直しが必要です。');
    }
    
    // 詳細レポートをファイルに保存
    const reportData = {
      timestamp: new Date().toISOString(),
      summary: {
        total: this.testResults.length,
        passed: passCount,
        failed: failCount,
        successRate: (passCount / this.testResults.length * 100).toFixed(1) + '%'
      },
      results: this.testResults,
      recommendations: this.generateRecommendations()
    };
    
    const reportPath = path.join(this.projectRoot, 'reports/issue-98-validation-report.json');
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2));
    
    console.log(`📄 詳細レポート: ${reportPath}`);
  }

  /**
   * 推奨事項生成
   */
  generateRecommendations() {
    const recommendations = [];
    
    const failedTests = this.testResults.filter(r => r.status === 'FAIL');
    
    if (failedTests.length === 0) {
      recommendations.push('実装は適切に完了しています。本番環境での動作確認を推奨します。');
    } else {
      failedTests.forEach(test => {
        switch (test.test) {
          case 'ファイル構造':
            recommendations.push('必要なファイルが不足しています。src/minimal-poppo-cron.js とstate/running-tasks.json を確認してください。');
            break;
          case '二重起動防止':
            recommendations.push('ロックメカニズムの実装を見直してください。FileStateManager.acquireProcessLock() の動作を確認してください。');
            break;
          case '状態管理':
            recommendations.push('ロックファイルの作成・削除処理を確認してください。state/.locks/ ディレクトリの権限も確認してください。');
            break;
          case 'エラーハンドリング':
            recommendations.push('エラー時の終了処理を見直してください。try-catch ブロックと適切な終了コードの設定を確認してください。');
            break;
          case 'クリーンアップ処理':
            recommendations.push('シグナルハンドラーとクリーンアップロジックを確認してください。process.on() イベントの実装を見直してください。');
            break;
        }
      });
    }
    
    return recommendations;
  }
}

// メイン実行
async function main() {
  const validator = new CronImplementationValidator();
  
  try {
    await validator.runValidation();
    process.exit(0);
  } catch (error) {
    console.error('❌ 検証中にエラーが発生しました:', error);
    process.exit(1);
  }
}

// スクリプトとして実行された場合
if (require.main === module) {
  main();
}

module.exports = CronImplementationValidator;