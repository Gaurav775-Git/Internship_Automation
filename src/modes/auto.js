import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createProgressBar, showSpinner, showSuccess, showError, showInfo } from '../ui/progress.js';
import { showSummaryTable } from '../ui/table.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..', '..');

export async function runAutoMode(client, config, resumeText, GMAIL_USER, GMAIL_PASSWORD) {
  console.log('\n🚀 STARTING AUTO MODE\n');
  console.log('─'.repeat(50));
  
  // Read CSV
  showInfo('Reading internships from CSV...');
  const csvPath = path.join(ROOT_DIR, config.csvPath);
  
  if (!existsSync(csvPath)) {
    showError(`CSV not found at ${csvPath}`);
    return;
  }
  
  const csvContent = await readFile(csvPath, 'utf-8');
  const lines = csvContent.split('\n').filter(l => l.trim());
  const internships = [];
  
  for (let i = 1; i < lines.length; i++) {
    const matches = lines[i].match(/(".*?"|[^,]+)(?=\s*,|\s*$)/g);
    if (matches && matches.length >= 3) {
      internships.push({
        title: matches[0].replace(/"/g, '').trim(),
        company: matches[1].replace(/"/g, '').trim(),
        description: matches[2].replace(/"/g, '').trim(),
        requirements: matches[3]?.replace(/"/g, '').trim() || '',
        email: matches[4]?.replace(/"/g, '').trim() || ''
      });
    }
  }
  
  showSuccess(`Loaded ${internships.length} internships\n`);
  
  if (internships.length === 0) return;
  
  // Process each job
  const results = [];
  const progressBar = createProgressBar();
  progressBar.start(internships.length, 0);
  
  for (let i = 0; i < internships.length; i++) {
    const job = internships[i];
    
    if (!job.email) {
      showWarning(`No email for ${job.title} at ${job.company} - skipping`);
      results.push({ ...job, score: 0, status: 'Skipped - No Email' });
      progressBar.update(i + 1);
      continue;
    }
    
    // Analyze with LLM
    const analyzeResult = await client.callTool({
      name: 'mistral_analyze_job',
      arguments: {
        jobTitle: job.title,
        company: job.company,
        jobDescription: job.description,
        requirements: job.requirements,
        yourResume: resumeText
      }
    });
    
    const analysis = JSON.parse(analyzeResult.content[0].text);
    
    if (!analysis.success || !analysis.analysis.should_apply || analysis.analysis.match_score < config.minMatchScore) {
      results.push({ ...job, score: analysis.analysis?.match_score || 0, status: 'Skipped - Low Match' });
      progressBar.update(i + 1);
      continue;
    }
    
    // Send email
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
    
    const sendStatus = JSON.parse(sendResult.content[0].text);
    
    if (sendStatus.success) {
      showSuccess(`Sent to ${job.title} at ${job.company}`);
      results.push({ ...job, score: analysis.analysis.match_score, status: 'Sent' });
    } else {
      showError(`Failed: ${job.title} at ${job.company} - ${sendStatus.error}`);
      results.push({ ...job, score: analysis.analysis.match_score, status: 'Failed' });
    }
    
    progressBar.update(i + 1);
    
    if (i < internships.length - 1) {
      await new Promise(resolve => setTimeout(resolve, config.delaySeconds * 1000));
    }
  }
  
  progressBar.stop();
  
  // Show summary
  const stats = {
    applied: results.filter(r => r.status === 'Sent').length,
    skipped: results.filter(r => r.status.includes('Skipped')).length,
    failed: results.filter(r => r.status === 'Failed').length,
    total: results.length,
    timeTaken: '~' + Math.ceil((results.length * config.delaySeconds) / 60) + ' minutes'
  };
  
  showSummaryTable(stats);
}
