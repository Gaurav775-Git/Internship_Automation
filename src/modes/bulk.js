import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import XLSX from 'xlsx';
import inquirer from 'inquirer';
import { createProgressBar, showSuccess, showError, showInfo, showWarning } from '../ui/progress.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..', '..');
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

function resolvePath(filePath) {
  return path.isAbsolute(filePath) ? filePath : path.join(ROOT_DIR, filePath);
}

function extractEmails(rows) {
  if (!rows.length) return [];

  const headers = rows[0].map((value) => String(value ?? '').trim().toLowerCase());
  const emailColumns = headers
    .map((header, index) => ({ header, index }))
    .filter(({ header }) => header.includes('email') || header.includes('e-mail'))
    .map(({ index }) => index);
  const columns = emailColumns.length ? emailColumns : headers.map((_, index) => index);
  const dataRows = emailColumns.length ? rows.slice(1) : rows;
  const emails = [];

  for (const row of dataRows) {
    for (const column of columns) {
      const match = String(row[column] ?? '').match(EMAIL_PATTERN);
      if (match) emails.push(match[0].toLowerCase());
    }
  }

  return [...new Set(emails)];
}

async function readRecipientEmails(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (!['.csv', '.xlsx', '.xls'].includes(extension)) {
    throw new Error('Recipient file must be a .csv, .xlsx, or .xls file');
  }

  let rows;
  if (extension === '.csv') {
    const workbook = XLSX.read(await readFile(filePath), { type: 'buffer' });
    rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {
      header: 1,
      defval: ''
    });
  } else {
    const workbook = XLSX.readFile(filePath);
    rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {
      header: 1,
      defval: ''
    });
  }

  return extractEmails(rows);
}

export async function runBulkMode(client, config, gmailUser, gmailPassword) {
  console.log('\n📧 BULK EMAIL MODE\n');

  if (!gmailUser || !gmailPassword) {
    showError('Gmail credentials required. Configure .env first');
    return;
  }

  const sourceResponse = await inquirer.prompt([{
    type: 'input',
    name: 'recipientsPath',
    message: 'CSV or Excel file containing recipients:',
    default: config.recipientsPath
  }]);
  const recipientsPath = resolvePath(sourceResponse.recipientsPath.trim());

  if (!existsSync(recipientsPath)) {
    showError(`Recipient file not found: ${recipientsPath}`);
    return;
  }

  let emails;
  try {
    emails = await readRecipientEmails(recipientsPath);
  } catch (error) {
    showError(error.message);
    return;
  }

  if (!emails.length) {
    showWarning('No email addresses were found in the file');
    return;
  }

  const content = await inquirer.prompt([
    {
      type: 'input',
      name: 'subject',
      message: 'Email subject:',
      default: config.emailSubject
    },
    {
      type: 'editor',
      name: 'body',
      message: 'Email body:',
      default: config.emailBody
    }
  ]);

  if (!content.subject.trim() || !content.body.trim()) {
    showError('Email subject and body cannot be empty');
    return;
  }

  const resumePath = resolvePath(config.resumePath);
  if (!existsSync(resumePath)) {
    showError(`Resume not found: ${resumePath}`);
    return;
  }

  if (emails.length > config.maxEmailsPerDay) {
    showWarning(`Found ${emails.length} recipients; only the first ${config.maxEmailsPerDay} will be sent today`);
    emails = emails.slice(0, config.maxEmailsPerDay);
  }

  showInfo(`Found ${emails.length} unique email address(es)`);
  const { confirm } = await inquirer.prompt([{
    type: 'confirm',
    name: 'confirm',
    message: `Send the same email and resume to all ${emails.length} recipients?`,
    default: false
  }]);

  if (!confirm) {
    showInfo('Sending cancelled');
    return;
  }

  const progressBar = createProgressBar();
  progressBar.start(emails.length, 0);
  let sent = 0;
  let failed = 0;

  for (let index = 0; index < emails.length; index++) {
    const email = emails[index];
    try {
      const result = await client.callTool({
        name: 'send_email',
        arguments: {
          to: email,
          subject: content.subject.trim(),
          body: content.body.trim(),
          resumePath,
          gmailUser,
          gmailPassword
        }
      });
      const status = JSON.parse(result.content[0].text);
      if (!status.success) throw new Error(status.error || 'Unknown sending error');
      sent++;
      showSuccess(`Sent to ${email}`);
    } catch (error) {
      failed++;
      showError(`Failed for ${email}: ${error.message}`);
    }

    progressBar.update(index + 1);
    if (index < emails.length - 1 && config.delaySeconds > 0) {
      await new Promise((resolve) => setTimeout(resolve, config.delaySeconds * 1000));
    }
  }

  progressBar.stop();
  showInfo(`Finished: ${sent} sent, ${failed} failed, ${emails.length} total`);
}