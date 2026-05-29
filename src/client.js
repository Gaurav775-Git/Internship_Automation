import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFile } from 'fs/promises';
import dotenv from 'dotenv';
import { showBanner } from './ui/banner.js';
import { showMainMenu, showConfigMenu } from './ui/menu.js';
import { showSpinner, showSuccess, showError, showInfo, showWarning } from './ui/progress.js';
import { loadConfig, updateConfig } from './config/manager.js';
import { runAutoMode } from './modes/auto.js';
import { runManualMode } from './modes/manual.js';
import { runBatchMode } from './modes/batch.js';
import { showLogs } from './ui/logs.js';
import inquirer from 'inquirer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');

dotenv.config({ path: path.join(ROOT_DIR, '.env') });

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_PASSWORD = process.env.GMAIL_APP_PASSWORD || process.env.GMAIL_PASSWORD;

async function waitForContinue() {
  await inquirer.prompt([
    {
      type: 'input',
      name: 'continue',
      message: '\nPress ENTER to return to the main menu...',
      default: ''
    }
  ]);
}

async function main() {
  console.clear();
  await showBanner();
  
  // Check credentials
  if (!GMAIL_USER || !GMAIL_PASSWORD) {
    showWarning('Gmail credentials not found in .env');
    showInfo('Create .env file with:');
    console.log('   GMAIL_USER=your@email.com');
    console.log('   GMAIL_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx\n');
  } else {
    showSuccess('Gmail credentials loaded');
  }
  
  // Load config
  const config = await loadConfig();
  showInfo(`Config loaded: Min Score ${config.minMatchScore}%, Delay ${config.delaySeconds}s\n`);
  
  // Connect to MCP server
  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.join(__dirname, 'server.js')]
  });
  
  const client = new Client(
    { name: 'autointern-client', version: '2.0.0' },
    { capabilities: {} }
  );
  
  await client.connect(transport);
  showSuccess('Connected to AutoIntern server\n');
  
  // Load resume
  let resumeText = '';
  try {
    resumeText = await readFile(path.join(ROOT_DIR, config.resumePath), 'utf-8');
    showSuccess('Resume loaded\n');
  } catch {
    showWarning('Resume not found. Create data/resume.txt\n');
  }
  
  // Main menu loop
  let running = true;
  while (running) {
    const choice = await showMainMenu();
    
    switch (choice) {
      case 'auto':
        if (!GMAIL_USER || !GMAIL_PASSWORD) {
          showError('Gmail credentials required. Configure .env first');
          break;
        }
        if (!resumeText) {
          showError('Resume required. Create data/resume.txt first');
          break;
        }
        await runAutoMode(client, config, resumeText, GMAIL_USER, GMAIL_PASSWORD);
        await waitForContinue();
        break;
        
      case 'config':
        let configuring = true;
        while (configuring) {
          const configAction = await showConfigMenu(config);
          
          if (configAction === 'gmail') {
            const { email } = await inquirer.prompt([{ 
              type: 'input',
              name: 'email',
              message: 'Enter Gmail address:',
              validate: (input) => input.includes('@') || 'Valid email required'
            }]);
            await updateConfig({ gmailUser: email });
            showSuccess('Gmail updated');
          }
          else if (configAction === 'resume') {
            const { resumePath } = await inquirer.prompt([{ 
              type: 'input',
              name: 'resumePath',
              message: 'Enter resume path:',
              default: config.resumePath
            }]);
            await updateConfig({ resumePath });
            showSuccess(`Resume path updated to ${resumePath}`);
          }
          else if (configAction === 'csv') {
            const { csvPath } = await inquirer.prompt([{ 
              type: 'input',
              name: 'csvPath',
              message: 'Enter CSV path:',
              default: config.csvPath
            }]);
            await updateConfig({ csvPath });
            showSuccess(`CSV path updated to ${csvPath}`);
          }
          else if (configAction === 'minScore') {
            const { score } = await inquirer.prompt([{ 
              type: 'number',
              name: 'score',
              message: 'Minimum match score (0-100):',
              default: config.minMatchScore,
              validate: (input) => input >= 0 && input <= 100
            }]);
            await updateConfig({ minMatchScore: score });
            showSuccess(`Min score updated to ${score}%`);
          }
          else if (configAction === 'delay') {
            const { delay } = await inquirer.prompt([{ 
              type: 'number',
              name: 'delay',
              message: 'Delay between emails (seconds):',
              default: config.delaySeconds
            }]);
            await updateConfig({ delaySeconds: delay });
            showSuccess(`Delay updated to ${delay}s`);
          }
          else if (configAction === 'maxEmails') {
            const { maxEmails } = await inquirer.prompt([{ 
              type: 'number',
              name: 'maxEmails',
              message: 'Enter maximum emails per day:',
              default: config.maxEmailsPerDay
            }]);
            await updateConfig({ maxEmailsPerDay: maxEmails });
            showSuccess(`Max emails per day set to ${maxEmails}`);
          }
          else if (configAction === 'save' || configAction === 'back') {
            configuring = false;
          }
          
          const newConfig = await loadConfig();
          Object.assign(config, newConfig);
          try {
            resumeText = await readFile(path.join(ROOT_DIR, config.resumePath), 'utf-8');
          } catch {
            resumeText = '';
          }
        }
        await waitForContinue();
        break;
        
      case 'manual':
        await runManualMode(client, config, resumeText, GMAIL_USER, GMAIL_PASSWORD);
        await waitForContinue();
        break;
      case 'batch':
        await runBatchMode(client, config, resumeText, GMAIL_USER, GMAIL_PASSWORD);
        await waitForContinue();
        break;
      case 'logs':
        await showLogs(ROOT_DIR);
        await waitForContinue();
        break;
      case 'test':
        if (!GMAIL_USER || !GMAIL_PASSWORD) {
          showError('Gmail credentials required');
          break;
        }
        const spinner = await showSpinner('Sending test email...');
        try {
          const result = await client.callTool({
            name: 'send_application',
            arguments: {
              to: GMAIL_USER,
              jobTitle: 'Test Email',
              company: 'AutoIntern System',
              resumePath: path.join(ROOT_DIR, config.resumePath),
              gmailUser: GMAIL_USER,
              gmailPassword: GMAIL_PASSWORD
            }
          });
          const data = JSON.parse(result.content[0].text);
          spinner.stop();
          if (data.success) {
            showSuccess(`Test email sent to ${GMAIL_USER}`);
          } else {
            showError(`Failed: ${data.error}`);
          }
        } catch (err) {
          spinner.stop();
          showError(err.message);
        }
        await waitForContinue();
        break;
        
      case 'about':
        console.log('\n┌─────────────────────────────────────────────────┐');
        console.log('│              🤖 AutoIntern v2.0                 │');
        console.log('├─────────────────────────────────────────────────┤');
        console.log('│  AI-powered internship automation system       │');
        console.log('│                                                │');
        console.log('│  Features:                                     │');
        console.log('│  • Auto-apply from CSV                         │');
        console.log('│  • LLM job matching                            │');
        console.log('│  • Personalized emails                         │');
        console.log('│  • Application tracking                        │');
        console.log('│                                                │');
        console.log('│  Built with: MCP + Node.js + OpenRouter        │');
        console.log('│                                                │');
        console.log('│  License: MIT                                  │');
        console.log('└─────────────────────────────────────────────────┘\n');
        await waitForContinue();
        break;
        
      case 'exit':
        running = false;
        console.log('\n👋 Goodbye from AutoIntern!\n');
        break;
        
      default:
        showInfo('Feature coming soon...');
    }
  }
  
  await client.close();
  process.exit(0);
}

main().catch((error) => {
  console.error('\n❌ Fatal error:', error.message);
  process.exit(1);
});
