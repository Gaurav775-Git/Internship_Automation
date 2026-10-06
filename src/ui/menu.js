import inquirer from 'inquirer';

export async function showMainMenu() {
  const { choice } = await inquirer.prompt([
    {
      type: 'list',
      name: 'choice',
      message: '🎯 What would you like to do?',
      choices: [
        { name: '📧 SEND BULK EMAILS - CSV/Excel → Send', value: 'bulk' },
        { name: '📊 VIEW LOGS - See application history', value: 'logs' },
        { name: '⚙️ CONFIGURATION - Update settings', value: 'config' },
        { name: '🧪 TEST EMAIL - Send test to yourself', value: 'test' },
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
        { name: `📊 Recipient File: ${currentConfig.recipientsPath}`, value: 'recipients' },
        { name: `✉️ Subject: ${currentConfig.emailSubject}`, value: 'subject' },
        { name: '📝 Email Body', value: 'body' },
        { name: `⏱️ Delay Between Emails: ${currentConfig.delaySeconds}s`, value: 'delay' },
        { name: `📨 Max Emails/Day: ${currentConfig.maxEmailsPerDay}`, value: 'maxEmails' },
        { name: '💾 Save and Return', value: 'save' },
        { name: '🔙 Back to Main Menu', value: 'back' }
      ]
    }
  ]);
  return action;
}
