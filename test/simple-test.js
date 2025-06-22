/**
 * シンプルなテスト - 依存関係の検証
 */

require('./helpers/test-setup');
const { expect } = require('chai');

describe('Simple Test', () => {
  it('should load chai successfully', () => {
    expect(1 + 1).to.equal(2);
  });

  it('should handle promises', async () => {
    const result = await Promise.resolve('test');
    expect(result).to.equal('test');
  });

  it('should work with basic assertions', () => {
    const obj = { name: 'test' };
    expect(obj).to.have.property('name');
    expect(obj.name).to.equal('test');
  });
});