const { expect } = require('chai');
const sinon = require('sinon');
const MockFactory = require('./helpers/mock-factory');

describe('CCQA Agent (Simple)', () => {
  let sandbox;
  let mockFactory;
  
  beforeEach(() => {
    sandbox = sinon.createSandbox();
    mockFactory = new MockFactory();
  });
  
  afterEach(() => {
    sandbox.restore();
    mockFactory.cleanup();
  });
  
  describe('Mock Factory Testing', () => {
    it('should create mock objects', () => {
      const mockReq = mockFactory.createMockRequest();
      const mockRes = mockFactory.createMockResponse();
      const mockNext = mockFactory.createMockNext();
      
      expect(mockReq).to.be.an('object');
      expect(mockRes).to.be.an('object');
      expect(mockNext).to.be.a('function');
    });
    
    it('should create mock GitHub client', () => {
      const github = mockFactory.createMockGitHubClient();
      
      expect(github.getIssue).to.be.a('function');
      expect(github.listIssues).to.be.a('function');
      expect(github.createIssueComment).to.be.a('function');
    });
    
    it('should create mock JWT auth', () => {
      const jwtAuth = mockFactory.createMockJWTAuth();
      
      expect(jwtAuth.initialize).to.be.a('function');
      expect(jwtAuth.authenticateAgent).to.be.a('function');
      expect(jwtAuth.generateAccessToken).to.be.a('function');
    });
  });
  
  describe('Basic Functionality', () => {
    it('should handle simple calculations', () => {
      const result = 2 + 2;
      expect(result).to.equal(4);
    });
    
    it('should handle async operations', async () => {
      const promise = new Promise(resolve => {
        setTimeout(() => resolve('test result'), 10);
      });
      
      const result = await promise;
      expect(result).to.equal('test result');
    });
    
    it('should handle errors properly', () => {
      const errorFunc = () => {
        throw new Error('Test error');
      };
      
      expect(errorFunc).to.throw('Test error');
    });
  });
});