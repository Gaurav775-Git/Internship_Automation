import inquirer from 'inquirer';

export async function showMainMenu() {
  const { choice } = await inquirer.prompt([
    {
      type: 'list',
      name: 'choice',
      message: '🎯 What would you like to do?',
      choices: [
        { name: '🚀 AUTO MODE - Complete automation (CSV → Send)', value: 'auto' },
        { name: '🔧 MANUAL MODE - Step-by-step guided process', value: 'manual' },
        { name: '📦 BATCH MODE - Process specific jobs from CSV', value: 'batch' },
        { name: '🧹 FILTER DATA - AI clean and fix CSV data', value: 'filterData' },
        { name: '📊 VIEW LOGS - See application history', value: 'logs' },
        { name: '⚙️ CONFIGURATION - Update settings', value: 'config' },
        { name: '🧪 TEST EMAIL - Send test to yourself', value: 'test' },
        { name: 'ℹ️ ABOUT - System information', value: 'about' },
        { name: '🚪 EXIT', value: 'exit' }
      ],
      pageSize: 10,
      loop: false
    }
  ]);
  return choice;
}

export async function showConfigMenu(currentConfig) {
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: '⚙️ Configuration Options',
      choices: [
        { name: `📧 Gmail User: ${currentConfig.gmailUser || 'NOT SET'}`, value: 'gmail' },
        { name: `📄 Resume Path: ${currentConfig.resumePath}`, value: 'resume' },
        { name: `📊 CSV Path: ${currentConfig.csvPath}`, value: 'csv' },
        { name: `⏱️ Delay Between Emails: ${currentConfig.delaySeconds}s`, value: 'delay' },
        { name: `📨 Max Emails/Day: ${currentConfig.maxEmailsPerDay}`, value: 'maxEmails' },
        { name: '💾 Save and Return', value: 'save' },
        { name: '🔙 Back to Main Menu', value: 'back' }
      ]
    }
  ]);
  return action;
}
