import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { showBanner } from './ui/banner.js';
import { showMainMenu, showConfigMenu } from './ui/menu.js';
import { showSpinner, showSuccess, showError, showInfo, showWarning } from './ui/progress.js';
import { loadConfig, updateConfig } from './config/manager.js';
import { runBulkMode } from './modes/bulk.js';
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
  showInfo(`Config loaded: Delay ${config.delaySeconds}s, Max Emails ${config.maxEmailsPerDay}/day\n`);
  
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
  
  // Main menu loop
  let running = true;
  while (running) {
    const choice = await showMainMenu();
    
    switch (choice) {
      case 'bulk':
        await runBulkMode(client, config, GMAIL_USER, GMAIL_PASSWORD);
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
          else if (configAction === 'recipients') {
            const { recipientsPath } = await inquirer.prompt([{ 
              type: 'input',
              name: 'recipientsPath',
              message: 'Enter CSV or Excel path:',
              default: config.recipientsPath
            }]);
            await updateConfig({ recipientsPath });
            showSuccess(`Recipient file updated to ${recipientsPath}`);
          }
          else if (configAction === 'subject') {
            const { emailSubject } = await inquirer.prompt([{
              type: 'input',
              name: 'emailSubject',
              message: 'Enter email subject:',
              default: config.emailSubject
            }]);
            await updateConfig({ emailSubject });
            showSuccess('Email subject updated');
          }
          else if (configAction === 'body') {
            const { emailBody } = await inquirer.prompt([{
              type: 'editor',
              name: 'emailBody',
              message: 'Edit email body:',
              default: config.emailBody
            }]);
            await updateConfig({ emailBody });
            showSuccess('Email body updated');
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
        }
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
            name: 'send_email',
            arguments: {
              to: GMAIL_USER,
              subject: config.emailSubject,
              body: config.emailBody,
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
        console.log('│  • AI CSV cleaning and repair                  │');
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
