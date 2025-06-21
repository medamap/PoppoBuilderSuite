const chai = require('chai');
const { expect } = chai;

/**
 * カスタムアサーションヘルパー
 */
class AssertionHelpers {
    /**
     * 非同期関数が指定されたエラーでリジェクトされることを確認
     */
    static async expectRejection(promise, expectedError) {
        try {
            await promise;
            throw new Error('Expected promise to be rejected, but it was resolved');
        } catch (error) {
            if (expectedError) {
                if (typeof expectedError === 'string') {
                    expect(error.message).to.include(expectedError);
                } else if (expectedError instanceof RegExp) {
                    expect(error.message).to.match(expectedError);
                } else if (typeof expectedError === 'function') {
                    expect(error).to.be.instanceOf(expectedError);
                }
            }
            return error;
        }
    }

    /**
     * 非同期関数が正常に完了することを確認
     */
    static async expectResolution(promise, expectedValue) {
        try {
            const result = await promise;
            if (expectedValue !== undefined) {
                expect(result).to.deep.equal(expectedValue);
            }
            return result;
        } catch (error) {
            throw new Error(`Expected promise to resolve, but it was rejected with: ${error.message}`);
        }
    }

    /**
     * オブジェクトが指定されたプロパティを持つことを確認
     */
    static expectProperties(obj, properties) {
        if (Array.isArray(properties)) {
            properties.forEach(prop => {
                expect(obj).to.have.property(prop);
            });
        } else {
            Object.keys(properties).forEach(key => {
                expect(obj).to.have.property(key, properties[key]);
            });
        }
    }

    /**
     * 関数が指定された回数呼び出されることを確認
     */
    static expectCallCount(stub, count) {
        expect(stub.callCount).to.equal(count, 
            `Expected ${stub.callCount} calls, but got ${count}`);
    }

    /**
     * 関数が指定された引数で呼び出されることを確認
     */
    static expectCalledWith(stub, ...args) {
        expect(stub).to.have.been.calledWith(...args);
    }

    /**
     * 関数が少なくとも一回呼び出されることを確認
     */
    static expectCalled(stub) {
        expect(stub).to.have.been.called;
    }

    /**
     * 配列が指定された長さを持つことを確認
     */
    static expectArrayLength(array, length) {
        expect(array).to.be.an('array');
        expect(array).to.have.lengthOf(length);
    }

    /**
     * 配列が指定された要素を含むことを確認
     */
    static expectArrayContains(array, element) {
        expect(array).to.be.an('array');
        expect(array).to.include(element);
    }

    /**
     * 文字列が指定されたパターンにマッチすることを確認
     */
    static expectStringMatch(str, pattern) {
        expect(str).to.be.a('string');
        if (typeof pattern === 'string') {
            expect(str).to.include(pattern);
        } else if (pattern instanceof RegExp) {
            expect(str).to.match(pattern);
        }
    }

    /**
     * 数値が指定された範囲内にあることを確認
     */
    static expectNumberInRange(num, min, max) {
        expect(num).to.be.a('number');
        expect(num).to.be.at.least(min);
        expect(num).to.be.at.most(max);
    }

    /**
     * 実行時間が指定された範囲内であることを確認
     */
    static async expectExecutionTime(asyncFunc, minMs, maxMs) {
        const startTime = Date.now();
        await asyncFunc();
        const executionTime = Date.now() - startTime;
        
        this.expectNumberInRange(executionTime, minMs, maxMs);
        return executionTime;
    }

    /**
     * イベントが指定された時間内に発生することを確認
     */
    static expectEventWithinTime(emitter, eventName, timeoutMs = 1000) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error(`Event '${eventName}' was not emitted within ${timeoutMs}ms`));
            }, timeoutMs);

            emitter.once(eventName, (...args) => {
                clearTimeout(timeout);
                resolve(args);
            });
        });
    }

    /**
     * ファイルが存在することを確認
     */
    static expectFileExists(fs, filePath) {
        expect(fs.existsSync(filePath)).to.be.true;
    }

    /**
     * ディレクトリが存在することを確認
     */
    static expectDirectoryExists(fs, dirPath) {
        expect(fs.existsSync(dirPath)).to.be.true;
        expect(fs.statSync(dirPath).isDirectory()).to.be.true;
    }

    /**
     * JSONファイルの内容を確認
     */
    static expectJsonFileContent(fs, filePath, expectedContent) {
        this.expectFileExists(fs, filePath);
        const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        expect(content).to.deep.equal(expectedContent);
    }

    /**
     * ログエントリが存在することを確認
     */
    static expectLogEntry(logs, level, message) {
        const entry = logs.find(log => 
            log.level === level && log.message.includes(message)
        );
        expect(entry).to.exist;
        return entry;
    }

    /**
     * HTTPレスポンスの状態を確認
     */
    static expectHttpResponse(response, status, bodyMatcher) {
        expect(response.status).to.equal(status);
        if (bodyMatcher) {
            if (typeof bodyMatcher === 'object') {
                expect(response.body).to.deep.equal(bodyMatcher);
            } else if (typeof bodyMatcher === 'string') {
                expect(response.text).to.include(bodyMatcher);
            } else if (bodyMatcher instanceof RegExp) {
                expect(response.text).to.match(bodyMatcher);
            }
        }
    }

    /**
     * 非同期のタイムアウトを設定
     */
    static withTimeout(promise, timeoutMs, errorMessage) {
        return Promise.race([
            promise,
            new Promise((_, reject) => {
                setTimeout(() => {
                    reject(new Error(errorMessage || `Operation timed out after ${timeoutMs}ms`));
                }, timeoutMs);
            })
        ]);
    }

    /**
     * 複数の非同期操作を並列実行
     */
    static async expectAllResolved(promises) {
        const results = await Promise.allSettled(promises);
        const failures = results.filter(result => result.status === 'rejected');
        
        if (failures.length > 0) {
            const errors = failures.map(f => f.reason.message).join(', ');
            throw new Error(`${failures.length} promise(s) failed: ${errors}`);
        }
        
        return results.map(result => result.value);
    }
}

module.exports = AssertionHelpers;