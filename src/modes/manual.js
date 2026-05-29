import path from 'path';
import { fileURLToPath } from 'url';
import { showSpinner, showSuccess, showError, showInfo, showWarning } from '../ui/progress.js';
import inquirer from 'inquirer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..', '..');

export async function runManualMode(client, config, resumeText, GMAIL_USER, GMAIL_PASSWORD) {
  console.log('\n🔧 ENTERING MANUAL MODE\n');

  if (!GMAIL_USER || !GMAIL_PASSWORD) {
    showError('Gmail credentials required for manual mode');
    return;
  }

  if (!resumeText) {
    showError('Resume text not loaded. Make sure your resume file exists');
    return;
  }

  const responses = await inquirer.prompt([
    {
      type: 'input',
      name: 'title',
      message: 'Job title:',
      validate: (input) => input.trim() !== '' || 'Job title is required'
    },
    {
      type: 'input',
      name: 'company',
      message: 'Company name:',
      validate: (input) => input.trim() !== '' || 'Company is required'
    },
    {
      type: 'input',
      name: 'description',
      message: 'Job description:',
      validate: (input) => input.trim() !== '' || 'Description is required'
    },
    {
      type: 'input',
      name: 'requirements',
      message: 'Requirements / skills:',
      default: ''
    },
    {
      type: 'input',
      name: 'email',
      message: 'Recruiter email:',
      validate: (input) => input.trim() !== '' || 'Email is required'
    }
  ]);

  if (!responses.email) {
    showWarning('No email provided. Manual mode cannot send an application.');
    return;
  }

  showInfo('Analyzing the job against your resume...');
  const spinner = await showSpinner('Running analysis');
  try {
    const analyzeResult = await client.callTool({
      name: 'mistral_analyze_job',
      arguments: {
        jobTitle: responses.title,
        company: responses.company,
        jobDescription: responses.description,
        requirements: responses.requirements,
        yourResume: resumeText
      }
    });

    spinner.stop();
    const analysis = JSON.parse(analyzeResult.content[0].text);
    const matchScore = analysis.analysis?.match_score || 0;

    if (!analysis.success) {
      showWarning(`Analysis issue detected, continuing to send email`);
    } else {
      showInfo(`Match score: ${matchScore} / 100`);
      if (!analysis.analysis.should_apply || matchScore < config.minMatchScore) {
        showWarning('Low match detected, continuing to send email anyway.');
      }
    }

    const sendSpinner = await showSpinner('Sending application');
    const sendResult = await client.callTool({
      name: 'send_application',
      arguments: {
        to: responses.email,
        jobTitle: responses.title,
        company: responses.company,
        resumePath: path.join(ROOT_DIR, config.resumePath),
        gmailUser: GMAIL_USER,
        gmailPassword: GMAIL_PASSWORD
      }
    });

    sendSpinner.stop();
    const sendStatus = JSON.parse(sendResult.content[0].text);

    if (sendStatus.success) {
      showSuccess('Manual application sent successfully!');
    } else {
      showError(`Failed to send: ${sendStatus.error || 'Unknown error'}`);
    }
  } catch (err) {
    spinner.stop();
    showError(err.message);
  }
}
