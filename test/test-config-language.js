#!/usr/bin/env node

/**
 * Test script for configuration language functionality
 * Tests the Issue #174 implementation
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Test the LanguageConfigManager directly
const { getInstance, resetInstance } = require('../lib/config/language-config');
const ConfigCommand = require('../lib/commands/config');

async function cleanup() {
  // Reset instance for testing
  resetInstance();
  
  // Clean up test config files
  const globalConfigPath = path.join(os.homedir(), '.poppobuilder', 'config.json');
  const projectConfigPath = path.join(__dirname, '.poppobuilder', 'config.json');
  
  try {
    if (fs.existsSync(globalConfigPath)) {
      fs.unlinkSync(globalConfigPath);
    }
    if (fs.existsSync(projectConfigPath)) {
      fs.rmSync(path.dirname(projectConfigPath), { recursive: true, force: true });
    }
  } catch (error) {
    // Ignore cleanup errors
  }
}

async function testLanguageConfigManager() {
  console.log('\n=== Testing LanguageConfigManager ===');
  
  const languageConfig = getInstance();
  
  // Test 1: Get current language (should be default)
  console.log('Test 1: Getting current language (default)');
  const currentLang = await languageConfig.getCurrentLanguage();
  console.log(`Current language: ${currentLang}`);
  
  // Test 2: Set global language
  console.log('\nTest 2: Setting global language to Japanese');
  const result = await languageConfig.setLanguage('ja', { global: true });
  console.log(`Set result:`, result);
  
  // Test 3: Get language after setting
  console.log('\nTest 3: Getting language after setting');
  const newLang = await languageConfig.getCurrentLanguage();
  console.log(`New current language: ${newLang}`);
  
  // Test 4: Get language hierarchy
  console.log('\nTest 4: Getting language hierarchy');
  const hierarchy = await languageConfig.getLanguageHierarchy();
  console.log(`Hierarchy:`, JSON.stringify(hierarchy, null, 2));
  
  // Test 5: Set project language
  console.log('\nTest 5: Setting project language to English');
  const projectResult = await languageConfig.setLanguage('en', { global: false });
  console.log(`Project set result:`, projectResult);
  
  // Test 6: Get final language (should be project level)
  console.log('\nTest 6: Getting final language (should be project level)');
  const finalLang = await languageConfig.getCurrentLanguage();
  console.log(`Final current language: ${finalLang}`);
}

async function testConfigCommand() {
  console.log('\n=== Testing ConfigCommand ===');
  
  const configCommand = new ConfigCommand();
  
  // Test language status
  console.log('\nTest: Language status command');
  await configCommand.handleLanguageCommand([]);
  
  // Test language hierarchy
  console.log('\nTest: Language hierarchy command');
  await configCommand.handleLanguageCommand(['hierarchy']);
  
  // Test setting language
  console.log('\nTest: Setting language via config command');
  await configCommand.handleLanguageCommand(['set', 'ja', '--global']);
}

async function testErrorHandling() {
  console.log('\n=== Testing Error Handling ===');
  
  const languageConfig = getInstance();
  
  try {
    console.log('Test: Invalid language code');
    await languageConfig.setLanguage('invalid', { global: true });
  } catch (error) {
    console.log(`Expected error caught: ${error.message}`);
  }
}

async function main() {
  console.log('PoppoBuilder Configuration Language Functionality Test');
  console.log('=' .repeat(60));
  
  try {
    await cleanup();
    await testLanguageConfigManager();
    await testConfigCommand();
    await testErrorHandling();
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ All tests completed successfully!');
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await cleanup();
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { testLanguageConfigManager, testConfigCommand, testErrorHandling };