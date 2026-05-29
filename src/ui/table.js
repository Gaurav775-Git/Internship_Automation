import Table from 'cli-table3';

export function showApplicationsTable(applications) {
  const table = new Table({
    head: ['Company', 'Position', 'Match Score', 'Status'],
    colWidths: [20, 30, 15, 20],
    style: { head: ['cyan'], border: ['gray'] }
  });
  
  applications.forEach(app => {
    const scoreBar = '█'.repeat(Math.floor(app.score / 10)) + '░'.repeat(10 - Math.floor(app.score / 10));
    table.push([
      app.company,
      app.position,
      `${scoreBar} ${app.score}%`,
      app.status === 'Sent' ? '✅ Sent' : '⏭️ Skipped'
    ]);
  });
  
  console.log(table.toString());
}

export function showSummaryTable(stats) {
  const table = new Table({
    style: { head: ['cyan'], border: ['gray'] }
  });
  
  table.push(
    ['✅ Successfully Applied', stats.applied],
    ['⏭️ Skipped (No Email)', stats.skipped],
    ['❌ Failed', stats.failed],
    ['📋 Total Processed', stats.total],
    ['⏱️ Time Taken', stats.timeTaken],
    ['📁 Log File', 'logs/applications.csv']
  );
  
  console.log(table.toString());
}
