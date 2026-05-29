import path from 'path';
import { readdir, readFile } from 'fs/promises';
import inquirer from 'inquirer';

export async function showLogs(rootDir) {
  const logsDir = path.join(rootDir, 'logs');

  try {
    const files = await readdir(logsDir);
    if (!files.length) {
      console.log('\nℹ️ No logs found yet. Run a batch or auto job to generate logs.\n');
      return;
    }

    const { selectedFile } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selectedFile',
        message: 'Select a log file to view',
        choices: files.map((file) => ({ name: file, value: file }))
      }
    ]);

    const contents = await readFile(path.join(logsDir, selectedFile), 'utf-8');
    console.log(`\n===== ${selectedFile} =====\n`);
    console.log(contents);
  } catch (err) {
    console.log(`\n❌ Unable to read logs: ${err.message}\n`);
  }
}
