#!/usr/bin/env node

/**
 * Configuration Setup Script for PoppoBuilder Suite
 * Helps users set up their preferred language configuration
 */

const fs = require('fs').promises;
const path = require('path');
const readline = require('readline');

class ConfigSetup {
  constructor() {
    this.supportedLanguages = ['ja', 'en'];
    this.configDir = path.join(__dirname, '../config');
    this.templatesDir = path.join(this.configDir, 'templates');
    this.targetConfigFile = path.join(this.configDir, 'config.json');
    this.poppoConfigDir = path.join(__dirname, '../.poppo');
    this.poppoConfigFile = path.join(this.poppoConfigDir, 'config.json');
  }

  /**
   * Run the configuration setup
   */
  async run() {
    console.log('🚀 PoppoBuilder Suite Configuration Setup');
    console.log('=========================================\n');

    try {
      // Check if configuration already exists
      const hasExistingConfig = await this.checkExistingConfig();
      
      if (hasExistingConfig) {
        const shouldReconfigure = await this.askReconfigure();
        if (!shouldReconfigure) {
          console.log('Configuration setup cancelled.');
          return;
        }
      }

      // Select language
      const selectedLanguage = await this.selectLanguage();
      
      // Set up configuration
      await this.setupConfiguration(selectedLanguage);
      
      // Create .poppo directory configuration
      await this.setupPoppoConfig(selectedLanguage);
      
      console.log('✅ Configuration setup completed successfully!');
      console.log(`📝 Language set to: ${selectedLanguage === 'ja' ? '日本語 (Japanese)' : 'English'}`);
      console.log(`📁 Configuration files created in: ${this.configDir}`);
      console.log('🎯 You can now start PoppoBuilder with: npm start\n');
      
    } catch (error) {
      console.error('❌ Configuration setup failed:', error.message);
      process.exit(1);
    }
  }

  /**
   * Check if configuration already exists
   */
  async checkExistingConfig() {
    try {
      await fs.access(this.targetConfigFile);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Ask if user wants to reconfigure
   */
  async askReconfigure() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise((resolve) => {
      rl.question('Configuration already exists. Do you want to reconfigure? (y/N): ', (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
      });
    });
  }

  /**
   * Select language preference
   */
  async selectLanguage() {
    console.log('Please select your preferred language:');
    console.log('言語を選択してください:');
    console.log('');
    console.log('1. 日本語 (Japanese)');
    console.log('2. English');
    console.log('');

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise((resolve) => {
      const askLanguage = () => {
        rl.question('Enter your choice (1 or 2): ', (answer) => {
          if (answer === '1') {
            rl.close();
            resolve('ja');
          } else if (answer === '2') {
            rl.close();
            resolve('en');
          } else {
            console.log('Invalid choice. Please enter 1 or 2.');
            askLanguage();
          }
        });
      };
      askLanguage();
    });
  }

  /**
   * Set up main configuration based on selected language
   */
  async setupConfiguration(language) {
    const templateFile = path.join(this.templatesDir, `config.${language}.json`);
    
    try {
      // Read template
      const templateContent = await fs.readFile(templateFile, 'utf-8');
      const templateConfig = JSON.parse(templateContent);
      
      // Remove meta information for production config
      delete templateConfig._meta;
      
      // Write to target configuration file
      await fs.writeFile(
        this.targetConfigFile,
        JSON.stringify(templateConfig, null, 2),
        'utf-8'
      );
      
      console.log(`📄 Created main configuration: ${this.targetConfigFile}`);
      
    } catch (error) {
      throw new Error(`Failed to setup configuration: ${error.message}`);
    }
  }

  /**
   * Set up .poppo directory configuration
   */
  async setupPoppoConfig(language) {
    try {
      // Ensure .poppo directory exists
      await fs.mkdir(this.poppoConfigDir, { recursive: true });
      
      // Create .poppo/config.json with language settings
      const poppoConfig = {
        language: {
          primary: language,
          fallback: language === 'ja' ? 'en' : 'ja'
        },
        systemPrompt: {
          enforceLanguage: true,
          customInstructions: language === 'ja' 
            ? 'すべての回答、コメント、説明は日本語で行ってください。'
            : 'Provide all responses, comments, and explanations in English.'
        },
        setup: {
          completed: true,
          version: '1.0.0',
          timestamp: new Date().toISOString()
        }
      };
      
      await fs.writeFile(
        this.poppoConfigFile,
        JSON.stringify(poppoConfig, null, 2),
        'utf-8'
      );
      
      console.log(`📄 Created .poppo configuration: ${this.poppoConfigFile}`);
      
    } catch (error) {
      throw new Error(`Failed to setup .poppo configuration: ${error.message}`);
    }
  }

  /**
   * Display current configuration info
   */
  async showCurrentConfig() {
    try {
      const configContent = await fs.readFile(this.targetConfigFile, 'utf-8');
      const config = JSON.parse(configContent);
      
      console.log('Current Configuration:');
      console.log('====================');
      console.log(`Language: ${config.language?.primary || 'Not set'}`);
      console.log(`Claude Timeout: ${config.claude?.timeout || 'Default'}`);
      console.log(`Dashboard Port: ${config.dashboard?.port || 'Default'}`);
      console.log(`Agents: ${Object.keys(config.agents || {}).join(', ') || 'None'}`);
      
    } catch (error) {
      console.log('No configuration file found.');
    }
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const setup = new ConfigSetup();
  
  if (args.includes('--show') || args.includes('-s')) {
    await setup.showCurrentConfig();
  } else if (args.includes('--help') || args.includes('-h')) {
    console.log('PoppoBuilder Configuration Setup');
    console.log('Usage: node setup-config.js [options]');
    console.log('');
    console.log('Options:');
    console.log('  --show, -s    Show current configuration');
    console.log('  --help, -h    Show this help message');
    console.log('');
    console.log('Without options: Run interactive setup');
  } else {
    await setup.run();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('Setup failed:', error);
    process.exit(1);
  });
}

module.exports = ConfigSetup;