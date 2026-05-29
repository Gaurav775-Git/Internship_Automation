import path from 'path';
import { fileURLToPath } from 'url';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import inquirer from 'inquirer';
import { createProgressBar, showSpinner, showSuccess, showError, showInfo, showWarning } from '../ui/progress.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..', '..');

function parseCsv(lines) {
  const internships = [];
  for (let i = 1; i < lines.length; i++) {
    const matches = lines[i].match(/(".*?"|[^,]+)(?=\s*,|\s*$)/g);
    if (matches && matches.length >= 5) {
      internships.push({
        title: matches[0].replace(/"/g, '').trim(),
        company: matches[1].replace(/"/g, '').trim(),
        description: matches[2].replace(/"/g, '').trim(),
        requirements: matches[3].replace(/"/g, '').trim(),
        email: matches[4].replace(/"/g, '').trim()
      });
    }
  }
  return internships;
}

export async function runBatchMode(client, config, resumeText, GMAIL_USER, GMAIL_PASSWORD) {
  console.log('\n📦 ENTERING BATCH MODE\n');

  if (!GMAIL_USER || !GMAIL_PASSWORD) {
    showError('Gmail credentials required for batch mode');
    return;
  }

  if (!resumeText) {
    showError('Resume text not loaded. Ensure your resume file exists');
    return;
  }

  const csvPath = path.join(ROOT_DIR, config.csvPath);
  if (!existsSync(csvPath)) {
    showError(`CSV file not found at ${csvPath}`);
    return;
  }

  const csvContent = await readFile(csvPath, 'utf-8');
  const lines = csvContent.split('\n').filter((line) => line.trim());
  const internships = parseCsv(lines);

  if (internships.length === 0) {
    showWarning('No valid internships found in CSV');
    return;
  }

  const { selectedJobs } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selectedJobs',
      message: 'Select jobs to process in batch mode',
      choices: internships.map((job, index) => ({
        name: `${index + 1}. ${job.title} at ${job.company} [${job.email || 'no email'}]`,
        value: index
      }))
    }
  ]);

  if (!selectedJobs.length) {
    showInfo('No jobs selected. Returning to main menu.');
    return;
  }

  const progressBar = createProgressBar();
  progressBar.start(selectedJobs.length, 0);

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < selectedJobs.length; i++) {
    const job = internships[selectedJobs[i]];

    if (!job.email) {
      showWarning(`Skipping ${job.title} at ${job.company} because email is missing`);
      skipped++;
      progressBar.update(i + 1);
      continue;
    }

    const spinner = await showSpinner(`Analyzing ${job.title} at ${job.company}`);
    try {
      const analysisResult = await client.callTool({
        name: 'mistral_analyze_job',
        arguments: {
          jobTitle: job.title,
          company: job.company,
          jobDescription: job.description,
          requirements: job.requirements,
          yourResume: resumeText
        }
      });
      spinner.stop();

      const analysis = JSON.parse(analysisResult.content[0].text);
      const matchScore = analysis.analysis?.match_score || 0;
      if (!analysis.success) {
        showWarning(`Analysis issue for ${job.title}, continuing to send email`);
      } else if (!analysis.analysis.should_apply || matchScore < config.minMatchScore) {
        showWarning(`Low match for ${job.title}, continuing to send email`);
      }

      const sendSpinner = await showSpinner(`Sending ${job.title}`);
      const sendResult = await client.callTool({
        name: 'send_application',
        arguments: {
          to: job.email,
          jobTitle: job.title,
          company: job.company,
          resumePath: path.join(ROOT_DIR, config.resumePath),
          gmailUser: GMAIL_USER,
          gmailPassword: GMAIL_PASSWORD
        }
      });
      sendSpinner.stop();

      const sendStatus = JSON.parse(sendResult.content[0].text);
      if (sendStatus.success) {
        showSuccess(`Sent ${job.title} at ${job.company}`);
        sent++;
      } else {
        showError(`Failed to send ${job.title}: ${sendStatus.error}`);
        failed++;
      }
    } catch (err) {
      spinner.stop();
      showError(`Error processing ${job.title}: ${err.message}`);
      failed++;
    }

    progressBar.update(i + 1);
  }

  progressBar.stop();
  console.log('\n📊 Batch mode summary:');
  showSuccess(`Sent: ${sent}`);
  showWarning(`Skipped: ${skipped}`);
  if (failed) showError(`Failed: ${failed}`);
}
