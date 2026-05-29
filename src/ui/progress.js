import cliProgress from 'cli-progress';
import ora from 'ora';

export function createProgressBar() {
  return new cliProgress.SingleBar({
    format: '🔄 {bar} | {percentage}% | {value}/{total} jobs',
    barCompleteChar: '█',
    barIncompleteChar: '░',
    hideCursor: true,
    stopOnComplete: true
  });
}

export async function showSpinner(message) {
  const spinner = ora({
    text: message,
    spinner: 'dots12',
    color: 'cyan'
  });
  spinner.start();
  return spinner;
}

export function showSuccess(message) {
  console.log(`✅ ${message}`);
}

export function showError(message) {
  console.log(`❌ ${message}`);
}

export function showWarning(message) {
  console.log(`⚠️ ${message}`);
}

export function showInfo(message) {
  console.log(`ℹ️ ${message}`);
}
