#!/usr/bin/env node

/**
 * Simple test for template functionality
 */

const path = require('path');
const fs = require('fs').promises;
const TemplateManager = require('../lib/templates/template-manager');

async function testTemplateManager() {
  console.log('Testing TemplateManager...');
  
  const templateManager = new TemplateManager();
  
  try {
    // Test initialization
    await templateManager.initialize();
    console.log('✓ TemplateManager initialized');
    
    // Test listing templates
    const templates = await templateManager.listTemplates();
    console.log(`✓ Found ${templates.length} templates`);
    
    // Display templates
    templates.forEach(template => {
      console.log(`  - ${template.name} (${template.type}): ${template.description}`);
    });
    
    // Test finding a specific template
    const defaultTemplate = await templateManager.findTemplate('default');
    if (defaultTemplate) {
      console.log('✓ Found default template');
    } else {
      console.log('! Default template not found');
    }
    
    console.log('\nTemplate functionality test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  testTemplateManager();
}

module.exports = testTemplateManager;